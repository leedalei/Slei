use slei_daemon::services::settings_service::{
    LocalePreference, NotificationPreferences, ProfileDraft, SettingsService,
};

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
