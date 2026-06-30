use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
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
async fn settings_profile_create_survives_app_state_reload_without_update() {
    let root = temp_data_root();
    let token = AuthToken::from_static("settings-profile-reload-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;

    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();

    let reloaded = AppState::for_tests_with_agent_root_async(token, root.clone()).await;
    let profile = reloaded.settings().profile().await.unwrap().unwrap();
    assert_eq!(profile.nickname, "Lei");
    assert_eq!(profile.handle, "lei");
    assert_eq!(profile.avatar_url.as_deref(), Some("pixel-sun"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn settings_profile_read_does_not_return_stale_memory_after_repository_clear() {
    let root = temp_data_root();
    let token = AuthToken::from_static("settings-profile-clear-token");
    let state = AppState::for_tests_with_agent_root_async(token, root.clone()).await;

    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();
    assert!(state.settings().profile().await.unwrap().is_some());

    let database_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let pool = sqlx::SqlitePool::connect(&database_url).await.unwrap();
    sqlx::query("DELETE FROM user_profiles")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    assert!(state.settings().profile().await.unwrap().is_none());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn settings_profile_read_surfaces_repository_errors() {
    let root = temp_data_root();
    let token = AuthToken::from_static("settings-profile-storage-error-token");
    let state = AppState::for_tests_with_agent_root_async(token, root.clone()).await;

    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();

    let database_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let pool = sqlx::SqlitePool::connect(&database_url).await.unwrap();
    sqlx::query("DROP TABLE user_profiles")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    let error = state.settings().profile().await.unwrap_err();
    assert!(error.to_string().contains("settings storage error"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn settings_profile_api_requires_auth_round_trips_and_rejects_handle_patch() {
    let token = AuthToken::from_static("settings-profile-token");
    let state = AppState::for_tests(token.clone());
    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();
    let app = build_router(state);

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/settings/profile")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let unauthorized_patch = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/settings/profile")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"displayName":"Lei Lee"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized_patch.status(), StatusCode::UNAUTHORIZED);

    let updated = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"Lei Lee","avatar":"pixel-moon"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);

    let body = to_bytes(updated.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["profile"]["displayName"], "Lei Lee");
    assert_eq!(json["profile"]["avatar"], "pixel-moon");
    assert_eq!(json["profile"]["handle"], "lei");

    let fetched = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    let body = to_bytes(fetched.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["profile"]["displayName"], "Lei Lee");
    assert_eq!(json["profile"]["avatar"], "pixel-moon");
    assert_eq!(json["profile"]["handle"], "lei");

    let handle_patch = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"handle":"other"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(handle_patch.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn settings_profile_api_returns_null_and_rejects_patch_when_profile_missing() {
    let token = AuthToken::from_static("settings-profile-missing-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let fetched = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    let body = to_bytes(fetched.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert!(json["profile"].is_null());

    let patched = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"displayName":"Lei"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patched.status(), StatusCode::NOT_FOUND);
    let body = to_bytes(patched.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert!(json["error"]
        .as_str()
        .unwrap()
        .contains("profile unavailable"));

    let fetched_after_patch = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fetched_after_patch.status(), StatusCode::OK);
    let body = to_bytes(fetched_after_patch.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert!(json["profile"].is_null());
}

#[tokio::test]
async fn settings_profile_avatar_image_upload_persists_reference_and_file() {
    let root = temp_data_root();
    let token = AuthToken::from_static("avatar-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();
    let app = build_router(state);

    let uploaded = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/settings/profile/avatar-image")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "fileName": "avatar.png",
                        "mimeType": "image/png",
                        "bytesBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = uploaded.status();
    let body = to_bytes(uploaded.into_body(), usize::MAX).await.unwrap();
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let json: Value = serde_json::from_slice(&body).unwrap();
    let avatar = json["profile"]["avatar"].as_str().unwrap();
    assert!(avatar.starts_with("profile-image:"));
    assert!(avatar.ends_with(".png"));
    let file_name = avatar.strip_prefix("profile-image:").unwrap();
    assert!(root
        .join("profile")
        .join("avatars")
        .join(file_name)
        .exists());

    let reloaded = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    let reloaded_app = build_router(reloaded);
    let fetched = reloaded_app
        .oneshot(
            Request::builder()
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    let body = to_bytes(fetched.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["profile"]["avatar"], avatar);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn settings_profile_avatar_image_upload_rejects_invalid_inputs() {
    let root = temp_data_root();
    let token = AuthToken::from_static("avatar-invalid-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();
    let app = build_router(state);

    let oversized_decoded_bytes = "A".repeat((2 * 1024 * 1024 + 1) * 4 / 3 + 4);
    let cases = [
        (
            "mime extension mismatch",
            "avatar.jpg",
            "image/png",
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=".to_string(),
        ),
        (
            "text plain",
            "avatar.txt",
            "text/plain",
            "aGVsbG8=".to_string(),
        ),
        ("empty bytes", "avatar.png", "image/png", String::new()),
        (
            "decoded bytes over limit",
            "avatar.png",
            "image/png",
            oversized_decoded_bytes,
        ),
        (
            "image dimensions over limit",
            "avatar.png",
            "image/png",
            "iVBORw0KGgoAAAANSUhEUgAACAEAAAABCAYAAACl1iXMAAAAIUlEQVR42u3DAQkAAAwEoetfesvxoGDVqaqqqqqqqqr7H4NV+WnuBjSPAAAAAElFTkSuQmCC".to_string(),
        ),
    ];

    for (name, file_name, mime_type, bytes_base64) in cases {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/settings/profile/avatar-image")
                    .header("authorization", token.authorization_header())
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "fileName": file_name,
                            "mimeType": mime_type,
                            "bytesBase64": bytes_base64
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{name}");
    }

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn settings_profile_patch_rejects_malformed_profile_image_refs() {
    let token = AuthToken::from_static("settings-profile-image-ref-token");
    let state = AppState::for_tests(token.clone());
    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();
    let app = build_router(state);

    for avatar in [
        "profile-image:../x.png",
        "profile-image:nothex.png",
        "profile-image:/tmp/x.png",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/v1/settings/profile")
                    .header("authorization", token.authorization_header())
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "avatar": avatar }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{avatar}");
    }
}

#[tokio::test]
async fn settings_profile_api_get_returns_error_on_profile_storage_failure() {
    let root = temp_data_root();
    let token = AuthToken::from_static("settings-profile-api-storage-error-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();

    let database_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let pool = sqlx::SqlitePool::connect(&database_url).await.unwrap();
    sqlx::query("DROP TABLE user_profiles")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert!(json["error"]
        .as_str()
        .unwrap()
        .contains("settings storage error"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn settings_profile_api_patch_returns_error_on_profile_storage_failure() {
    let root = temp_data_root();
    let token = AuthToken::from_static("settings-profile-api-patch-storage-error-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();

    let database_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let pool = sqlx::SqlitePool::connect(&database_url).await.unwrap();
    sqlx::query("DROP TABLE user_profiles")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"displayName":"Lei Lee"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert!(json["error"]
        .as_str()
        .unwrap()
        .contains("settings storage error"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn settings_profile_rejects_invalid_display_name_and_avatar_field_errors() {
    let service = SettingsService::for_tests();
    service
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();

    let display_name_error = service
        .update_profile(Some("   ".to_string()), None)
        .await
        .unwrap_err();
    assert!(display_name_error.to_string().contains("displayName"));

    let avatar_error = service
        .update_profile(None, Some("not-a-preset".to_string()))
        .await
        .unwrap_err();
    assert!(avatar_error.to_string().contains("avatar"));
}

#[tokio::test]
async fn settings_profile_create_rejects_invalid_display_name_and_avatar_field_errors() {
    let service = SettingsService::for_tests();

    let display_name_error = service
        .create_profile(ProfileDraft {
            nickname: "   ".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap_err();
    assert!(display_name_error.to_string().contains("displayName"));

    let avatar_error = service
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("not-a-preset".to_string()),
        })
        .await
        .unwrap_err();
    assert!(avatar_error.to_string().contains("avatar"));
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
