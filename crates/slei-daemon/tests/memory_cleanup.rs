use std::path::PathBuf;

use slei_daemon::services::memory_event_service::{MemoryEventService, MemorySectionRef};
use slei_daemon::services::orchestration_store::OrchestrationStore;
use slei_daemon::services::run_orchestrator::{
    ContextAssembler, ContextMessageRecord, MemorySnippetRecord,
};
use uuid::Uuid;

#[tokio::test]
async fn deleted_source_blocks_affected_memory_snippet_until_cleanup_completes() {
    let store = OrchestrationStore::for_tests().await;
    let memory_events = MemoryEventService::new(store);

    memory_events
        .record_memory_document_source("agent_coda", "MEMORY.md", "Active Context", "msg_deleted")
        .await;

    memory_events
        .request_cleanup_for_source_message("msg_deleted")
        .await;

    let blocked_sections = memory_events.blocked_memory_sections("agent_coda").await;
    assert_eq!(
        blocked_sections,
        vec![MemorySectionRef {
            agent_id: "agent_coda".to_string(),
            document_path: "MEMORY.md".to_string(),
            document_section: "Active Context".to_string(),
        }]
    );

    let context = ContextAssembler::assemble_with_memory(
        vec![ContextMessageRecord {
            channel_id: "channel_dev".to_string(),
            task_id: None,
            agent_id: "agent_coda".to_string(),
            role: "user".to_string(),
            content: Some("safe channel message".to_string()),
            deleted: false,
        }],
        vec![
            MemorySnippetRecord {
                agent_id: "agent_coda".to_string(),
                document_path: "MEMORY.md".to_string(),
                document_section: "Active Context".to_string(),
                content: "SENTINEL_DELETED_SOURCE_MEMORY".to_string(),
            },
            MemorySnippetRecord {
                agent_id: "agent_coda".to_string(),
                document_path: "MEMORY.md".to_string(),
                document_section: "Stable Facts".to_string(),
                content: "safe memory snippet".to_string(),
            },
        ],
        blocked_sections,
    );

    let serialized = serde_json::to_string(&context).unwrap();
    assert!(serialized.contains("safe channel message"));
    assert!(serialized.contains("safe memory snippet"));
    assert!(!serialized.contains("SENTINEL_DELETED_SOURCE_MEMORY"));

    memory_events
        .complete_cleanup("agent_coda", "MEMORY.md", "Active Context", "msg_deleted")
        .await;

    assert!(memory_events
        .blocked_memory_sections("agent_coda")
        .await
        .is_empty());
}

#[tokio::test]
async fn blocked_memory_sections_survive_restart() {
    let data_root = temp_data_root();

    {
        let store = OrchestrationStore::for_data_root(data_root.clone()).await;
        let memory_events = MemoryEventService::new(store);
        memory_events
            .record_memory_document_source(
                "agent_coda",
                "MEMORY.md",
                "Active Context",
                "msg_deleted",
            )
            .await;
        memory_events
            .request_cleanup_for_source_message("msg_deleted")
            .await;
    }

    let restarted_store = OrchestrationStore::for_data_root(data_root).await;
    let restarted_memory_events = MemoryEventService::new(restarted_store);
    let blocked_sections = restarted_memory_events
        .blocked_memory_sections("agent_coda")
        .await;

    assert_eq!(
        blocked_sections,
        vec![MemorySectionRef {
            agent_id: "agent_coda".to_string(),
            document_path: "MEMORY.md".to_string(),
            document_section: "Active Context".to_string(),
        }]
    );

    let context = ContextAssembler::assemble_with_memory(
        Vec::new(),
        vec![MemorySnippetRecord {
            agent_id: "agent_coda".to_string(),
            document_path: "MEMORY.md".to_string(),
            document_section: "Active Context".to_string(),
            content: "SENTINEL_RESTART_BLOCKED_MEMORY".to_string(),
        }],
        blocked_sections,
    );

    assert!(!serde_json::to_string(&context)
        .unwrap()
        .contains("SENTINEL_RESTART_BLOCKED_MEMORY"));
}

#[tokio::test]
async fn shared_section_stays_blocked_until_all_requested_sources_complete() {
    let store = OrchestrationStore::for_tests().await;
    let memory_events = MemoryEventService::new(store);

    for source_message_id in ["msg_deleted_a", "msg_deleted_b"] {
        memory_events
            .record_memory_document_source(
                "agent_coda",
                "MEMORY.md",
                "Active Context",
                source_message_id,
            )
            .await;
        memory_events
            .request_cleanup_for_source_message(source_message_id)
            .await;
    }

    assert_eq!(
        memory_events.blocked_memory_sections("agent_coda").await,
        vec![active_context_ref()]
    );

    memory_events
        .complete_cleanup("agent_coda", "MEMORY.md", "Active Context", "msg_deleted_a")
        .await;

    assert_eq!(
        memory_events.blocked_memory_sections("agent_coda").await,
        vec![active_context_ref()]
    );

    memory_events
        .complete_cleanup("agent_coda", "MEMORY.md", "Active Context", "msg_deleted_b")
        .await;

    assert!(memory_events
        .blocked_memory_sections("agent_coda")
        .await
        .is_empty());
}

#[tokio::test]
async fn later_deleted_source_reblocks_section_after_earlier_cleanup_completed() {
    let store = OrchestrationStore::for_tests().await;
    let memory_events = MemoryEventService::new(store);

    memory_events
        .record_memory_document_source("agent_coda", "MEMORY.md", "Active Context", "msg_deleted_a")
        .await;
    memory_events
        .request_cleanup_for_source_message("msg_deleted_a")
        .await;
    memory_events
        .complete_cleanup("agent_coda", "MEMORY.md", "Active Context", "msg_deleted_a")
        .await;

    assert!(memory_events
        .blocked_memory_sections("agent_coda")
        .await
        .is_empty());

    memory_events
        .record_memory_document_source("agent_coda", "MEMORY.md", "Active Context", "msg_deleted_b")
        .await;
    memory_events
        .request_cleanup_for_source_message("msg_deleted_b")
        .await;

    assert_eq!(
        memory_events.blocked_memory_sections("agent_coda").await,
        vec![active_context_ref()]
    );

    memory_events
        .complete_cleanup("agent_coda", "MEMORY.md", "Active Context", "msg_deleted_b")
        .await;

    assert!(memory_events
        .blocked_memory_sections("agent_coda")
        .await
        .is_empty());
}

#[tokio::test]
async fn recording_duplicate_or_additional_sources_preserves_blocked_section_state() {
    let store = OrchestrationStore::for_tests().await;
    let memory_events = MemoryEventService::new(store);

    memory_events
        .record_memory_document_source("agent_coda", "MEMORY.md", "Active Context", "msg_deleted")
        .await;
    memory_events
        .request_cleanup_for_source_message("msg_deleted")
        .await;

    assert_eq!(
        memory_events.blocked_memory_sections("agent_coda").await,
        vec![active_context_ref()]
    );

    memory_events
        .record_memory_document_source("agent_coda", "MEMORY.md", "Active Context", "msg_deleted")
        .await;
    memory_events
        .record_memory_document_source(
            "agent_coda",
            "MEMORY.md",
            "Active Context",
            "msg_later_source",
        )
        .await;

    assert_eq!(
        memory_events.blocked_memory_sections("agent_coda").await,
        vec![active_context_ref()]
    );
}

fn active_context_ref() -> MemorySectionRef {
    MemorySectionRef {
        agent_id: "agent_coda".to_string(),
        document_path: "MEMORY.md".to_string(),
        document_section: "Active Context".to_string(),
    }
}

fn temp_data_root() -> PathBuf {
    std::env::temp_dir().join(format!("slei-memory-cleanup-{}", Uuid::new_v4()))
}
