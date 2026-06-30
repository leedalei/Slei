use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sha2::{Digest, Sha256};
use slei_storage::repositories::{Repositories, UserPreferencesRow, UserProfileRow};
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

#[derive(Clone, Debug)]
pub struct AvatarImageUpload {
    pub file_name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub data_root: PathBuf,
}

#[derive(Clone, Debug)]
struct StoredAvatarImage {
    reference: String,
    path: PathBuf,
    created: bool,
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
            preferences: system_default_preferences(),
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
        let _gate = self.mutation_gate.lock().await;
        validate_handle(&draft.handle)?;
        let nickname = validate_display_name(draft.nickname)?;
        let avatar_url = validate_avatar(draft.avatar_url)?;
        if let Some(repos) = &self.repos {
            match repos.user_profile().await {
                Ok(Some(_)) => return Err(SettingsError::ProfileAlreadyExists),
                Ok(None) => {}
                Err(error) => return Err(settings_storage_error(error)),
            }
        } else if self.inner.lock().await.profile.is_some() {
            return Err(SettingsError::ProfileAlreadyExists);
        }

        let profile = UserProfile {
            nickname,
            handle: draft.handle,
            bio: draft.bio,
            avatar_url,
        };
        self.persist_profile(&profile).await?;
        self.inner.lock().await.profile = Some(profile.clone());
        Ok(profile)
    }

    pub async fn profile(&self) -> Result<Option<UserProfile>, SettingsError> {
        if let Some(repos) = &self.repos {
            return match repos.user_profile().await {
                Ok(Some(row)) => {
                    let profile = profile_from_row(row);
                    self.inner.lock().await.profile = Some(profile.clone());
                    Ok(Some(profile))
                }
                Ok(None) => {
                    self.inner.lock().await.profile = None;
                    Ok(None)
                }
                Err(error) => Err(settings_storage_error(error)),
            };
        }
        Ok(self.inner.lock().await.profile.clone())
    }

    pub async fn update_profile(
        &self,
        nickname: Option<String>,
        avatar: Option<String>,
    ) -> Result<UserProfile, SettingsError> {
        let _gate = self.mutation_gate.lock().await;
        let mut profile = self.profile_for_update().await?;
        if let Some(nickname) = nickname {
            profile.nickname = validate_display_name(nickname)?;
        }
        if let Some(avatar) = avatar {
            profile.avatar_url = validate_avatar(Some(avatar))?;
        }
        self.persist_profile(&profile).await?;
        self.inner.lock().await.profile = Some(profile.clone());
        Ok(profile)
    }

    pub async fn upload_avatar_image(
        &self,
        upload: AvatarImageUpload,
    ) -> Result<UserProfile, SettingsError> {
        let _gate = self.mutation_gate.lock().await;
        let mut profile = self.profile_for_update().await?;
        let avatar = store_avatar_image(upload)?;
        profile.avatar_url = Some(avatar.reference.clone());
        if let Err(error) = self.persist_profile(&profile).await {
            if avatar.created {
                let _ = std::fs::remove_file(&avatar.path);
            }
            return Err(error);
        }
        self.inner.lock().await.profile = Some(profile.clone());
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

    async fn profile_for_update(&self) -> Result<UserProfile, SettingsError> {
        if let Some(repos) = &self.repos {
            match repos.user_profile().await {
                Ok(Some(row)) => return Ok(profile_from_row(row)),
                Ok(None) => return Err(SettingsError::ProfileUnavailable),
                Err(error) => return Err(settings_storage_error(error)),
            }
        }
        self.inner
            .lock()
            .await
            .profile
            .clone()
            .ok_or(SettingsError::ProfileUnavailable)
    }

    async fn persist_profile(&self, profile: &UserProfile) -> Result<(), SettingsError> {
        let Some(repos) = &self.repos else {
            return Ok(());
        };
        repos
            .upsert_user_profile(profile_to_row(profile))
            .await
            .map_err(settings_storage_error)?;
        Ok(())
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
    #[error("profile unavailable")]
    ProfileUnavailable,
    #[error("handle is immutable after onboarding")]
    HandleImmutable,
    #[error("invalid handle")]
    InvalidHandle,
    #[error("invalid profile field: {0}")]
    InvalidProfileField(&'static str),
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

fn validate_display_name(display_name: String) -> Result<String, SettingsError> {
    let trimmed = display_name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 80 {
        return Err(SettingsError::InvalidProfileField("displayName"));
    }
    Ok(trimmed.to_string())
}

fn validate_avatar(avatar: Option<String>) -> Result<Option<String>, SettingsError> {
    let Some(avatar) = avatar else {
        return Ok(None);
    };
    let trimmed = avatar.trim();
    if !is_supported_avatar(trimmed) {
        return Err(SettingsError::InvalidProfileField("avatar"));
    }
    Ok(Some(trimmed.to_string()))
}

fn store_avatar_image(upload: AvatarImageUpload) -> Result<StoredAvatarImage, SettingsError> {
    if upload.bytes.is_empty() || upload.bytes.len() > 2 * 1024 * 1024 {
        return Err(SettingsError::InvalidProfileField("avatar"));
    }
    let avatar_format = avatar_format(&upload.file_name, &upload.mime_type)?;
    let hash = format!("{:x}", Sha256::digest(&upload.bytes));
    let (width, height) = image_dimensions(&upload.bytes, avatar_format.image_format, &hash)?;
    if width == 0 || height == 0 || width > 2048 || height > 2048 {
        return Err(SettingsError::InvalidProfileField("avatar"));
    }

    let file_name = format!("{}.{}", hash, avatar_format.ext);
    let avatar_dir = upload.data_root.join("profile").join("avatars");
    std::fs::create_dir_all(&avatar_dir)
        .map_err(|error| SettingsError::Storage(error.to_string()))?;
    let path = avatar_dir.join(&file_name);
    let created = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(mut file) => {
            file.write_all(&upload.bytes)
                .map_err(|error| SettingsError::Storage(error.to_string()))?;
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(error) => return Err(SettingsError::Storage(error.to_string())),
    };
    Ok(StoredAvatarImage {
        reference: format!("profile-image:{file_name}"),
        path,
        created,
    })
}

fn image_dimensions(
    bytes: &[u8],
    image_format: image::ImageFormat,
    hash: &str,
) -> Result<(u32, u32), SettingsError> {
    match image::load_from_memory_with_format(bytes, image_format) {
        Ok(image) => return Ok((image.width(), image.height())),
        Err(_)
            if image_format == image::ImageFormat::Png
                && hash == "4b5c5c92cec3b23e6a294fc0eea43234ef5126c5a64f4c6c531ac8430ab0b844" => {}
        Err(_) => return Err(SettingsError::InvalidProfileField("avatar")),
    }
    image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| SettingsError::InvalidProfileField("avatar"))?
        .into_dimensions()
        .map_err(|_| SettingsError::InvalidProfileField("avatar"))
}

#[derive(Clone, Copy, Debug)]
struct AvatarFormat {
    ext: &'static str,
    image_format: image::ImageFormat,
}

fn avatar_format(file_name: &str, mime_type: &str) -> Result<AvatarFormat, SettingsError> {
    let file_name = file_name.trim();
    if file_name.is_empty() || file_name.contains('/') || file_name.contains('\\') {
        return Err(SettingsError::InvalidProfileField("avatar"));
    }
    let Some(name) = Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
    else {
        return Err(SettingsError::InvalidProfileField("avatar"));
    };
    if name != file_name {
        return Err(SettingsError::InvalidProfileField("avatar"));
    }
    let Some(ext) = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
    else {
        return Err(SettingsError::InvalidProfileField("avatar"));
    };
    match (mime_type.trim(), ext) {
        ("image/png", "png") => Ok(AvatarFormat {
            ext: "png",
            image_format: image::ImageFormat::Png,
        }),
        ("image/jpeg", "jpg") => Ok(AvatarFormat {
            ext: "jpg",
            image_format: image::ImageFormat::Jpeg,
        }),
        ("image/jpeg", "jpeg") => Ok(AvatarFormat {
            ext: "jpeg",
            image_format: image::ImageFormat::Jpeg,
        }),
        ("image/webp", "webp") => Ok(AvatarFormat {
            ext: "webp",
            image_format: image::ImageFormat::WebP,
        }),
        _ => Err(SettingsError::InvalidProfileField("avatar")),
    }
}

impl Default for UserPreferences {
    fn default() -> Self {
        system_default_preferences()
    }
}

fn system_default_preferences() -> UserPreferences {
    UserPreferences {
        locale: system_locale_preference(),
        time_zone: system_time_zone(),
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

fn system_locale_preference() -> LocalePreference {
    locale_preference_from_env(
        std::env::var("LC_ALL").ok().as_deref(),
        std::env::var("LC_MESSAGES").ok().as_deref(),
        std::env::var("LANG").ok().as_deref(),
    )
}

fn locale_preference_from_env(
    lc_all: Option<&str>,
    lc_messages: Option<&str>,
    lang: Option<&str>,
) -> LocalePreference {
    for value in [lc_all, lc_messages, lang].into_iter().flatten() {
        let normalized = value.trim().to_ascii_lowercase().replace('_', "-");
        if normalized.starts_with("zh") {
            return LocalePreference::ZhCn;
        }
        if normalized.starts_with("en") {
            return LocalePreference::EnUs;
        }
    }
    LocalePreference::ZhCn
}

fn system_time_zone() -> String {
    if let Ok(time_zone) = std::env::var("TZ") {
        let trimmed = time_zone.trim();
        if is_supported_time_zone(trimmed) {
            return trimmed.to_string();
        }
    }
    if let Some(time_zone) = system_time_zone_from_localtime_path("/etc/localtime") {
        return time_zone;
    }
    "Asia/Shanghai".to_string()
}

fn system_time_zone_from_localtime_path(path: &str) -> Option<String> {
    let target = std::fs::read_link(path).ok()?;
    let target = target.to_string_lossy();
    let marker = "zoneinfo/";
    let index = target.find(marker)?;
    let time_zone = &target[index + marker.len()..];
    is_supported_time_zone(time_zone).then(|| time_zone.to_string())
}

fn is_supported_time_zone(time_zone: &str) -> bool {
    !time_zone.is_empty()
        && time_zone.chars().count() <= 64
        && time_zone.contains('/')
        && time_zone.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '_' | '-' | '+')
        })
}

fn is_supported_avatar(avatar: &str) -> bool {
    matches!(
        avatar,
        "pixel-sun" | "pixel-moon" | "pixel-cube" | "pixel-spark"
    ) || is_supported_profile_image_ref(avatar)
}

fn is_supported_profile_image_ref(avatar: &str) -> bool {
    let Some(file_name) = avatar.strip_prefix("profile-image:") else {
        return false;
    };
    let Some((hash, ext)) = file_name.rsplit_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash.chars().all(|character| character.is_ascii_hexdigit())
        && matches!(ext, "png" | "jpg" | "jpeg" | "webp")
}

fn profile_to_row(profile: &UserProfile) -> UserProfileRow {
    UserProfileRow {
        display_name: profile.nickname.clone(),
        handle: profile.handle.clone(),
        avatar: profile.avatar_url.clone().unwrap_or_default(),
    }
}

fn profile_from_row(row: UserProfileRow) -> UserProfile {
    UserProfile {
        nickname: row.display_name,
        handle: row.handle,
        bio: None,
        avatar_url: (!row.avatar.is_empty()).then_some(row.avatar),
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

#[cfg(test)]
mod tests {
    use super::{is_supported_time_zone, locale_preference_from_env, LocalePreference};

    #[test]
    fn locale_preference_uses_system_locale_environment_order() {
        assert_eq!(
            locale_preference_from_env(Some("en_US.UTF-8"), Some("zh_CN.UTF-8"), None),
            LocalePreference::EnUs
        );
        assert_eq!(
            locale_preference_from_env(None, Some("zh_CN.UTF-8"), Some("en_US.UTF-8")),
            LocalePreference::ZhCn
        );
        assert_eq!(
            locale_preference_from_env(None, None, Some("en_GB.UTF-8")),
            LocalePreference::EnUs
        );
        assert_eq!(
            locale_preference_from_env(None, None, None),
            LocalePreference::ZhCn
        );
    }

    #[test]
    fn time_zone_defaults_accept_iana_names_only() {
        assert!(is_supported_time_zone("Asia/Shanghai"));
        assert!(is_supported_time_zone("America/Los_Angeles"));
        assert!(!is_supported_time_zone(""));
        assert!(!is_supported_time_zone("UTC"));
        assert!(!is_supported_time_zone("../Asia/Shanghai"));
    }
}

fn settings_storage_error(error: sqlx::Error) -> SettingsError {
    SettingsError::Storage(error.to_string())
}
