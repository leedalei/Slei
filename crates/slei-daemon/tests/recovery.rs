use slei_daemon::services::message_service::{MessageService, SendMessageDraft};
use slei_daemon::{auth::AuthToken, state::AppState};
use uuid::Uuid;

#[tokio::test]
async fn deleted_message_body_is_not_recovered_into_events_context_or_subsequent_runs() {
    let service = MessageService::for_tests();
    service.set_primary_agent_for_tests("channel_dev", "agent_coda");
    let message_id = service
        .insert_human_for_tests("channel_dev", "human_lei", "remove this secret")
        .await;

    service.delete_human_message(&message_id).await.unwrap();

    assert_eq!(service.message(&message_id).await.unwrap().body, None);
    assert!(!service
        .event_payloads()
        .await
        .join("\n")
        .contains("remove this secret"));
    assert!(!service
        .reconstructed_context("channel_dev")
        .await
        .contains("remove this secret"));

    service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "new run".to_string(),
                as_task: false,
                workspace_count: 1,
            },
            "after-delete-run",
        )
        .await
        .unwrap();
    assert!(!service
        .reconstructed_context("channel_dev")
        .await
        .contains("remove this secret"));
}

#[tokio::test]
async fn recovery_channel_message_idempotency_survives_daemon_reload() {
    let root = temp_data_root();
    let token = AuthToken::from_static("message-idempotency-reload-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;

    let message = state
        .messages()
        .create_human_channel_message("all", "human:local", "hello", "idem-message", false)
        .await
        .expect("message is created");

    let reloaded = AppState::for_tests_with_agent_root_async(token, root).await;
    let replayed = reloaded
        .messages()
        .create_human_channel_message("all", "human:local", "hello", "idem-message", false)
        .await
        .expect("message idempotency replays after reload");

    assert_eq!(replayed.id, message.id);
}

fn temp_data_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("slei-recovery-{}", Uuid::new_v4()))
}
