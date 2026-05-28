use slei_daemon::services::message_service::{MessageService, SendMessageDraft};

#[tokio::test]
async fn message_deletion_agent_messages_are_immutable_and_human_messages_tombstone() {
    let service = MessageService::for_tests();
    service.set_primary_agent_for_tests("channel_dev", "agent_coda");

    let human = service
        .insert_human_for_tests("channel_dev", "human_lei", "delete me")
        .await;
    service.delete_human_message(&human).await.unwrap();
    assert!(service.message(&human).await.unwrap().deleted);
    assert_eq!(service.message(&human).await.unwrap().body, None);

    let agent = service
        .insert_agent_for_tests("channel_dev", "agent_coda", "immutable")
        .await;
    let err = service.delete_human_message(&agent).await.unwrap_err();
    assert!(err.to_string().contains("agent messages are immutable"));
}

#[tokio::test]
async fn message_deletion_edit_label_persists() {
    let service = MessageService::for_tests();
    service.set_primary_agent_for_tests("channel_dev", "agent_coda");
    let outcome = service
        .send_message(
            SendMessageDraft {
                channel_id: "channel_dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "original".to_string(),
                as_task: false,
                workspace_count: 1,
            },
            "edit-1",
        )
        .await
        .unwrap();

    service
        .edit_human_message(&outcome.message_id(), "updated")
        .await
        .unwrap();
    let edited = service.message(&outcome.message_id()).await.unwrap();

    assert_eq!(edited.body.as_deref(), Some("updated"));
    assert!(edited.edited);
}
