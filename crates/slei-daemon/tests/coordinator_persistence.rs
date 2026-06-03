use slei_storage::db::SleiDb;
use slei_storage::repositories::Repositories;
use uuid::Uuid;

#[tokio::test]
async fn coordinator_internal_events_survive_restart() {
    let db_path = std::env::temp_dir().join(format!("slei-coordinator-{}.sqlite", Uuid::new_v4()));
    let database_url = format!("sqlite://{}", db_path.display());
    let channel_id = "dev";
    let message_id = "msg_1";
    let decision_id = Uuid::new_v4();

    {
        let db = SleiDb::connect(&database_url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        repos
            .insert_channel_coordinator(channel_id, "deterministic_v1", true)
            .await
            .unwrap();
        repos
            .insert_coordinator_decision(
                decision_id,
                channel_id,
                message_id,
                "task_command",
                "create_task_and_assign",
                Some("agent_alice"),
                "needs architecture",
            )
            .await
            .unwrap();
        repos
            .insert_agent_inbox_event(
                Uuid::new_v4(),
                "agent_alice",
                "task_assigned",
                "pending",
                r#"{"taskId":"task_1"}"#,
            )
            .await
            .unwrap();
        repos
            .insert_routing_context_package(
                Uuid::new_v4(),
                decision_id,
                message_id,
                r#"{"currentMessageId":"msg_1"}"#,
                false,
            )
            .await
            .unwrap();
        repos
            .insert_memory_update_event(
                Uuid::new_v4(),
                "agent_alice",
                "memory_requested",
                Some(message_id),
                Some("MEMORY.md"),
                Some("Active Context"),
                "pending",
            )
            .await
            .unwrap();
    }

    let restarted = SleiDb::connect(&database_url).await.unwrap();
    let repos = Repositories::new(restarted.pool().clone());
    let coordinator = repos
        .channel_coordinator(channel_id)
        .await
        .unwrap()
        .unwrap();
    let decisions = repos
        .coordinator_decisions_for_message(message_id)
        .await
        .unwrap();
    let inbox = repos.agent_inbox_events("agent_alice").await.unwrap();
    let memory = repos
        .memory_update_events_for_agent("agent_alice")
        .await
        .unwrap();
    let packages = repos
        .routing_context_packages_for_decision(decision_id)
        .await
        .unwrap();

    assert_eq!(coordinator.strategy, "deterministic_v1");
    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0].action, "create_task_and_assign");
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].event_type, "task_assigned");
    assert_eq!(memory.len(), 1);
    assert_eq!(memory[0].source_message_id.as_deref(), Some("msg_1"));
    assert_eq!(
        memory[0].document_section.as_deref(),
        Some("Active Context")
    );
    assert_eq!(packages.len(), 1);
    assert_eq!(packages[0].source_message_id, "msg_1");
    assert_eq!(packages[0].contains_deleted_body, false);
}
