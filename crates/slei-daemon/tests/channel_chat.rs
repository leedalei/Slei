use slei_daemon::services::message_service::{
    MessageService, SendMessageDraft, SendMessageOutcome,
};

#[tokio::test]
async fn channel_chat_routes_messages_to_primary_explicit_agent_or_human_notification() {
    let service = MessageService::for_tests();
    service.set_primary_agent_for_tests("channel_dev", "agent_coda");
    service.add_agent_for_tests("alice", "agent_alice");

    let primary = service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "请看一下".to_string(),
                as_task: false,
                workspace_count: 1,
            },
            "send-1",
        )
        .await
        .unwrap();
    assert!(matches!(
        primary,
        SendMessageOutcome::AgentRun {
            agent_id,
            restricted_no_workspace: false,
            ..
        } if agent_id == "agent_coda"
    ));

    let explicit = service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "@alice 帮我评审".to_string(),
                as_task: false,
                workspace_count: 1,
            },
            "send-2",
        )
        .await
        .unwrap();
    assert!(matches!(
        explicit,
        SendMessageOutcome::AgentRun { agent_id, .. } if agent_id == "agent_alice"
    ));

    let human = service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "@lei-lee 看这里".to_string(),
                as_task: false,
                workspace_count: 1,
            },
            "send-3",
        )
        .await
        .unwrap();
    assert!(matches!(
        human,
        SendMessageOutcome::HumanNotification { .. }
    ));
}

#[tokio::test]
async fn channel_chat_deletes_human_body_and_retries_send_idempotently() {
    let service = MessageService::for_tests();
    service.set_primary_agent_for_tests("channel_dev", "agent_coda");
    let sentinel = "SENTINEL_CHAT_DELETE";

    let first = service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: sentinel.to_string(),
                as_task: false,
                workspace_count: 0,
            },
            "send-delete",
        )
        .await
        .unwrap();
    let retry = service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "ignored".to_string(),
                as_task: false,
                workspace_count: 0,
            },
            "send-delete",
        )
        .await
        .unwrap();
    assert_eq!(first.message_id(), retry.message_id());

    let message_id = first.message_id();
    service.delete_human_message(&message_id).await.unwrap();
    let context = service.reconstructed_context("channel_dev").await;
    let events = service.event_payloads().await.join("\n");

    assert!(!context.contains(sentinel));
    assert!(!events.contains(sentinel));
    assert!(service.message(&message_id).await.unwrap().deleted);
    assert!(matches!(
        first,
        SendMessageOutcome::AgentRun {
            restricted_no_workspace: true,
            ..
        }
    ));
}
