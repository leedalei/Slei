pub mod commands;
pub mod daemon_broker;

pub fn run() {
    tauri::Builder::default()
        .manage(daemon_broker::DaemonBroker::default_local())
        .invoke_handler(tauri::generate_handler![
            commands::daemon_status_command,
            commands::reconnect_events_command,
            commands::list_nodes_command,
            commands::bootstrap_guide_agent_command,
            commands::list_channels_command,
            commands::create_channel_command,
            commands::list_channel_members_command,
            commands::complete_interactive_card_command,
            commands::list_preferences_command,
            commands::list_agents_command,
            commands::list_agent_skills_command,
            commands::list_conversations_command,
            commands::create_agent_command,
            commands::create_dm_conversation_command,
            commands::update_agent_command,
            commands::update_preferences_command,
            commands::remember_agent_fact_command,
            commands::open_agent_path_command,
            commands::list_conversation_messages_command,
            commands::send_conversation_message_command,
            commands::refresh_runtime_status_command,
            commands::rename_local_node_command,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Slei desktop app");
}

#[cfg(test)]
mod tests {
    use super::commands::{
        create_agent, create_dm_conversation, daemon_status, list_agents,
        list_conversation_messages, list_conversations, list_nodes, list_preferences,
        list_agent_skills, open_agent_path, reconnect_events, remember_agent_fact,
        rename_local_node, request_artifact_open, send_conversation_message, update_agent,
        update_preferences,
    };
    use super::daemon_broker::{
        AgentCreateRequest, AgentUpdateRequest, ConversationMessageRequest, DaemonBroker,
        NotificationPreferencesView, PreferencesUpdateRequest, RuntimeDescriptor,
    };
    use std::fs;

    #[test]
    fn broker_sanitizes_status_for_webview() {
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let status = daemon_status(&broker);
        let serialized = serde_json::to_string(&status).unwrap();

        assert!(status.connected);
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));
        assert!(!serialized.contains("ws://"));
    }

    #[test]
    fn broker_reconnect_uses_token_internally_and_returns_only_sequence() {
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = reconnect_events(&broker, 42);
        let serialized = serde_json::to_string(&receipt).unwrap();

        assert_eq!(receipt.after, 42);
        assert_eq!(
            broker.last_authorization_header().as_deref(),
            Some("Bearer secret-token")
        );
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("ws://"));
    }

    #[test]
    fn artifact_open_accepts_daemon_ids_only_and_hides_paths() {
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = request_artifact_open(&broker, "artifact_123").unwrap();
        let serialized = serde_json::to_string(&receipt).unwrap();

        assert_eq!(receipt.artifact_id, "artifact_123");
        assert_eq!(
            broker.last_authorization_header().as_deref(),
            Some("Bearer secret-token")
        );
        assert!(!serialized.contains("/Users/"));
        assert!(!serialized.contains("secret-token"));
        assert!(request_artifact_open(&broker, "/Users/lei/secret.md").is_err());
        assert!(request_artifact_open(&broker, "file:///etc/passwd").is_err());
    }

    #[test]
    fn node_commands_sanitize_runtime_status_and_support_device_name() {
        std::env::set_var("SLEI_CLAUDE_VERSION_OVERRIDE", "claude 1.2.3");
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let nodes = list_nodes(&broker);
        let serialized = serde_json::to_string(&nodes).unwrap();

        assert_eq!(nodes.nodes[0].id, "local-node");
        assert_eq!(nodes.nodes[0].runtimes[0].kind, "ClaudeCode");
        assert_eq!(nodes.nodes[0].runtimes[0].readiness, "ready");
        assert!(nodes.nodes[0].runtimes[0].version.is_some());
        assert!(!nodes.nodes[0].device.platform.is_empty());
        assert!(!nodes.nodes[0].device.arch.is_empty());
        assert!(!nodes.nodes[0].device.hostname.is_empty());
        assert!(!serialized.contains("osVersion"));
        assert!(!serialized.contains("os_version"));
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));
        assert!(!serialized.contains("ws://"));

        let renamed = rename_local_node(&broker, "Lei MacBook").unwrap();
        assert_eq!(renamed.node.name, "Lei MacBook");
        assert!(rename_local_node(&broker, "   ").is_err());
        std::env::remove_var("SLEI_CLAUDE_VERSION_OVERRIDE");
    }

    #[test]
    fn agent_commands_sanitize_dto_and_support_create_update_memory() {
        let agent_root =
            std::env::temp_dir().join(format!("slei-desktop-agent-test-{}", std::process::id()));
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let created = create_agent(
            &broker,
            AgentCreateRequest {
                name: "Nancy".to_string(),
                handle: "@nancy".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "QA 质保员".to_string(),
            },
        )
        .unwrap();
        assert_eq!(created.agent.handle, "@nancy");
        assert!(created.agent.workspace_path.contains("/agents/agent_"));
        assert!(fs::metadata(&created.agent.memory_path).unwrap().is_file());
        assert!(fs::metadata(&created.agent.docs_path).unwrap().is_dir());

        let agents = list_agents(&broker);
        let serialized = serde_json::to_string(&agents).unwrap();
        assert_eq!(agents.agents.len(), 1);
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));
        assert!(!serialized.contains("ws://"));

        let updated = update_agent(
            &broker,
            &created.agent.id,
            AgentUpdateRequest {
                name: Some("Nancy QA".to_string()),
                description: None,
                runtime_kind: None,
                model: None,
                node_id: None,
            },
        )
        .unwrap();
        assert_eq!(updated.agent.name, "Nancy QA");

        let remembered =
            remember_agent_fact(&broker, &created.agent.id, "优先检查安全漏洞和测试覆盖率")
                .unwrap();
        assert_eq!(remembered.agent.id, created.agent.id);
        assert!(fs::read_to_string(&created.agent.memory_path)
            .unwrap()
            .contains("优先检查安全漏洞和测试覆盖率"));
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn agent_workspace_commands_list_skills_and_open_only_agent_paths() {
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-agent-open-test-{}",
            std::process::id()
        ));
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        std::env::set_var("SLEI_DISABLE_SYSTEM_OPEN", "1");
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let agent = create_agent(
            &broker,
            AgentCreateRequest {
                name: "Coda".to_string(),
                handle: "@coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "开发 Agent".to_string(),
            },
        )
        .unwrap()
        .agent;

        let skills = list_agent_skills(&broker, &agent.id).unwrap();
        assert!(skills.skills.iter().any(|skill| skill.id == "memory"));
        let receipt = open_agent_path(&broker, &agent.id, "memory").unwrap();
        let serialized = serde_json::to_string(&receipt).unwrap();
        assert_eq!(receipt.agent_id, agent.id);
        assert_eq!(receipt.target, "memory");
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));
        assert!(open_agent_path(&broker, &agent.id, "secrets").is_err());
        assert!(open_agent_path(&broker, "agent_missing", "memory").is_err());

        std::env::remove_var("SLEI_DISABLE_SYSTEM_OPEN");
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn conversation_commands_create_dm_and_round_trip_messages() {
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-conversation-test-{}",
            std::process::id()
        ));
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });
        let agent = create_agent(
            &broker,
            AgentCreateRequest {
                name: "Coda".to_string(),
                handle: "@coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "开发 Agent".to_string(),
            },
        )
        .unwrap()
        .agent;

        let dm = create_dm_conversation(&broker, &agent.id)
            .unwrap()
            .conversation;
        assert_eq!(dm.agent_id, agent.id);
        assert_eq!(
            create_dm_conversation(&broker, &agent.id)
                .unwrap()
                .conversation
                .id,
            dm.id
        );

        send_conversation_message(
            &broker,
            &dm.id,
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: "你好 Coda".to_string(),
            },
        )
        .unwrap();
        let conversations = list_conversations(&broker);
        assert_eq!(conversations.conversations.len(), 1);
        let messages = list_conversation_messages(&broker, &dm.id);
        assert_eq!(messages.messages[0].body, "你好 Coda");
        let serialized = serde_json::to_string(&messages).unwrap();
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn preferences_commands_round_trip_locale_and_notifications_without_secrets() {
        let root = std::env::temp_dir().join(format!(
            "slei-desktop-preferences-test-{}",
            std::process::id()
        ));
        std::env::set_var("SLEI_DATA_ROOT", &root);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        assert_eq!(list_preferences(&broker).preferences.locale, "zh-CN");
        let updated = update_preferences(
            &broker,
            PreferencesUpdateRequest {
                locale: Some("en-US".to_string()),
                time_zone: Some("America/Los_Angeles".to_string()),
                appearance: None,
                notifications: Some(NotificationPreferencesView {
                    mentions: true,
                    human_replies: false,
                    approvals: true,
                }),
            },
        )
        .unwrap();

        assert_eq!(updated.preferences.locale, "en-US");
        assert!(!updated.preferences.notifications.human_replies);
        let serialized = serde_json::to_string(&list_preferences(&broker)).unwrap();
        assert!(serialized.contains("secret-token") == false);
        assert!(serialized.contains("127.0.0.1") == false);
        std::env::remove_var("SLEI_DATA_ROOT");
    }
}
