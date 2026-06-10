use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_service::{
    ChannelDraft, ChannelService, PermissionPreset, WorkspaceMount,
};
use slei_daemon::services::message_service::{
    MessageService, SendMessageDraft, SendMessageOutcome,
};
use slei_daemon::state::AppState;
use slei_storage::db::SleiDb;
use slei_storage::repositories::Repositories;
use uuid::Uuid;

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

#[tokio::test]
async fn channel_chat_persists_channel_messages_across_restarts() {
    let root = std::env::temp_dir().join(format!("slei-channel-messages-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let database_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let db = SleiDb::connect(&database_url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());
    let service = MessageService::persistent(repos.clone());
    service.set_primary_agent_for_tests("channel_dev", "agent_coda");

    let outcome = service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human:local".to_string(),
                body: "hello persisted history".to_string(),
                as_task: false,
                workspace_count: 1,
            },
            "persist-send",
        )
        .await
        .unwrap();

    let restarted = MessageService::persistent(repos);
    let messages = restarted.channel_messages("channel_dev").await;
    assert!(messages.iter().any(|message| {
        message.id == outcome.message_id()
            && message.author_id == "human:local"
            && message.body.as_deref() == Some("hello persisted history")
    }));
}

#[tokio::test]
async fn channel_and_message_services_do_not_write_json_snapshots() {
    let root = std::env::temp_dir().join(format!("slei-no-channel-json-{}", Uuid::new_v4()));
    let state = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;

    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: Some("Dev".to_string()),
                permission: PermissionPreset::Controlled,
            },
            "channel-json-test",
        )
        .await
        .unwrap();
    state
        .messages()
        .create_human_channel_message("dev", "human:local", "hello", "message-json-test", false)
        .await
        .unwrap();

    assert!(!root.join("channels/index.json").exists());
    assert!(!root.join("channels/members.json").exists());
    assert!(!root.join("channels/workspaces.json").exists());
    assert!(!root.join("channels/messages.json").exists());
}

#[tokio::test]
async fn channel_create_replays_concurrent_same_idempotency_key() {
    let service = ChannelService::for_tests();

    let left = service.clone();
    let right = service.clone();
    let (first, second) = tokio::join!(
        left.create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: Some("Dev".to_string()),
                permission: PermissionPreset::Controlled,
            },
            "concurrent-channel-create",
        ),
        right.create_channel(
            ChannelDraft {
                name: "ignored".to_string(),
                description: Some("Ignored".to_string()),
                permission: PermissionPreset::ReadOnly,
            },
            "concurrent-channel-create",
        )
    );

    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(first.name, "dev");
    assert_eq!(service.list_channels().await.len(), 2);
}

#[tokio::test]
async fn human_channel_message_replays_concurrent_same_idempotency_key() {
    let service = MessageService::for_tests();

    let left = service.clone();
    let right = service.clone();
    let (first, second) = tokio::join!(
        left.create_human_channel_message(
            "dev",
            "human:local",
            "first body",
            "concurrent-human-message",
            false,
        ),
        right.create_human_channel_message(
            "dev",
            "human:local",
            "second body",
            "concurrent-human-message",
            true,
        )
    );

    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(first.body, second.body);
    assert_eq!(service.channel_messages("dev").await.len(), 1);
}

#[tokio::test]
async fn workspace_mount_replays_concurrent_same_idempotency_key() {
    let service = ChannelService::for_tests();
    let channel = service
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "workspace-mount-channel",
        )
        .await
        .unwrap();

    let left = service.clone();
    let right = service.clone();
    let channel_id = channel.id.clone();
    let (first, second) = tokio::join!(
        left.mount_workspace(
            &channel.id,
            WorkspaceMount {
                path: "/workspace/first".to_string(),
                label: "first".to_string(),
            },
            "concurrent-workspace-mount",
        ),
        right.mount_workspace(
            &channel_id,
            WorkspaceMount {
                path: "/workspace/second".to_string(),
                label: "second".to_string(),
            },
            "concurrent-workspace-mount",
        )
    );

    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first, second);
    assert_eq!(service.workspaces(&channel.id).await.unwrap().len(), 1);
}

#[tokio::test]
async fn send_message_replays_concurrent_same_idempotency_key() {
    let service = MessageService::for_tests();
    service.set_primary_agent_for_tests("dev", "agent_coda");

    let left = service.clone();
    let right = service.clone();
    let (first, second) = tokio::join!(
        left.send_message(
            SendMessageDraft {
                channel_id: "dev".to_string(),
                author_id: "human:local".to_string(),
                body: "first body".to_string(),
                as_task: false,
                workspace_count: 1,
            },
            "concurrent-send-message",
        ),
        right.send_message(
            SendMessageDraft {
                channel_id: "dev".to_string(),
                author_id: "human:local".to_string(),
                body: "second body".to_string(),
                as_task: true,
                workspace_count: 0,
            },
            "concurrent-send-message",
        )
    );

    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first.message_id(), second.message_id());
    assert_eq!(service.channel_messages("dev").await.len(), 1);
}

#[tokio::test]
async fn channel_messages_and_reconstructed_context_preserve_insert_order() {
    let service = MessageService::for_tests();

    for index in 0..20 {
        service
            .create_human_channel_message(
                "dev",
                "human:local",
                &format!("body-{index:02}"),
                &format!("ordered-message-{index:02}"),
                false,
            )
            .await
            .unwrap();
    }

    let bodies = service
        .channel_messages("dev")
        .await
        .into_iter()
        .map(|message| message.body.unwrap())
        .collect::<Vec<_>>();
    let expected = (0..20)
        .map(|index| format!("body-{index:02}"))
        .collect::<Vec<_>>();
    assert_eq!(bodies, expected);
    assert_eq!(
        service.reconstructed_context("dev").await,
        expected.join("\n")
    );
}
