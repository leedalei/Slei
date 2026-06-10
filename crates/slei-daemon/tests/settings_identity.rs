use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::notification_service::NotificationService;
use slei_daemon::services::settings_service::{
    AppearancePreferences, LocalePreference, NotificationPreferences, ProfileDraft, SettingsService,
};
use slei_daemon::state::AppState;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn settings_identity_creates_single_profile_and_rejects_handle_mutation() {
    let service = SettingsService::for_tests();

    let profile = service
        .create_profile(ProfileDraft {
            nickname: "Lei Lee".to_string(),
            handle: "lei-lee".to_string(),
            bio: Some("builder".to_string()),
            avatar_url: None,
        })
        .await
        .unwrap();
    assert_eq!(profile.handle, "lei-lee");

    let duplicate = service
        .create_profile(ProfileDraft {
            nickname: "Other".to_string(),
            handle: "other".to_string(),
            bio: None,
            avatar_url: None,
        })
        .await;
    assert!(duplicate
        .unwrap_err()
        .to_string()
        .contains("already exists"));

    let renamed = service.update_handle("new-handle").await;
    assert!(renamed.unwrap_err().to_string().contains("immutable"));
}

#[tokio::test]
async fn settings_identity_rejects_invalid_handle_and_round_trips_preferences() {
    let service = SettingsService::for_tests();

    let invalid = service
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "Bad Handle!".to_string(),
            bio: None,
            avatar_url: None,
        })
        .await;
    assert!(invalid.unwrap_err().to_string().contains("invalid handle"));

    service
        .set_locale(LocalePreference::EnUs)
        .await
        .expect("locale saves");
    service
        .set_notifications(NotificationPreferences {
            mentions: true,
            human_replies: false,
            approvals: true,
        })
        .await
        .expect("notifications save");

    assert_eq!(service.preferences().await.locale, LocalePreference::EnUs);
    assert!(service.preferences().await.notifications.mentions);
    assert!(!service.preferences().await.notifications.human_replies);
    assert!(service.preferences().await.notifications.approvals);
}

#[tokio::test]
async fn settings_preferences_api_requires_auth_and_round_trips_locale_notifications() {
    let token = AuthToken::from_static("settings-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/settings/preferences")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let updated = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/settings/preferences")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"locale":"en-US","notifications":{"mentions":true,"humanReplies":false,"approvals":true}}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);

    let fetched = app
        .oneshot(
            Request::builder()
                .uri("/v1/settings/preferences")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    let body = to_bytes(fetched.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["preferences"]["locale"], "en-US");
    assert_eq!(json["preferences"]["notifications"]["mentions"], true);
    assert_eq!(json["preferences"]["notifications"]["humanReplies"], false);
    assert_eq!(json["preferences"]["notifications"]["approvals"], true);
    assert!(
        serde_json::to_string(&json)
            .unwrap()
            .contains("settings-token")
            == false
    );
}

#[tokio::test]
async fn notification_preferences_gate_notification_service_categories() {
    let settings = SettingsService::for_tests();
    let notifications = NotificationService::for_tests_with_settings(settings.clone());

    settings
        .set_notifications(NotificationPreferences {
            mentions: false,
            human_replies: true,
            approvals: false,
        })
        .await
        .expect("notification preferences save");

    notifications
        .notify_mention("task_mentions", "human_lei", "@lei-lee 看这里")
        .await;
    notifications
        .notify_human_attention("task_approval", "human_lei", "需要审批")
        .await;
    notifications
        .notify_human_reply("task_reply", "human_lei", "Lei 回复了")
        .await;

    let entries = notifications.list_for_user("human_lei").await;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].task_id, "task_reply");
}

#[tokio::test]
async fn settings_preferences_survive_app_state_reload_without_legacy_json_file() {
    let root = temp_data_root();
    let token = AuthToken::from_static("settings-reload-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;

    state
        .settings()
        .set_locale(LocalePreference::EnUs)
        .await
        .expect("locale saves");
    state
        .settings()
        .set_time_zone("America/Los_Angeles".to_string())
        .await
        .expect("time zone saves");
    state
        .settings()
        .set_appearance(AppearancePreferences {
            theme: "dark".to_string(),
            font_size: "lg".to_string(),
        })
        .await
        .expect("appearance saves");
    state
        .settings()
        .set_notifications(NotificationPreferences {
            mentions: false,
            human_replies: true,
            approvals: false,
        })
        .await
        .expect("notifications save");

    let reloaded = AppState::for_tests_with_agent_root_async(token, root.clone()).await;
    let preferences = reloaded.settings().preferences().await;

    assert_eq!(preferences.locale, LocalePreference::EnUs);
    assert_eq!(preferences.time_zone, "America/Los_Angeles");
    assert_eq!(preferences.appearance.theme, "dark");
    assert_eq!(preferences.appearance.font_size, "lg");
    assert!(!preferences.notifications.mentions);
    assert!(preferences.notifications.human_replies);
    assert!(!preferences.notifications.approvals);
    assert!(!root.join("settings/preferences.json").exists());
}

#[tokio::test]
async fn settings_partial_update_after_reload_preserves_persisted_preferences() {
    let root = temp_data_root();
    let token = AuthToken::from_static("settings-partial-reload-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;

    state
        .settings()
        .set_locale(LocalePreference::EnUs)
        .await
        .expect("locale saves");
    state
        .settings()
        .set_appearance(AppearancePreferences {
            theme: "highContrast".to_string(),
            font_size: "lg".to_string(),
        })
        .await
        .expect("appearance saves");
    state
        .settings()
        .set_notifications(NotificationPreferences {
            mentions: false,
            human_replies: false,
            approvals: false,
        })
        .await
        .expect("notifications save");

    let reloaded = AppState::for_tests_with_agent_root_async(token, root).await;
    reloaded
        .settings()
        .set_time_zone("Europe/Berlin".to_string())
        .await
        .expect("time zone saves without loading preferences first");
    let preferences = reloaded.settings().preferences().await;

    assert_eq!(preferences.locale, LocalePreference::EnUs);
    assert_eq!(preferences.time_zone, "Europe/Berlin");
    assert_eq!(preferences.appearance.theme, "highContrast");
    assert_eq!(preferences.appearance.font_size, "lg");
    assert!(!preferences.notifications.mentions);
    assert!(!preferences.notifications.human_replies);
    assert!(!preferences.notifications.approvals);
}

fn temp_data_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("slei-settings-{}", Uuid::new_v4()))
}
