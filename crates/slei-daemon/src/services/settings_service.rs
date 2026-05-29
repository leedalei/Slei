use std::sync::Arc;

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
    pub fn for_tests() -> Self {
        Self::default()
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
        self.inner.lock().await.preferences.locale = locale;
        Ok(())
    }

    pub async fn set_time_zone(&self, time_zone: String) -> Result<(), SettingsError> {
        let trimmed = time_zone.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 64 {
            return Err(SettingsError::InvalidTimeZone);
        }
        self.inner.lock().await.preferences.time_zone = trimmed.to_string();
        Ok(())
    }

    pub async fn set_appearance(
        &self,
        appearance: AppearancePreferences,
    ) -> Result<(), SettingsError> {
        if !matches!(
            appearance.theme.as_str(),
            "system" | "light" | "dark" | "highContrast"
        ) || !matches!(appearance.font_size.as_str(), "sm" | "md" | "lg")
        {
            return Err(SettingsError::InvalidAppearance);
        }
        self.inner.lock().await.preferences.appearance = appearance;
        Ok(())
    }

    pub async fn set_notifications(
        &self,
        notifications: NotificationPreferences,
    ) -> Result<(), SettingsError> {
        self.inner.lock().await.preferences.notifications = notifications;
        Ok(())
    }

    pub async fn preferences(&self) -> UserPreferences {
        self.inner.lock().await.preferences.clone()
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
