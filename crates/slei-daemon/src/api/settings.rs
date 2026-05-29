use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::services::settings_service::{
    AppearancePreferences, LocalePreference, NotificationPreferences, UserPreferences,
};
use crate::state::AppState;

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
