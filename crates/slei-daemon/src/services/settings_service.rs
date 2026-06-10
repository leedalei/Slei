use std::sync::Arc;

use slei_storage::repositories::{Repositories, UserPreferencesRow};
use tokio::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserProfile {
    pub nickname: String,
    pub handle: String,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ProfileDraft {
    pub nickname: String,
    pub handle: String,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotificationPreferences {
    pub mentions: bool,
    pub human_replies: bool,
    pub approvals: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppearancePreferences {
    pub theme: String,
    pub font_size: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalePreference {
    ZhCn,
    EnUs,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserPreferences {
    pub locale: LocalePreference,
    pub time_zone: String,
    pub appearance: AppearancePreferences,
    pub notifications: NotificationPreferences,
}

#[derive(Clone, Debug, Default)]
pub struct SettingsService {
    inner: Arc<Mutex<SettingsState>>,
    mutation_gate: Arc<Mutex<()>>,
    repos: Option<Repositories>,
}

#[derive(Clone, Debug)]
struct SettingsState {
    profile: Option<UserProfile>,
    preferences: UserPreferences,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self {
            profile: None,
            preferences: UserPreferences {
                locale: LocalePreference::ZhCn,
                time_zone: "Asia/Shanghai".to_string(),
                appearance: AppearancePreferences {
                    theme: "system".to_string(),
                    font_size: "md".to_string(),
                },
                notifications: NotificationPreferences {
                    mentions: true,
                    human_replies: true,
                    approvals: true,
                },
            },
        }
    }
}

impl SettingsService {
    pub fn new(repos: Repositories) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SettingsState::default())),
            mutation_gate: Arc::new(Mutex::new(())),
            repos: Some(repos),
        }
    }

    pub fn for_tests() -> Self {
        Self::default()
    }

    pub async fn clear_for_development_reset(&self) {
        *self.inner.lock().await = SettingsState::default();
    }

    pub async fn create_profile(&self, draft: ProfileDraft) -> Result<UserProfile, SettingsError> {
        validate_handle(&draft.handle)?;
        let mut state = self.inner.lock().await;
        if state.profile.is_some() {
            return Err(SettingsError::ProfileAlreadyExists);
        }

        let profile = UserProfile {
            nickname: draft.nickname,
            handle: draft.handle,
            bio: draft.bio,
            avatar_url: draft.avatar_url,
        };
        state.profile = Some(profile.clone());
        Ok(profile)
    }

    pub async fn update_handle(&self, _handle: &str) -> Result<(), SettingsError> {
        Err(SettingsError::HandleImmutable)
    }

    pub async fn set_locale(&self, locale: LocalePreference) -> Result<(), SettingsError> {
        let _gate = self.mutation_gate.lock().await;
        let mut preferences = self.preferences_for_update().await?;
        preferences.locale = locale;
        self.persist_preferences(&preferences).await?;
        self.inner.lock().await.preferences = preferences;
        Ok(())
    }

    pub async fn set_time_zone(&self, time_zone: String) -> Result<(), SettingsError> {
        let _gate = self.mutation_gate.lock().await;
        let trimmed = time_zone.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 64 {
            return Err(SettingsError::InvalidTimeZone);
        }
        let mut preferences = self.preferences_for_update().await?;
        preferences.time_zone = trimmed.to_string();
        self.persist_preferences(&preferences).await?;
        self.inner.lock().await.preferences = preferences;
        Ok(())
    }

    pub async fn set_appearance(
        &self,
        appearance: AppearancePreferences,
    ) -> Result<(), SettingsError> {
        let _gate = self.mutation_gate.lock().await;
        if !matches!(
            appearance.theme.as_str(),
            "system" | "light" | "dark" | "highContrast"
        ) || !matches!(appearance.font_size.as_str(), "sm" | "md" | "lg")
        {
            return Err(SettingsError::InvalidAppearance);
        }
        let mut preferences = self.preferences_for_update().await?;
        preferences.appearance = appearance;
        self.persist_preferences(&preferences).await?;
        self.inner.lock().await.preferences = preferences;
        Ok(())
    }

    pub async fn set_notifications(
        &self,
        notifications: NotificationPreferences,
    ) -> Result<(), SettingsError> {
        let _gate = self.mutation_gate.lock().await;
        let mut preferences = self.preferences_for_update().await?;
        preferences.notifications = notifications;
        self.persist_preferences(&preferences).await?;
        self.inner.lock().await.preferences = preferences;
        Ok(())
    }

    pub async fn preferences(&self) -> UserPreferences {
        if let Some(repos) = &self.repos {
            if let Ok(Some(row)) = repos.user_preferences().await {
                let preferences = preferences_from_row(row);
                self.inner.lock().await.preferences = preferences.clone();
                return preferences;
            }
        }
        self.inner.lock().await.preferences.clone()
    }

    async fn preferences_for_update(&self) -> Result<UserPreferences, SettingsError> {
        if let Some(repos) = &self.repos {
            match repos.user_preferences().await {
                Ok(Some(row)) => return Ok(preferences_from_row(row)),
                Ok(None) => {}
                Err(error) => return Err(settings_storage_error(error)),
            }
        }
        Ok(self.inner.lock().await.preferences.clone())
    }

    async fn persist_preferences(
        &self,
        preferences: &UserPreferences,
    ) -> Result<(), SettingsError> {
        let Some(repos) = &self.repos else {
            return Ok(());
        };
        repos
            .upsert_user_preferences(preferences_to_row(preferences))
            .await
            .map_err(settings_storage_error)?;
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("profile already exists")]
    ProfileAlreadyExists,
    #[error("handle is immutable after onboarding")]
    HandleImmutable,
    #[error("invalid handle")]
    InvalidHandle,
    #[error("invalid time zone")]
    InvalidTimeZone,
    #[error("invalid appearance")]
    InvalidAppearance,
    #[error("settings storage error: {0}")]
    Storage(String),
}

fn validate_handle(handle: &str) -> Result<(), SettingsError> {
    let valid = !handle.is_empty()
        && handle.len() <= 32
        && handle.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if valid {
        Ok(())
    } else {
        Err(SettingsError::InvalidHandle)
    }
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            locale: LocalePreference::ZhCn,
            time_zone: "Asia/Shanghai".to_string(),
            appearance: AppearancePreferences {
                theme: "system".to_string(),
                font_size: "md".to_string(),
            },
            notifications: NotificationPreferences {
                mentions: true,
                human_replies: true,
                approvals: true,
            },
        }
    }
}

fn preferences_to_row(preferences: &UserPreferences) -> UserPreferencesRow {
    UserPreferencesRow {
        locale: match preferences.locale {
            LocalePreference::ZhCn => "zh-CN",
            LocalePreference::EnUs => "en-US",
        }
        .to_string(),
        time_zone: preferences.time_zone.clone(),
        theme: preferences.appearance.theme.clone(),
        font_size: preferences.appearance.font_size.clone(),
        notify_mentions: preferences.notifications.mentions,
        notify_human_replies: preferences.notifications.human_replies,
        notify_approvals: preferences.notifications.approvals,
    }
}

fn preferences_from_row(row: UserPreferencesRow) -> UserPreferences {
    UserPreferences {
        locale: match row.locale.as_str() {
            "en-US" => LocalePreference::EnUs,
            _ => LocalePreference::ZhCn,
        },
        time_zone: row.time_zone,
        appearance: AppearancePreferences {
            theme: row.theme,
            font_size: row.font_size,
        },
        notifications: NotificationPreferences {
            mentions: row.notify_mentions,
            human_replies: row.notify_human_replies,
            approvals: row.notify_approvals,
        },
    }
}

fn settings_storage_error(error: sqlx::Error) -> SettingsError {
    SettingsError::Storage(error.to_string())
}
