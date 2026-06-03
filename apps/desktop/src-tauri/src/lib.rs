pub mod commands;
pub mod daemon_broker;

pub fn run() {
    tauri::Builder::default()
        .manage(daemon_broker::DaemonBroker::default_local())
        .invoke_handler(tauri::generate_handler![
            commands::log_frontend_crash_command,
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
            commands::reset_conversation_runtime_session_command,
            commands::list_conversation_sessions_command,
            commands::create_conversation_session_command,
            commands::activate_conversation_session_command,
            commands::update_agent_command,
            commands::update_preferences_command,
            commands::remember_agent_fact_command,
            commands::open_agent_path_command,
            commands::list_conversation_messages_command,
            commands::send_conversation_message_command,
            commands::upload_conversation_attachment_command,
            commands::resolve_permission_command,
            commands::list_saved_messages_command,
            commands::save_message_command,
            commands::unsave_message_command,
            commands::refresh_runtime_status_command,
            commands::rename_local_node_command,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Slei desktop app");
}

#[cfg(test)]
mod tests {
    use super::commands::{
        activate_conversation_session, bootstrap_guide_agent, complete_interactive_card,
        create_agent, create_conversation_session, create_dm_conversation, daemon_status,
        format_frontend_crash_log, list_agent_skills, list_agents, list_conversation_messages,
        list_conversation_sessions, list_conversations, list_nodes, list_preferences,
        list_saved_messages,
        open_agent_path, reconnect_events, remember_agent_fact, rename_local_node,
        request_artifact_open, reset_conversation_runtime_session, save_message,
        send_conversation_message, unsave_message, update_agent, update_preferences,
        upload_conversation_attachment, FrontendCrashReport,
    };
    use super::daemon_broker::{
        AgentCreateRequest, AgentUpdateRequest, ConversationAttachmentUploadRequest,
        ConversationMessageRequest, DaemonBroker, NotificationPreferencesView,
        PreferencesUpdateRequest, RuntimeDescriptor, SaveMessageRequest,
    };
    use std::fs;
    use std::sync::{Mutex, MutexGuard};

    static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn test_env_lock() -> MutexGuard<'static, ()> {
        TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

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
    fn frontend_crash_log_includes_searchable_context() {
        let log = format_frontend_crash_log(&FrontendCrashReport {
            kind: "react".to_string(),
            message: "Cannot read properties of null (reading 'value')".to_string(),
            stack: Some("SearchPageView.tsx:51".to_string()),
            component_stack: Some("at SearchPage".to_string()),
            url: "http://127.0.0.1:1420/search".to_string(),
        });

        assert!(log.contains("[slei-frontend-crash]"));
        assert!(log.contains("kind=react"));
        assert!(log.contains("SearchPageView.tsx:51"));
        assert!(log.contains("/search"));
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
        let _env_guard = test_env_lock();
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
        let _env_guard = test_env_lock();
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
    fn created_agents_persist_and_reload_from_local_registry() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-agent-persist-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&agent_root);
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        let descriptor = RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        };
        let broker = DaemonBroker::for_tests(descriptor.clone());

        let created = create_agent(
            &broker,
            AgentCreateRequest {
                name: "Bob".to_string(),
                handle: "bob".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "架构工程师".to_string(),
            },
        )
        .unwrap()
        .agent;

        assert!(agent_root.join("agents/index.json").is_file());

        let reloaded = DaemonBroker::for_tests(descriptor);
        let agents = list_agents(&reloaded);
        assert_eq!(agents.agents.len(), 1);
        assert_eq!(agents.agents[0].id, created.id);
        assert_eq!(agents.agents[0].name, "Bob");
        assert_eq!(agents.agents[0].handle, "@bob");
        assert_eq!(
            agents.agents[0].channel_ids.as_deref(),
            Some(&["all".to_string()][..])
        );
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn local_agent_registry_recovers_self_handle_from_memory() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-agent-handle-recover-test-{}",
            std::process::id()
        ));
        let agent_id = "agent_123";
        let agent_dir = agent_root.join("agents").join(agent_id);
        let _ = fs::remove_dir_all(&agent_root);
        fs::create_dir_all(agent_dir.join("docs")).unwrap();
        fs::write(
            agent_dir.join("MEMORY.md"),
            "# Bob\n\n## Role\n架构工程师\n\n## Team\n@lei-lee — 人类用户，项目发起人\n@bob — 我自己，Bob\n",
        )
        .unwrap();
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        let descriptor = RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        };

        let recovered = list_agents(&DaemonBroker::for_tests(descriptor.clone()));
        assert_eq!(recovered.agents[0].handle, "@bob");

        let index_path = agent_root.join("agents/index.json");
        let mut indexed_agents = recovered.agents;
        indexed_agents[0].handle = "@lei-lee".to_string();
        fs::write(&index_path, serde_json::to_string_pretty(&indexed_agents).unwrap()).unwrap();

        let healed = list_agents(&DaemonBroker::for_tests(descriptor));
        assert_eq!(healed.agents[0].handle, "@bob");
        let index = fs::read_to_string(&index_path).unwrap();
        assert!(index.contains("\"handle\": \"@bob\""));
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn bootstrap_existing_guide_agent_does_not_deadlock() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-guide-bootstrap-deadlock-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&agent_root);
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        std::env::set_var("SLEI_CLAUDE_VERSION_OVERRIDE", "claude 1.2.3");
        let descriptor = RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        };

        assert_eq!(
            bootstrap_guide_agent(&DaemonBroker::for_tests(descriptor.clone())).status,
            "created"
        );
        let broker = DaemonBroker::for_tests(descriptor);
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let receipt = bootstrap_guide_agent(&broker);
            let _ = sender.send(receipt.status);
        });

        let status = receiver
            .recv_timeout(std::time::Duration::from_millis(500))
            .expect("bootstrap should not block on the local agents mutex");
        assert_eq!(status, "alreadyExists");
        std::env::remove_var("SLEI_CLAUDE_VERSION_OVERRIDE");
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn agent_workspace_commands_list_skills_and_open_only_agent_paths() {
        let _env_guard = test_env_lock();
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
    fn broker_agent_workspaces_keep_broker_data_root_when_env_changes() {
        let _env_guard = test_env_lock();
        let first_root = std::env::temp_dir().join(format!(
            "slei-desktop-agent-root-stable-first-{}",
            std::process::id()
        ));
        let second_root = std::env::temp_dir().join(format!(
            "slei-desktop-agent-root-stable-second-{}",
            std::process::id()
        ));
        std::env::set_var("SLEI_DATA_ROOT", &first_root);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        std::env::set_var("SLEI_DATA_ROOT", &second_root);
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

        assert!(agent
            .workspace_path
            .starts_with(first_root.to_str().unwrap()));
        assert!(!agent
            .workspace_path
            .starts_with(second_root.to_str().unwrap()));
        let skills = list_agent_skills(&broker, &agent.id).unwrap();
        assert!(skills.skills.iter().any(|skill| skill.id == "memory"));

        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn conversation_commands_create_dm_and_round_trip_messages() {
        let _env_guard = test_env_lock();
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
                session_id: None,
                attachment_ids: Vec::new(),
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
    fn conversation_sessions_and_attachments_round_trip() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-session-attachment-test-{}",
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

        let sessions = list_conversation_sessions(&broker, &dm.id).sessions;
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            dm.active_session_id.as_deref(),
            Some(sessions[0].id.as_str())
        );
        let attachment = upload_conversation_attachment(
            &broker,
            ConversationAttachmentUploadRequest {
                name: "../notes.md".to_string(),
                mime_type: "text/markdown".to_string(),
                bytes_base64: "aGVsbG8=".to_string(),
            },
        )
        .unwrap()
        .attachment;
        assert_eq!(attachment.name, "notes.md");
        assert!(attachment
            .cache_path
            .as_deref()
            .unwrap()
            .contains("/attachments/"));

        send_conversation_message(
            &broker,
            &dm.id,
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: String::new(),
                session_id: Some(sessions[0].id.clone()),
                attachment_ids: vec![attachment.id.clone()],
            },
        )
        .unwrap();
        let messages = list_conversation_messages(&broker, &dm.id);
        assert_eq!(
            messages.messages[0].session_id.as_deref(),
            Some(sessions[0].id.as_str())
        );
        assert_eq!(messages.messages[0].body, "");
        assert_eq!(
            messages.messages[0].attachments.as_ref().unwrap()[0].name,
            "notes.md"
        );

        let created = create_conversation_session(&broker, &dm.id).unwrap();
        assert_ne!(created.session.id, sessions[0].id);
        assert_eq!(
            list_conversations(&broker).conversations[0]
                .active_session_id
                .as_deref(),
            Some(created.session.id.as_str())
        );
        let activated = activate_conversation_session(&broker, &dm.id, &sessions[0].id).unwrap();
        assert_eq!(
            activated.conversation.active_session_id.as_deref(),
            Some(sessions[0].id.as_str())
        );
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn agent_dm_send_returns_with_running_runtime_message() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-conversation-running-test-{}",
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

        send_conversation_message(
            &broker,
            &dm.id,
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: "__slei_delay_runtime__".to_string(),
                session_id: None,
                attachment_ids: Vec::new(),
            },
        )
        .unwrap();

        let messages = list_conversation_messages(&broker, &dm.id);
        assert_eq!(messages.messages.len(), 2);
        assert_eq!(messages.messages[1].author_id, agent.id);
        assert_eq!(messages.messages[1].status.as_deref(), Some("running"));
        assert!(messages.messages[1].run_id.is_some());
        let conversations = list_conversations(&broker);
        let runtime_session = conversations.conversations[0]
            .runtime_session
            .as_ref()
            .unwrap();
        assert_eq!(runtime_session.runtime_kind, "ClaudeCode");
        assert_eq!(runtime_session.status, "pending");
        assert!(uuid::Uuid::parse_str(&runtime_session.session_id).is_ok());

        let reset = reset_conversation_runtime_session(&broker, &dm.id).unwrap();
        assert!(reset.conversation.runtime_session.is_none());
        let serialized = serde_json::to_string(&reset).unwrap();
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn agent_dm_local_runtime_session_is_reused_after_completion() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-conversation-resume-test-{}",
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

        send_conversation_message(
            &broker,
            &dm.id,
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: "第一句".to_string(),
                session_id: None,
                attachment_ids: Vec::new(),
            },
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let first_session = list_conversations(&broker).conversations[0]
            .runtime_session
            .clone()
            .unwrap();
        assert_eq!(first_session.status, "ready");

        send_conversation_message(
            &broker,
            &dm.id,
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: "第二句".to_string(),
                session_id: None,
                attachment_ids: Vec::new(),
            },
        )
        .unwrap();
        let second_session = list_conversations(&broker).conversations[0]
            .runtime_session
            .clone()
            .unwrap();
        assert_eq!(second_session.session_id, first_session.session_id);
        assert_eq!(second_session.status, "ready");
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn guide_dm_without_card_shortcut_returns_running_runtime_message() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-guide-runtime-test-{}",
            std::process::id()
        ));
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        std::env::set_var("SLEI_CLAUDE_VERSION_OVERRIDE", "claude 1.2.3");
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = bootstrap_guide_agent(&broker);
        assert_eq!(receipt.status, "created");
        assert_eq!(
            receipt
                .agent
                .as_ref()
                .and_then(|agent| agent.skills.as_ref())
                .unwrap()
                .iter()
                .map(|skill| skill.id.as_str())
                .collect::<Vec<_>>(),
            vec!["guide-create", "memory"]
        );
        let memory =
            fs::read_to_string(receipt.agent.as_ref().unwrap().memory_path.clone()).unwrap();
        assert!(!memory.contains("@Alice"));
        assert!(!memory.contains("@Nancy"));
        assert!(!memory.contains("@Cindy"));
        assert!(!memory.contains("Alice + Coda + Nancy"));
        assert!(!memory.contains("团队协作流程：用户/Alice"));
        assert!(memory.contains("@lei-lee"));
        assert!(memory.contains("@yeal"));
        let skills = list_agent_skills(&broker, "agent_guide_local_node").unwrap();
        assert_eq!(
            skills
                .skills
                .iter()
                .map(|skill| skill.id.as_str())
                .collect::<Vec<_>>(),
            vec!["guide-create", "memory"]
        );
        let dm = list_conversations(&broker).conversations[0].clone();
        send_conversation_message(
            &broker,
            &dm.id,
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: "__slei_delay_runtime__".to_string(),
                session_id: None,
                attachment_ids: Vec::new(),
            },
        )
        .unwrap();

        let messages = list_conversation_messages(&broker, &dm.id);
        assert!(messages.messages.iter().any(|message| {
            message.author_id == "agent_guide_local_node"
                && message.run_id.is_some()
                && message.status.as_deref() == Some("running")
        }));
        std::env::remove_var("SLEI_CLAUDE_VERSION_OVERRIDE");
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn guide_local_product_tool_appends_card_message() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-guide-product-tool-test-{}",
            std::process::id()
        ));
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        std::env::set_var("SLEI_CLAUDE_VERSION_OVERRIDE", "claude 1.2.3");
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = bootstrap_guide_agent(&broker);
        assert_eq!(receipt.status, "created");
        let dm = list_conversations(&broker).conversations[0].clone();
        send_conversation_message(
            &broker,
            &dm.id,
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: "__slei_product_tool_create_bob__".to_string(),
                session_id: None,
                attachment_ids: Vec::new(),
            },
        )
        .unwrap();

        let mut messages = list_conversation_messages(&broker, &dm.id).messages;
        for _ in 0..10 {
            if messages.iter().any(|message| {
                message.author_id == "agent_guide_local_node"
                    && message
                        .cards
                        .as_ref()
                        .is_some_and(|cards| !cards.is_empty())
            }) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
            messages = list_conversation_messages(&broker, &dm.id).messages;
        }

        let card_message = messages
            .iter()
            .find(|message| {
                message.author_id == "agent_guide_local_node"
                    && message
                        .cards
                        .as_ref()
                        .is_some_and(|cards| !cards.is_empty())
            })
            .expect("guide product tool should append a card-only message");
        assert_eq!(card_message.body, "");
        assert_eq!(card_message.status.as_deref(), Some("done"));
        let card = &card_message.cards.as_ref().unwrap()[0];
        assert_eq!(card.kind, "createAgent");
        assert_eq!(card.state, "pending");
        assert_eq!(card.draft["name"], "Bob");
        assert_eq!(card.action_label, "创建");
        assert_eq!(card.done_label, "DONE");

        let completed = complete_interactive_card(&broker, &card.id).unwrap();
        assert_eq!(completed.card.state, "done");
        let reloaded_messages = list_conversation_messages(&broker, &dm.id).messages;
        let reloaded_card = reloaded_messages
            .iter()
            .find_map(|message| {
                message
                    .cards
                    .as_ref()
                    .and_then(|cards| cards.iter().find(|candidate| candidate.id == card.id))
            })
            .expect("completed card should remain in the conversation messages");
        assert_eq!(reloaded_card.state, "done");
        std::env::remove_var("SLEI_CLAUDE_VERSION_OVERRIDE");
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn preferences_commands_round_trip_locale_and_notifications_without_secrets() {
        let _env_guard = test_env_lock();
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

    #[test]
    fn saved_messages_persist_across_broker_restarts_and_support_unsave() {
        let _env_guard = test_env_lock();
        let root = std::env::temp_dir().join(format!(
            "slei-desktop-saved-messages-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        std::env::set_var("SLEI_DATA_ROOT", &root);
        let descriptor = RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        };
        let broker = DaemonBroker::for_tests(descriptor.clone());

        let saved = save_message(
            &broker,
            SaveMessageRequest {
                message_id: "msg_1".to_string(),
                source_id: "dev-team".to_string(),
                source_kind: "channel".to_string(),
                session_id: None,
            },
        )
        .unwrap()
        .saved_message;
        assert_eq!(saved.id, "saved:channel:dev-team:msg_1");
        assert_eq!(list_saved_messages(&broker).saved_messages.len(), 1);

        let restarted = DaemonBroker::for_tests(descriptor);
        let reloaded = list_saved_messages(&restarted);
        assert_eq!(reloaded.saved_messages.len(), 1);
        assert_eq!(reloaded.saved_messages[0].message_id, "msg_1");
        let serialized = serde_json::to_string(&reloaded).unwrap();
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));

        unsave_message(&restarted, "msg_1").unwrap();
        assert!(list_saved_messages(&restarted).saved_messages.is_empty());
        std::env::remove_var("SLEI_DATA_ROOT");
    }
}
