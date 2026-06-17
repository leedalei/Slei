pub mod commands;
pub mod daemon_broker;

pub fn run() {
    tauri::Builder::default()
        .manage(daemon_broker::DaemonBroker::default_local())
        .invoke_handler(tauri::generate_handler![
            commands::log_frontend_crash_command,
            commands::log_frontend_event_command,
            commands::daemon_status_command,
            commands::app_runtime_flags_command,
            commands::list_diagnostics_command,
            commands::reconnect_events_command,
            commands::list_nodes_command,
            commands::bootstrap_guide_agent_command,
            commands::list_channels_command,
            commands::create_channel_command,
            commands::list_channel_members_command,
            commands::add_channel_member_command,
            commands::remove_channel_member_command,
            commands::list_channel_messages_command,
            commands::list_channel_sessions_command,
            commands::create_channel_session_command,
            commands::activate_channel_session_command,
            commands::send_channel_message_command,
            commands::list_tasks_command,
            commands::get_task_thread_command,
            commands::reply_to_task_command,
            commands::update_task_status_command,
            commands::create_message_thread_from_source_command,
            commands::get_message_thread_command,
            commands::reply_to_message_thread_command,
            commands::complete_interactive_card_command,
            commands::list_preferences_command,
            commands::list_profile_command,
            commands::list_agents_command,
            commands::list_agent_activity_command,
            commands::list_agent_skills_command,
            commands::list_conversations_command,
            commands::create_agent_command,
            commands::create_dm_conversation_command,
            commands::reset_conversation_runtime_session_command,
            commands::list_conversation_sessions_command,
            commands::create_conversation_session_command,
            commands::activate_conversation_session_command,
            commands::update_agent_command,
            commands::delete_agent_command,
            commands::update_preferences_command,
            commands::update_profile_command,
            commands::remember_agent_fact_command,
            commands::open_agent_path_command,
            commands::list_agent_workspace_command,
            commands::read_agent_workspace_file_command,
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
        activate_conversation_session, add_channel_member, app_runtime_flags,
        bootstrap_guide_agent, complete_interactive_card, create_agent, create_channel,
        create_conversation_session, create_dm_conversation, daemon_status, delete_agent,
        format_frontend_crash_log, list_agent_activity, list_agent_skills, list_agent_workspace,
        list_agents, list_channel_members, list_channel_messages, list_conversation_messages,
        list_conversation_sessions, list_conversations, list_diagnostics, list_nodes,
        list_preferences, list_profile, list_saved_messages, list_tasks, open_agent_path,
        read_agent_workspace_file, reconnect_events, remember_agent_fact, remove_channel_member,
        rename_local_node, reply_to_task, request_artifact_open,
        reset_conversation_runtime_session, save_message, send_channel_message,
        send_conversation_message, unsave_message, update_agent, update_preferences,
        update_profile, upload_conversation_attachment, FrontendCrashReport,
    };
    use super::daemon_broker::{
        AgentCreateRequest, AgentUpdateRequest, ChannelCreateRequest, ChannelMemberAddRequest,
        ConversationAttachmentUploadRequest, ConversationMessageRequest, DaemonBroker,
        NotificationPreferencesView, PreferencesUpdateRequest, ProfileUpdateRequest,
        RuntimeDescriptor, SaveMessageRequest, SendChannelMessageRequest, TaskListQuery,
        TaskReplyRequest,
    };
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Mutex, MutexGuard};
    use std::thread;
    use std::time::Duration;

    static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn test_env_lock() -> MutexGuard<'static, ()> {
        TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn read_http_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 512];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
            let request = String::from_utf8_lossy(&bytes);
            let Some(header_end) = request.find("\r\n\r\n") else {
                continue;
            };
            let content_length = request
                .lines()
                .find_map(|line| line.strip_prefix("Content-Length: "))
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            if bytes.len() >= header_end + 4 + content_length {
                break;
            }
        }
        String::from_utf8(bytes).unwrap()
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
    fn broker_fetches_diagnostics_snapshot_for_frontend_error_toasts() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                if String::from_utf8_lossy(&bytes).contains("\r\n\r\n") {
                    break;
                }
            }
            let response = r#"{
              "node":"local-node",
              "runtime":"ClaudeCode",
              "worker":"claude-agent",
              "protocolVersion":"v1",
              "schemaVersion":"2026-05-27",
              "coordinatorDecisionCount":1,
              "agentInboxEventCount":0,
              "memoryUpdateEventCount":0,
              "recentEvents":[{
                "sequence":66,
                "eventType":"coordinator_runtime.failed",
                "entityId":"event_1",
                "payload":"run_id=coord_run_1 decision_failed",
                "createdAt":"2026-06-11 09:57:39"
              }]
            }"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            String::from_utf8(bytes).unwrap()
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let snapshot = list_diagnostics(&broker);
        let request = handle.join().unwrap();

        assert!(request.contains("GET /v1/diagnostics HTTP/1.1"));
        assert_eq!(snapshot.recent_events[0].sequence, 66);
        assert_eq!(
            snapshot.recent_events[0].event_type,
            "coordinator_runtime.failed"
        );
    }

    #[test]
    fn runtime_flags_enable_debug_from_environment() {
        let _guard = test_env_lock();
        std::env::set_var("SLEI_DEBUG", "1");
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:1".to_string(),
            event_socket: "ws://127.0.0.1:1/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let flags = app_runtime_flags(&broker);

        std::env::remove_var("SLEI_DEBUG");
        assert!(flags.debug);
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
    fn channel_message_command_uses_daemon_route_with_idempotency_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let request = String::from_utf8(bytes).unwrap();
            let response = serde_json::json!({
                "outcome": {
                    "messageId": "daemon_msg_1",
                    "action": "create_task_and_assign",
                    "taskId": "daemon_task_1",
                    "assigneeAgentId": "agent_alice",
                    "assigneeAgentIds": ["agent_alice"],
                    "coordinatorRunId": "coord_run_1",
                    "decisionStatus": "completed"
                }
            })
            .to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            request
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = send_channel_message(
            &broker,
            "remote-dev",
            SendChannelMessageRequest {
                author_id: "human_lei".to_string(),
                body: "实现一个 API 路由".to_string(),
                as_task: true,
            },
        )
        .unwrap();
        let request = handle.join().unwrap();

        assert_eq!(receipt.outcome.message_id, "daemon_msg_1");
        assert!(request.contains("POST /v1/channels/remote-dev/messages HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer secret-token"));
        assert!(request.contains("Idempotency-Key: desktop-channel-message-"));
        assert!(request.contains(r#""asTask":true"#));
    }

    #[test]
    fn task_reply_command_uses_daemon_route_with_idempotency_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let request = String::from_utf8(bytes).unwrap();
            let response = serde_json::json!({
                "reply": {
                    "id": "reply_1",
                    "taskId": "task_1",
                    "senderId": "human:local",
                    "role": "human",
                    "body": "@coda 继续",
                    "createdAt": "2"
                },
                "route": {
                    "handoffAgentIds": ["agent_coda"],
                    "needsAssignment": false
                }
            })
            .to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            request
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = reply_to_task(
            &broker,
            "task_1",
            TaskReplyRequest {
                sender_id: "human:local".to_string(),
                body: "@coda 继续".to_string(),
            },
        )
        .unwrap();
        let request = handle.join().unwrap();

        assert_eq!(receipt.reply.id, "reply_1");
        assert_eq!(receipt.route.handoff_agent_ids, vec!["agent_coda"]);
        assert!(request.contains("POST /v1/tasks/task_1/replies HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer secret-token"));
        assert!(request.contains("Idempotency-Key: desktop-task-reply-"));
    }

    #[test]
    fn channel_message_command_does_not_fallback_when_daemon_rejects_request() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let response = r#"{"error":"channel not found"}"#;
            write!(
                stream,
                "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            String::from_utf8(bytes).unwrap()
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let error = send_channel_message(
            &broker,
            "remote-dev",
            SendChannelMessageRequest {
                author_id: "human_lei".to_string(),
                body: "实现一个 API 路由".to_string(),
                as_task: false,
            },
        )
        .unwrap_err()
        .to_string();
        let request = handle.join().unwrap();

        assert!(request.contains("POST /v1/channels/remote-dev/messages HTTP/1.1"));
        assert!(error.contains("daemon request failed"));
        assert!(error.contains("404"));
        assert!(!error.contains("msg_channel_remote-dev"));
        assert!(!error.contains("task_msg_channel_remote-dev"));
    }

    #[test]
    fn channel_message_command_does_not_fallback_when_daemon_connection_fails() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let error = send_channel_message(
            &broker,
            "remote-dev",
            SendChannelMessageRequest {
                author_id: "human_lei".to_string(),
                body: "实现一个 API 路由".to_string(),
                as_task: false,
            },
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("daemon request failed"));
        assert!(error.contains("daemon connection failed"));
        assert!(!error.contains("msg_channel_remote-dev"));
        assert!(!error.contains("task_msg_channel_remote-dev"));
    }

    #[test]
    fn default_all_channel_message_falls_back_locally_when_daemon_connection_fails() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = send_channel_message(
            &broker,
            "all",
            SendChannelMessageRequest {
                author_id: "human_lei".to_string(),
                body: "大家先同步一下进度".to_string(),
                as_task: false,
            },
        )
        .unwrap();

        assert!(receipt.outcome.message_id.starts_with("msg_channel_all_"));
        assert_eq!(receipt.outcome.action, "local_archive_only");
        assert_eq!(receipt.outcome.task_id, None);
        assert_eq!(receipt.outcome.assignee_agent_id, None);
        let diagnostics = broker.diagnostic_events_for_tests();
        assert!(diagnostics.iter().any(|event| {
            event.contains("desktop_channel_message.fallback")
                && event.contains("channel_id=all")
                && event.contains("reason=daemon_unavailable")
                && event.contains("body=[redacted-body]")
                && !event.contains("大家先同步")
        }));
    }

    #[test]
    fn default_all_channel_message_as_task_creates_local_task_without_heuristic() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = send_channel_message(
            &broker,
            "all",
            SendChannelMessageRequest {
                author_id: "human_lei".to_string(),
                body: "请转成任务但正文不含动词".to_string(),
                as_task: true,
            },
        )
        .unwrap();
        let tasks = list_tasks(
            &broker,
            TaskListQuery {
                channel_id: Some("all".to_string()),
                creator_id: None,
                assignee_id: None,
            },
        );

        assert_eq!(receipt.outcome.action, "local_needs_manual_assignment");
        assert!(receipt.outcome.task_id.is_some());
        assert_eq!(tasks.tasks.len(), 1);
        assert_eq!(tasks.tasks[0].status, "pending_assignment");
        assert_eq!(tasks.tasks[0].title, "请转成任务但正文不含动词");
    }

    #[test]
    fn channel_message_command_does_not_fallback_when_daemon_response_is_invalid() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let response = r#"{"unexpected":true}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            String::from_utf8(bytes).unwrap()
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let error = send_channel_message(
            &broker,
            "remote-dev",
            SendChannelMessageRequest {
                author_id: "human_lei".to_string(),
                body: "实现一个 API 路由".to_string(),
                as_task: false,
            },
        )
        .unwrap_err()
        .to_string();
        let request = handle.join().unwrap();

        assert!(request.contains("POST /v1/channels/remote-dev/messages HTTP/1.1"));
        assert!(error.contains("daemon response invalid"));
        assert!(!error.contains("msg_channel_remote-dev"));
        assert!(!error.contains("task_msg_channel_remote-dev"));
    }

    #[test]
    fn channel_create_command_uses_daemon_route_with_idempotency_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let request = String::from_utf8(bytes).unwrap();
            let response = serde_json::json!({
                "channel": {
                    "id": "remote-dev",
                    "name": "remote-dev",
                    "description": "远程频道",
                    "isDefault": false
                }
            })
            .to_string();
            write!(
                stream,
                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            request
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = create_channel(
            &broker,
            ChannelCreateRequest {
                name: "remote-dev".to_string(),
                description: Some("远程频道".to_string()),
                agent_ids: vec!["agent_alice".to_string()],
                project_paths: vec!["/workspace/api".to_string()],
            },
        )
        .unwrap();
        let request = handle.join().unwrap();

        assert_eq!(receipt.channel.id, "remote-dev");
        assert!(request.contains("POST /v1/channels HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer secret-token"));
        assert!(request.contains("Idempotency-Key: desktop-channel-create-"));
        assert!(request.contains(r#""projectPaths":["/workspace/api"]"#));
    }

    #[test]
    fn agent_create_command_uses_daemon_route_with_idempotency_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let response = r#"{"agent":{"id":"agent_nova","name":"Nova","handle":"@nova","agentKind":"agent","systemOwned":false,"runtimeKind":"ClaudeCode","model":"Opus","nodeId":"local-node","description":"Architect","workspacePath":"/tmp/agents/agent_nova","memoryPath":"/tmp/agents/agent_nova/MEMORY.md","docsPath":"/tmp/agents/agent_nova/docs","avatarSeed":"agent_nova","runtimeThread":{"runtimeKind":"ClaudeCode","status":"ready","createdAt":"1"},"channelIds":["all"],"createdAt":"1","updatedAt":"1"}}"#;
            write!(
                stream,
                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            String::from_utf8(bytes).unwrap()
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = create_agent(
            &broker,
            AgentCreateRequest {
                name: "Nova".to_string(),
                handle: "@nova".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Opus".to_string(),
                node_id: "local-node".to_string(),
                description: "Architect".to_string(),
            },
        )
        .unwrap();
        let request = handle.join().unwrap();

        assert_eq!(receipt.agent.id, "agent_nova");
        assert!(request.contains("POST /v1/agents HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer secret-token"));
        assert!(request.contains("Idempotency-Key: desktop-agent-create-"));
        assert!(request.contains(r#""handle":"@nova""#));
    }

    #[test]
    fn broker_fetches_agent_activity_with_token() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            assert_eq!(stream.read_timeout().unwrap(), Some(Duration::from_secs(2)));
            let response = serde_json::json!({
                "logs": [{
                    "id": "log_1",
                    "agentId": "agent_nova",
                    "runId": "run_1",
                    "channelId": "all",
                    "messageId": "msg_1",
                    "taskId": "task_1",
                    "state": "running",
                    "phase": "tool_call",
                    "reason": "command_started",
                    "eventKind": "tool",
                    "severity": "info",
                    "summary": "Running cargo test",
                    "payloadPreview": "{\"cmd\":\"cargo test\"}",
                    "toolName": "exec_command",
                    "ok": true,
                    "createdAt": "2026-06-17T09:00:00Z"
                }]
            })
            .to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            request
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = list_agent_activity(&broker, "agent_nova", None).unwrap();
        let request = handle.join().unwrap();
        let serialized = serde_json::to_string(&receipt).unwrap();

        assert_eq!(receipt.logs.len(), 1);
        assert_eq!(receipt.logs[0].id, "log_1");
        assert_eq!(receipt.logs[0].agent_id, "agent_nova");
        assert_eq!(receipt.logs[0].tool_name.as_deref(), Some("exec_command"));
        assert_eq!(receipt.logs[0].ok, Some(true));
        assert!(request.contains("GET /v1/agents/agent_nova/activity?limit=200 HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer secret-token"));
        assert!(!serialized.contains("secret-token"));
    }

    #[test]
    fn broker_agent_activity_offline_memory_fallback_returns_empty_logs() {
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:1".to_string(),
            event_socket: "ws://127.0.0.1:1/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = list_agent_activity(&broker, "agent_nova", Some(50)).unwrap();

        assert!(receipt.logs.is_empty());
    }

    #[test]
    fn broker_agent_activity_daemon_error_is_returned() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            let response = r#"{"error":"storage failed"}"#;
            write!(
                stream,
                "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            request
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let error = list_agent_activity(&broker, "agent_nova", Some(999_999)).unwrap_err();
        let request = handle.join().unwrap();

        assert!(error.to_string().contains("500 Internal Server Error"));
        assert!(request.contains("GET /v1/agents/agent_nova/activity?limit=200 HTTP/1.1"));
    }

    #[test]
    fn broker_agent_activity_offline_empty_fallback_returns_err() {
        let broker = DaemonBroker::for_tests_empty_fallback(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:1".to_string(),
            event_socket: "ws://127.0.0.1:1/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let error = list_agent_activity(&broker, "agent_nova", None).unwrap_err();

        assert_eq!(error.to_string(), "daemon unavailable");
    }

    #[test]
    fn interactive_card_complete_uses_daemon_route_with_idempotency_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let response = r#"{"card":{"id":"card_nova","kind":"createAgent","state":"done","title":"创建 Nova","summary":"Nova","draft":{"name":"Nova"},"actionLabel":"创建","doneLabel":"DONE"}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            String::from_utf8(bytes).unwrap()
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = complete_interactive_card(&broker, "card_nova").unwrap();
        let request = handle.join().unwrap();

        assert_eq!(receipt.card.state, "done");
        assert!(request.contains("POST /v1/interactive-cards/card_nova/complete HTTP/1.1"));
        assert!(request.contains("Authorization: Bearer secret-token"));
        assert!(request.contains("Idempotency-Key: desktop-card-complete-"));
    }

    #[test]
    fn channel_create_command_does_not_fallback_when_daemon_rejects_request() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let response = r#"{"error":"idempotency-key is required"}"#;
            write!(
                stream,
                "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            String::from_utf8(bytes).unwrap()
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let error = create_channel(
            &broker,
            ChannelCreateRequest {
                name: "remote-dev".to_string(),
                description: None,
                agent_ids: vec![],
                project_paths: vec![],
            },
        )
        .unwrap_err()
        .to_string();
        let request = handle.join().unwrap();

        assert!(request.contains("POST /v1/channels HTTP/1.1"));
        assert!(error.contains("daemon request failed"));
        assert!(error.contains("400"));
        assert!(!error.contains("invalid channel"));
    }

    #[test]
    fn channel_member_commands_use_daemon_routes() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for response in [
                serde_json::json!({
                    "member": {
                        "channelId": "remote-dev",
                        "agentId": "agent_coda",
                        "joinedAt": "1",
                        "readiness": "ready"
                    }
                })
                .to_string(),
                serde_json::json!({
                    "removedMember": {
                        "channelId": "remote-dev",
                        "agentId": "agent_coda",
                        "joinedAt": "1",
                        "readiness": "ready"
                    }
                })
                .to_string(),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 512];
                loop {
                    let count = stream.read(&mut buffer).unwrap();
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                    let request = String::from_utf8_lossy(&bytes);
                    let Some(header_end) = request.find("\r\n\r\n") else {
                        continue;
                    };
                    let content_length = request
                        .lines()
                        .find_map(|line| line.strip_prefix("Content-Length: "))
                        .and_then(|value| value.parse::<usize>().ok())
                        .unwrap_or(0);
                    if bytes.len() >= header_end + 4 + content_length {
                        break;
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.len(),
                    response
                )
                .unwrap();
            }
            requests
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let added = add_channel_member(
            &broker,
            "remote-dev",
            ChannelMemberAddRequest {
                agent_id: "agent_coda".to_string(),
            },
        )
        .unwrap();
        let removed = remove_channel_member(&broker, "remote-dev", "agent_coda").unwrap();
        let requests = handle.join().unwrap();

        assert_eq!(added.member.readiness, "ready");
        assert_eq!(
            removed
                .removed_member
                .as_ref()
                .map(|member| member.agent_id.as_str()),
            Some("agent_coda")
        );
        assert!(requests[0].contains("POST /v1/channels/remote-dev/members HTTP/1.1"));
        assert!(requests[0].contains(r#""agentId":"agent_coda""#));
        assert!(requests[1].contains("DELETE /v1/channels/remote-dev/members/agent_coda HTTP/1.1"));
    }

    #[test]
    fn channel_create_command_does_not_fallback_when_daemon_connection_fails() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let error = create_channel(
            &broker,
            ChannelCreateRequest {
                name: "remote-dev".to_string(),
                description: None,
                agent_ids: vec![],
                project_paths: vec![],
            },
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("daemon request failed"));
        assert!(error.contains("daemon connection failed"));
        assert!(!error.contains("invalid channel"));
    }

    #[test]
    fn channel_create_command_does_not_fallback_when_daemon_response_is_invalid() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let request = String::from_utf8_lossy(&bytes);
                let Some(header_end) = request.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let response = r#"{"unexpected":true}"#;
            write!(
                stream,
                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
            String::from_utf8(bytes).unwrap()
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let error = create_channel(
            &broker,
            ChannelCreateRequest {
                name: "remote-dev".to_string(),
                description: None,
                agent_ids: vec![],
                project_paths: vec![],
            },
        )
        .unwrap_err()
        .to_string();
        let request = handle.join().unwrap();

        assert!(request.contains("POST /v1/channels HTTP/1.1"));
        assert!(error.contains("daemon response invalid"));
        assert!(!error.contains("invalid channel"));
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
        assert!(fs::read_to_string(&created.agent.memory_path)
            .unwrap()
            .contains("已加入频道：#all"));

        let agents = list_agents(&broker);
        let serialized = serde_json::to_string(&agents).unwrap();
        assert!(agents
            .agents
            .iter()
            .any(|agent| agent.id == created.agent.id));
        assert!(agents
            .agents
            .iter()
            .any(|agent| agent.id == "agent_global_coordinator"));
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
        let remembered_memory = fs::read_to_string(&created.agent.memory_path).unwrap();
        let key_knowledge =
            section_between(&remembered_memory, "## Key Knowledge", "## Active Context");
        assert!(key_knowledge.contains("优先检查安全漏洞和测试覆盖率"));
        assert!(!section_after(&remembered_memory, "## Active Context")
            .contains("优先检查安全漏洞和测试覆盖率"));

        remember_agent_fact(
            &broker,
            &created.agent.id,
            "当前正在处理默认 Agent assets 整理；下次继续替换 desktop mock。",
        )
        .unwrap();
        let active_memory = fs::read_to_string(&created.agent.memory_path).unwrap();
        let active_context = section_after(&active_memory, "## Active Context");
        assert!(active_context.contains("默认 Agent assets 整理"));
        assert!(active_context.contains("下次继续替换 desktop mock"));
        assert!(!active_context.contains("首次启动，等待用户提出需要引导的任务"));
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    fn section_between<'a>(memory: &'a str, start: &str, end: &str) -> &'a str {
        let Some(start_index) = memory.find(start) else {
            return "";
        };
        let after_start = &memory[start_index + start.len()..];
        if let Some(end_index) = after_start.find(end) {
            &after_start[..end_index]
        } else {
            after_start
        }
    }

    fn section_after<'a>(memory: &'a str, start: &str) -> &'a str {
        let Some(start_index) = memory.find(start) else {
            return "";
        };
        &memory[start_index + start.len()..]
    }

    #[test]
    fn delete_agent_removes_local_registry_and_workspace_but_blocks_system_agents() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-agent-delete-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&agent_root);
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
                name: "Delete Me".to_string(),
                handle: "@delete-me".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "temporary agent".to_string(),
            },
        )
        .unwrap()
        .agent;
        assert!(fs::metadata(&created.workspace_path).unwrap().is_dir());

        delete_agent(&broker, &created.id).unwrap();

        assert!(!std::path::Path::new(&created.workspace_path).exists());
        assert!(!list_agents(&broker)
            .agents
            .iter()
            .any(|agent| agent.id == created.id));
        let coordinator_id = "agent_global_coordinator";
        assert!(delete_agent(&broker, coordinator_id).is_err());
        assert!(list_agents(&broker)
            .agents
            .iter()
            .any(|agent| agent.id == coordinator_id));
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn broker_lists_global_coordinator_and_blocks_direct_message() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-coordinator-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&agent_root);
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let agents = list_agents(&broker);
        let coordinator = agents
            .agents
            .iter()
            .find(|agent| agent.agent_kind.as_deref() == Some("coordinator"))
            .expect("global coordinator should be listed");

        assert_eq!(coordinator.id, "agent_global_coordinator");
        assert_eq!(coordinator.handle, "@global-coordinator");
        assert_eq!(coordinator.channel_ids.as_deref(), Some(&[] as &[String]));
        assert_eq!(coordinator.runtime_kind, "ClaudeCode");
        assert!(fs::metadata(&coordinator.memory_path).unwrap().is_file());
        assert!(create_dm_conversation(&broker, &coordinator.id).is_err());
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn local_created_agent_channel_membership_is_ready() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-agent-channel-readiness-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&agent_root);
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
                name: "Ready Member".to_string(),
                handle: "@ready-member".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "频道成员状态测试".to_string(),
            },
        )
        .unwrap()
        .agent;

        let channel_members = list_channel_members(&broker, "all");
        let created_membership = channel_members
            .members
            .iter()
            .find(|member| member.agent_id == created.id)
            .expect("created agent should be a member of #all");
        assert_eq!(created_membership.readiness, "ready");
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn created_agents_stay_memory_only_and_do_not_write_local_registry() {
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

        assert!(!agent_root.join("agents/index.json").exists());

        let reloaded = DaemonBroker::for_tests(descriptor);
        let agents = list_agents(&reloaded);
        assert!(!agents.agents.iter().any(|agent| agent.id == created.id));
        assert!(agents
            .agents
            .iter()
            .any(|agent| agent.id == "agent_global_coordinator"));
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn local_agent_registry_json_is_not_recovered_as_product_state() {
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
        assert!(!recovered.agents.iter().any(|agent| agent.id == agent_id));
        assert!(recovered
            .agents
            .iter()
            .any(|agent| agent.id == "agent_global_coordinator"));

        let index_path = agent_root.join("agents/index.json");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(&index_path, "[]").unwrap();

        let healed = list_agents(&DaemonBroker::for_tests(descriptor));
        assert!(!healed.agents.iter().any(|agent| agent.id == agent_id));
        let index = fs::read_to_string(&index_path).unwrap();
        assert_eq!(index, "[]");
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

        let broker = DaemonBroker::for_tests(descriptor);
        assert_eq!(bootstrap_guide_agent(&broker).status, "created");
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

        let root_entries = list_agent_workspace(&broker, &agent.id, None).unwrap();
        assert!(root_entries
            .entries
            .iter()
            .any(|entry| entry.name == "MEMORY.md" && entry.kind == "file"));
        assert!(root_entries
            .entries
            .iter()
            .any(|entry| entry.name == ".claude" && entry.kind == "directory"));
        let skill_entries = list_agent_workspace(
            &broker,
            &agent.id,
            Some(".claude/skills/memory".to_string()),
        )
        .unwrap();
        assert!(skill_entries
            .entries
            .iter()
            .any(|entry| entry.name == "SKILL.md" && entry.kind == "file"));
        let skill = read_agent_workspace_file(&broker, &agent.id, ".claude/skills/memory/SKILL.md")
            .unwrap();
        assert_eq!(skill.name, "SKILL.md");
        assert!(skill.content.contains("\nname: memory\n"));
        assert!(skill.content.contains("\ndescription: "));
        let memory = read_agent_workspace_file(&broker, &agent.id, "MEMORY.md").unwrap();
        assert_eq!(memory.name, "MEMORY.md");
        assert!(memory.content.contains("开发 Agent"));
        assert!(list_agent_workspace(&broker, &agent.id, Some("../".to_string())).is_err());
        assert!(read_agent_workspace_file(&broker, &agent.id, "../settings.json").is_err());

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
    fn broker_startup_does_not_recover_legacy_skill_files_from_json_registry() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-legacy-skill-migration-{}",
            std::process::id()
        ));
        let workspace = agent_root.join("agents/agent_legacy");
        fs::create_dir_all(workspace.join("docs")).unwrap();
        fs::create_dir_all(workspace.join("skills")).unwrap();
        fs::write(
            workspace.join("MEMORY.md"),
            "# Legacy\n\n## Role\nLegacy agent",
        )
        .unwrap();
        fs::write(workspace.join("skills/index.json"), "[]").unwrap();
        fs::write(workspace.join("skills/memory.skill.md"), "legacy memory").unwrap();
        fs::write(workspace.join("skills/custom.skill.md"), "keep me").unwrap();
        fs::write(workspace.join("memory.skill.md"), "legacy root memory").unwrap();
        let agent = serde_json::json!([{
            "id": "agent_legacy",
            "name": "Legacy",
            "handle": "@legacy",
            "agentKind": "agent",
            "systemOwned": false,
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "Legacy agent",
            "workspacePath": workspace.to_string_lossy(),
            "memoryPath": workspace.join("MEMORY.md").to_string_lossy(),
            "docsPath": workspace.join("docs").to_string_lossy(),
            "avatarSeed": "agent_legacy",
            "runtimeThread": { "runtimeKind": "ClaudeCode", "status": "ready", "createdAt": "1" },
            "skills": [],
            "channelIds": ["all"],
            "createdAt": "1",
            "updatedAt": "1"
        }]);
        fs::create_dir_all(agent_root.join("agents")).unwrap();
        fs::write(
            agent_root.join("agents/index.json"),
            serde_json::to_string_pretty(&agent).unwrap(),
        )
        .unwrap();
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);

        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        assert!(list_agent_skills(&broker, "agent_legacy").is_err());
        assert!(!workspace.join(".claude/skills/memory/SKILL.md").exists());
        assert!(workspace.join("skills/index.json").exists());
        assert!(workspace.join("skills/memory.skill.md").exists());
        assert!(workspace.join("memory.skill.md").exists());
        assert!(workspace.join("skills/custom.skill.md").is_file());

        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn broker_startup_does_not_update_existing_guide_workspace_from_json_registry() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-guide-skill-update-{}",
            std::process::id()
        ));
        let workspace = agent_root.join("agents/agent_guide_local_node");
        let guide_skill = workspace.join(".claude/skills/guide-create/SKILL.md");
        fs::create_dir_all(guide_skill.parent().unwrap()).unwrap();
        fs::create_dir_all(workspace.join(".claude/skills/memory")).unwrap();
        fs::create_dir_all(workspace.join("docs")).unwrap();
        fs::write(
            workspace.join("MEMORY.md"),
            "# Yeal\n\n## Role\nGuide\n\n## Team\n@yeal — 我自己，Yeal\n",
        )
        .unwrap();
        fs::write(
            &guide_skill,
            "---\nname: guide-create\ndescription: old\n---\n\n# Guide Create\n\nFor each detected member, call the product tool.\n",
        )
        .unwrap();
        fs::write(
            workspace.join(".claude/skills/memory/SKILL.md"),
            "---\nname: memory\ndescription: old memory\n---\n",
        )
        .unwrap();
        let agent = serde_json::json!([{
            "id": "agent_guide_local_node",
            "name": "Yeal",
            "handle": "@yeal",
            "agentKind": "guide",
            "systemOwned": true,
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "Guide",
            "workspacePath": workspace.to_string_lossy(),
            "memoryPath": workspace.join("MEMORY.md").to_string_lossy(),
            "docsPath": workspace.join("docs").to_string_lossy(),
            "avatarSeed": "yeal",
            "runtimeThread": { "runtimeKind": "ClaudeCode", "status": "ready", "createdAt": "1" },
            "skills": [
                {
                    "id": "guide-create",
                    "name": "guide-create",
                    "trigger": "old",
                    "path": guide_skill.to_string_lossy()
                }
            ],
            "channelIds": ["all"],
            "createdAt": "1",
            "updatedAt": "1"
        }]);
        fs::create_dir_all(agent_root.join("agents")).unwrap();
        fs::write(
            agent_root.join("agents/index.json"),
            serde_json::to_string_pretty(&agent).unwrap(),
        )
        .unwrap();
        std::env::set_var("SLEI_DATA_ROOT", &agent_root);

        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let skill = read_agent_workspace_file(
            &broker,
            "agent_guide_local_node",
            ".claude/skills/guide-create/SKILL.md",
        );
        assert!(skill.is_err());
        let guide_skill_body = fs::read_to_string(&guide_skill).unwrap();
        assert!(guide_skill_body.contains("description: old"));
        assert!(!guide_skill_body.contains("slei_propose_interactive_card"));

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
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
            },
        )
        .unwrap();
        let conversations = list_conversations(&broker);
        assert_eq!(conversations.conversations.len(), 1);
        let messages = list_conversation_messages(&broker, &dm.id, None);
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
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
            },
        )
        .unwrap();
        let messages = list_conversation_messages(&broker, &dm.id, None);
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
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
            },
        )
        .unwrap();

        let messages = list_conversation_messages(&broker, &dm.id, None);
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
    fn agent_dm_streams_runtime_chunks_before_completion() {
        let _env_guard = test_env_lock();
        let agent_root = std::env::temp_dir().join(format!(
            "slei-desktop-conversation-streaming-test-{}",
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
                body: "__slei_streaming_runtime__".to_string(),
                session_id: None,
                attachment_ids: Vec::new(),
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
            },
        )
        .unwrap();

        let mut saw_streaming_chunk = false;
        for _ in 0..20 {
            let messages = list_conversation_messages(&broker, &dm.id, None).messages;
            if messages.iter().any(|message| {
                message.author_id == agent.id
                    && message.status.as_deref() == Some("running")
                    && message.body.contains("chunk 1")
            }) {
                saw_streaming_chunk = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(
            saw_streaming_chunk,
            "runtime chunk should be visible while the run is still running"
        );

        let mut completed = false;
        for _ in 0..40 {
            let messages = list_conversation_messages(&broker, &dm.id, None).messages;
            if messages.iter().any(|message| {
                message.author_id == agent.id
                    && message.status.as_deref() == Some("done")
                    && message.body.contains("chunk 1")
                    && message.body.contains("chunk 2")
            }) {
                completed = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(
            completed,
            "runtime stream should complete after visible chunks"
        );
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
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
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
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
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
        let guide_skill = read_agent_workspace_file(
            &broker,
            "agent_guide_local_node",
            ".claude/skills/guide-create/SKILL.md",
        )
        .unwrap();
        assert!(guide_skill
            .content
            .contains("slei_propose_interactive_card"));
        assert!(guide_skill.content.contains("Input schema"));
        assert!(guide_skill.content.contains("Output contract"));
        assert!(guide_skill.content.contains("Single agent example"));
        assert!(guide_skill.content.contains("Multiple agents example"));
        assert!(guide_skill.content.contains("Call the tool once per agent"));
        assert!(guide_skill
            .content
            .contains("simple random unused English name"));
        let dm = list_conversations(&broker).conversations[0].clone();
        send_conversation_message(
            &broker,
            &dm.id,
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: "__slei_delay_runtime__".to_string(),
                session_id: None,
                attachment_ids: Vec::new(),
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
            },
        )
        .unwrap();

        let messages = list_conversation_messages(&broker, &dm.id, None);
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
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
            },
        )
        .unwrap();

        let mut messages = list_conversation_messages(&broker, &dm.id, None).messages;
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
            messages = list_conversation_messages(&broker, &dm.id, None).messages;
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
        let reloaded_messages = list_conversation_messages(&broker, &dm.id, None).messages;
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

        let default_locale = list_preferences(&broker).preferences.locale;
        assert!(matches!(default_locale.as_str(), "zh-CN" | "en-US"));
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
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn profile_commands_round_trip_without_handle_mutation() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let responses = [
                (
                    "200 OK",
                    r#"{"profile":{"displayName":"Lei","handle":"lei","avatar":"pixel-sun"}}"#,
                ),
                (
                    "200 OK",
                    r#"{"profile":{"displayName":"Lei Lee","handle":"lei","avatar":"pixel-moon"}}"#,
                ),
                ("400 Bad Request", r#"{"error":"handle is immutable"}"#),
            ];
            let mut requests = Vec::new();
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 512];
                loop {
                    let count = std::io::Read::read(&mut stream, &mut buffer).unwrap();
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                    let request = String::from_utf8_lossy(&bytes);
                    let Some(header_end) = request.find("\r\n\r\n") else {
                        continue;
                    };
                    let content_length = request
                        .lines()
                        .find_map(|line| line.strip_prefix("Content-Length: "))
                        .and_then(|value| value.parse::<usize>().ok())
                        .unwrap_or(0);
                    if bytes.len() >= header_end + 4 + content_length {
                        break;
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());
                std::io::Write::write_all(
                    &mut stream,
                    format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                )
                .unwrap();
            }
            requests
        });
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let profile = list_profile(&broker).profile.unwrap();
        assert_eq!(profile.handle, "lei");

        let updated = update_profile(
            &broker,
            ProfileUpdateRequest {
                display_name: Some("Lei Lee".to_string()),
                avatar: Some("pixel-moon".to_string()),
                handle: None,
            },
        )
        .unwrap();
        let updated_profile = updated.profile.unwrap();
        assert_eq!(updated_profile.display_name, "Lei Lee");
        assert_eq!(updated_profile.avatar, "pixel-moon");
        let error = update_profile(
            &broker,
            ProfileUpdateRequest {
                display_name: None,
                avatar: None,
                handle: Some("other".to_string()),
            },
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("handle is immutable"));
        assert!(!error.contains("daemon unavailable"));
        let requests = handle.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests[0].contains("GET /v1/settings/profile HTTP/1.1"));
        assert!(requests[0].contains("Authorization: Bearer secret-token"));
        assert!(requests[1].contains("PATCH /v1/settings/profile HTTP/1.1"));
        assert!(requests[1].contains("Authorization: Bearer secret-token"));
        assert!(requests[1].contains(r#""displayName":"Lei Lee""#));
        assert!(requests[1].contains(r#""avatar":"pixel-moon""#));
        assert!(requests[1].contains(r#""handle":null"#));
        assert!(requests[2].contains("PATCH /v1/settings/profile HTTP/1.1"));
        assert!(requests[2].contains("Authorization: Bearer secret-token"));
        assert!(requests[2].contains(r#""handle":"other""#));
    }

    #[test]
    fn broker_does_not_persist_product_state_json_when_daemon_unavailable() {
        let _env_guard = test_env_lock();
        let root = std::env::temp_dir().join(format!(
            "slei-desktop-no-json-fallback-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        std::env::set_var("SLEI_DATA_ROOT", &root);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let broker = DaemonBroker::for_tests_empty_fallback(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: format!("ws://127.0.0.1:{port}/v1/events/ws"),
            token: "desktop-session-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let _ = update_preferences(
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
        );
        assert!(list_agents(&broker).agents.is_empty());
        assert!(list_conversations(&broker).conversations.is_empty());
        assert!(list_saved_messages(&broker).saved_messages.is_empty());
        assert!(list_agent_workspace(&broker, "agent_missing", None).is_err());
        assert!(read_agent_workspace_file(&broker, "agent_missing", "MEMORY.md").is_err());
        assert!(create_agent(
            &broker,
            AgentCreateRequest {
                name: "Offline".to_string(),
                handle: "@offline".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "should not be created locally".to_string(),
            },
        )
        .is_err());
        assert!(save_message(
            &broker,
            SaveMessageRequest {
                message_id: "msg_1".to_string(),
                source_id: "dm:agent_missing".to_string(),
                source_kind: "dm".to_string(),
                session_id: None,
            },
        )
        .is_err());

        assert!(!root.join("settings/preferences.json").exists());
        assert!(!root.join("agents/index.json").exists());
        assert!(!root.join("conversations/index.json").exists());
        assert!(!root.join("conversations/sessions.json").exists());
        assert!(!root.join("saved/messages.json").exists());
        assert!(!root.join("attachments/index.json").exists());
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn default_local_rejects_offline_channel_message_mutations_without_memory_state() {
        let _env_guard = test_env_lock();
        let root = std::env::temp_dir().join(format!(
            "slei-desktop-offline-channel-mutation-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        std::env::set_var("SLEI_DATA_ROOT", &root);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let broker = DaemonBroker::for_tests_empty_fallback(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: format!("ws://127.0.0.1:{port}/v1/events/ws"),
            token: "desktop-session-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        for as_task in [false, true] {
            let result = send_channel_message(
                &broker,
                "all",
                SendChannelMessageRequest {
                    author_id: "human_lei".to_string(),
                    body: format!("offline mutation should fail as_task={as_task}"),
                    as_task,
                },
            );

            assert!(result.is_err());
        }

        assert!(list_channel_messages(&broker, "all", None)
            .messages
            .is_empty());
        assert!(list_tasks(
            &broker,
            TaskListQuery {
                channel_id: Some("all".to_string()),
                creator_id: None,
                assignee_id: None,
            },
        )
        .tasks
        .is_empty());
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn default_local_rejects_offline_preferences_and_node_mutations_without_memory_state() {
        let _env_guard = test_env_lock();
        let root = std::env::temp_dir().join(format!(
            "slei-desktop-offline-settings-mutation-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        std::env::set_var("SLEI_DATA_ROOT", &root);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let broker = DaemonBroker::for_tests_empty_fallback(RuntimeDescriptor {
            endpoint: format!("http://127.0.0.1:{port}"),
            event_socket: format!("ws://127.0.0.1:{port}/v1/events/ws"),
            token: "desktop-session-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let original_preferences = list_preferences(&broker).preferences;
        let original_node_name = list_nodes(&broker).nodes[0].name.clone();

        let preferences_result = update_preferences(
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
        );
        let rename_result = rename_local_node(&broker, "Lei MacBook");

        assert!(preferences_result.is_err());
        assert!(rename_result.is_err());
        let current_preferences = list_preferences(&broker).preferences;
        assert_eq!(current_preferences.locale, original_preferences.locale);
        assert_eq!(
            current_preferences.time_zone,
            original_preferences.time_zone
        );
        assert_eq!(
            current_preferences.notifications.human_replies,
            original_preferences.notifications.human_replies
        );
        assert_eq!(list_nodes(&broker).nodes[0].name, original_node_name);
        std::env::remove_var("SLEI_DATA_ROOT");
    }

    #[test]
    fn saved_messages_are_memory_only_and_support_unsave() {
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
        assert!(!root.join("saved/messages.json").exists());

        let restarted = DaemonBroker::for_tests(descriptor);
        let reloaded = list_saved_messages(&restarted);
        assert!(reloaded.saved_messages.is_empty());
        let serialized = serde_json::to_string(&reloaded).unwrap();
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));

        unsave_message(&broker, "msg_1").unwrap();
        assert!(list_saved_messages(&broker).saved_messages.is_empty());
        std::env::remove_var("SLEI_DATA_ROOT");
    }
}
