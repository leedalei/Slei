use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::services::settings_service::{
    AppearancePreferences, AvatarImageUpload, LocalePreference, NotificationPreferences,
    SettingsError, UserPreferences, UserProfile,
};
use crate::state::AppState;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserProfileView {
    display_name: String,
    handle: String,
    avatar: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserPreferencesView {
    locale: String,
    time_zone: String,
    appearance: AppearancePreferencesView,
    notifications: NotificationPreferencesView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppearancePreferencesView {
    theme: String,
    font_size: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationPreferencesView {
    mentions: bool,
    human_replies: bool,
    approvals: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesUpdateRequest {
    locale: Option<String>,
    time_zone: Option<String>,
    appearance: Option<AppearancePreferencesView>,
    notifications: Option<NotificationPreferencesView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdateRequest {
    display_name: Option<String>,
    avatar: Option<String>,
    handle: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAvatarImageUploadRequest {
    file_name: String,
    mime_type: String,
    bytes_base64: String,
}

pub async fn get_profile(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let profile = match state.settings().profile().await {
        Ok(profile) => profile,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    };
    let Some(profile) = profile else {
        return Json(json!({ "profile": null })).into_response();
    };
    Json(json!({ "profile": UserProfileView::from(profile) })).into_response()
}

pub async fn upload_profile_avatar_image(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ProfileAvatarImageUploadRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };
    let bytes = match decode_base64(&payload.bytes_base64) {
        Ok(bytes) => bytes,
        Err(()) => return error_response(StatusCode::BAD_REQUEST, "invalid avatar image"),
    };

    match state
        .settings()
        .upload_avatar_image(AvatarImageUpload {
            file_name: payload.file_name,
            mime_type: payload.mime_type,
            bytes,
            data_root: state.data_root().clone(),
        })
        .await
    {
        Ok(profile) => Json(json!({ "profile": UserProfileView::from(profile) })).into_response(),
        Err(SettingsError::ProfileUnavailable) => {
            error_response(StatusCode::NOT_FOUND, "profile unavailable")
        }
        Err(error @ SettingsError::Storage(_)) => {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    }
}

pub async fn update_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ProfileUpdateRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if payload.handle.is_some() {
        return error_response(StatusCode::BAD_REQUEST, "handle is immutable");
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };
    match state
        .settings()
        .update_profile(payload.display_name, payload.avatar)
        .await
    {
        Ok(profile) => Json(json!({ "profile": UserProfileView::from(profile) })).into_response(),
        Err(SettingsError::ProfileUnavailable) => {
            error_response(StatusCode::NOT_FOUND, "profile unavailable")
        }
        Err(error @ SettingsError::Storage(_)) => {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    }
}

pub async fn get_preferences(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let preferences = state.settings().preferences().await;
    Json(json!({ "preferences": UserPreferencesView::from(preferences) })).into_response()
}

pub async fn update_preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PreferencesUpdateRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    if let Some(locale) = payload.locale {
        let Ok(locale) = parse_locale(&locale) else {
            return error_response(StatusCode::BAD_REQUEST, "invalid locale");
        };
        if let Err(error) = state.settings().set_locale(locale).await {
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
    }

    if let Some(time_zone) = payload.time_zone {
        if let Err(error) = state.settings().set_time_zone(time_zone).await {
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
    }

    if let Some(appearance) = payload.appearance {
        if let Err(error) = state
            .settings()
            .set_appearance(AppearancePreferences::from(appearance))
            .await
        {
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
    }

    if let Some(notifications) = payload.notifications {
        if let Err(error) = state
            .settings()
            .set_notifications(NotificationPreferences::from(notifications))
            .await
        {
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
    }

    let preferences = state.settings().preferences().await;
    Json(json!({ "preferences": UserPreferencesView::from(preferences) })).into_response()
}

fn parse_locale(locale: &str) -> Result<LocalePreference, ()> {
    match locale {
        "zh-CN" => Ok(LocalePreference::ZhCn),
        "en-US" => Ok(LocalePreference::EnUs),
        _ => Err(()),
    }
}

fn locale_string(locale: LocalePreference) -> String {
    match locale {
        LocalePreference::ZhCn => "zh-CN".to_string(),
        LocalePreference::EnUs => "en-US".to_string(),
    }
}

fn decode_base64(input: &str) -> Result<Vec<u8>, ()> {
    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u8;
    for byte in input.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(()),
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Ok(output)
}

impl From<UserProfile> for UserProfileView {
    fn from(profile: UserProfile) -> Self {
        Self {
            display_name: profile.nickname,
            handle: profile.handle,
            avatar: profile.avatar_url.unwrap_or_default(),
        }
    }
}

impl From<UserPreferences> for UserPreferencesView {
    fn from(preferences: UserPreferences) -> Self {
        Self {
            locale: locale_string(preferences.locale),
            time_zone: preferences.time_zone,
            appearance: AppearancePreferencesView::from(preferences.appearance),
            notifications: NotificationPreferencesView::from(preferences.notifications),
        }
    }
}

impl From<AppearancePreferences> for AppearancePreferencesView {
    fn from(preferences: AppearancePreferences) -> Self {
        Self {
            theme: preferences.theme,
            font_size: preferences.font_size,
        }
    }
}

impl From<AppearancePreferencesView> for AppearancePreferences {
    fn from(preferences: AppearancePreferencesView) -> Self {
        Self {
            theme: preferences.theme,
            font_size: preferences.font_size,
        }
    }
}

impl From<NotificationPreferences> for NotificationPreferencesView {
    fn from(preferences: NotificationPreferences) -> Self {
        Self {
            mentions: preferences.mentions,
            human_replies: preferences.human_replies,
            approvals: preferences.approvals,
        }
    }
}

impl From<NotificationPreferencesView> for NotificationPreferences {
    fn from(preferences: NotificationPreferencesView) -> Self {
        Self {
            mentions: preferences.mentions,
            human_replies: preferences.human_replies,
            approvals: preferences.approvals,
        }
    }
}

fn error_response(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({ "error": error }))).into_response()
}
