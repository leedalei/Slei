use crate::daemon_broker::{
    AgentCreateRequest, AgentError, AgentListReceipt, AgentPathError, AgentPathOpenReceipt,
    AgentReceipt, AgentUpdateRequest, ArtifactOpenError, ArtifactOpenReceipt, CardError,
    ChannelCreateRequest, ChannelError, ChannelListReceipt, ChannelMemberListReceipt,
    ChannelReceipt, ConversationAttachmentReceipt, ConversationAttachmentUploadRequest,
    ConversationError, ConversationListReceipt, ConversationMessageListReceipt,
    ConversationMessageReceipt, ConversationMessageRequest, ConversationReceipt,
    ConversationSessionListReceipt, ConversationSessionReceipt, DaemonBroker,
    EventReconnectReceipt, GuideBootstrapReceipt, InteractiveCardReceipt, NodeListReceipt,
    NodeNameError, NodeRenameReceipt, PermissionResolveRequest, PreferencesError,
    PreferencesReceipt, PreferencesUpdateRequest, SanitizedDaemonStatus, SaveMessageRequest,
    SavedMessageListReceipt, SavedMessageReceipt, SendChannelMessageReceipt,
    SendChannelMessageRequest, SkillListReceipt,
};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendCrashReport {
    pub kind: String,
    pub message: String,
    pub stack: Option<String>,
    pub component_stack: Option<String>,
    pub url: String,
}

fn truncate_frontend_log_value(value: &str) -> String {
    value.chars().take(4000).collect()
}

pub fn format_frontend_crash_log(report: &FrontendCrashReport) -> String {
    format!(
        "[slei-frontend-crash] kind={} url={} message={} stack={} component_stack={}",
        truncate_frontend_log_value(&report.kind),
        truncate_frontend_log_value(&report.url),
        truncate_frontend_log_value(&report.message),
        truncate_frontend_log_value(report.stack.as_deref().unwrap_or("")),
        truncate_frontend_log_value(report.component_stack.as_deref().unwrap_or(""))
    )
}

pub fn log_frontend_crash(report: FrontendCrashReport) {
    eprintln!("{}", format_frontend_crash_log(&report));
}

pub fn daemon_status(broker: &DaemonBroker) -> SanitizedDaemonStatus {
    broker.status()
}

pub fn reconnect_events(broker: &DaemonBroker, after: u64) -> EventReconnectReceipt {
    broker.reconnect_events(after)
}

pub fn request_artifact_open(
    broker: &DaemonBroker,
    artifact_id: &str,
) -> Result<ArtifactOpenReceipt, ArtifactOpenError> {
    broker.request_artifact_open(artifact_id)
}

pub fn list_nodes(broker: &DaemonBroker) -> NodeListReceipt {
    broker.list_nodes()
}

pub fn refresh_runtime_status(broker: &DaemonBroker) -> NodeListReceipt {
    broker.refresh_runtime_status()
}

pub fn rename_local_node(
    broker: &DaemonBroker,
    name: &str,
) -> Result<NodeRenameReceipt, NodeNameError> {
    broker.rename_local_node(name)
}

pub fn list_preferences(broker: &DaemonBroker) -> PreferencesReceipt {
    broker.list_preferences()
}

pub fn bootstrap_guide_agent(broker: &DaemonBroker) -> GuideBootstrapReceipt {
    broker.bootstrap_guide_agent()
}

pub fn list_channels(broker: &DaemonBroker) -> ChannelListReceipt {
    broker.list_channels()
}

pub fn create_channel(
    broker: &DaemonBroker,
    request: ChannelCreateRequest,
) -> Result<ChannelReceipt, ChannelError> {
    broker.create_channel(request)
}

pub fn list_channel_members(broker: &DaemonBroker, channel_id: &str) -> ChannelMemberListReceipt {
    broker.list_channel_members(channel_id)
}

pub fn send_channel_message(
    broker: &DaemonBroker,
    channel_id: &str,
    request: SendChannelMessageRequest,
) -> Result<SendChannelMessageReceipt, ChannelError> {
    broker.send_channel_message(channel_id, request)
}

pub fn complete_interactive_card(
    broker: &DaemonBroker,
    card_id: &str,
) -> Result<InteractiveCardReceipt, CardError> {
    broker.complete_interactive_card(card_id)
}

pub fn update_preferences(
    broker: &DaemonBroker,
    request: PreferencesUpdateRequest,
) -> Result<PreferencesReceipt, PreferencesError> {
    broker.update_preferences(request)
}

pub fn list_agents(broker: &DaemonBroker) -> AgentListReceipt {
    broker.list_agents()
}

pub fn create_agent(
    broker: &DaemonBroker,
    request: AgentCreateRequest,
) -> Result<AgentReceipt, AgentError> {
    broker.create_agent(request)
}

pub fn update_agent(
    broker: &DaemonBroker,
    agent_id: &str,
    request: AgentUpdateRequest,
) -> Result<AgentReceipt, AgentError> {
    broker.update_agent(agent_id, request)
}

pub fn remember_agent_fact(
    broker: &DaemonBroker,
    agent_id: &str,
    fact: &str,
) -> Result<AgentReceipt, AgentError> {
    broker.remember_agent_fact(agent_id, fact)
}

pub fn list_agent_skills(
    broker: &DaemonBroker,
    agent_id: &str,
) -> Result<SkillListReceipt, AgentError> {
    broker.list_agent_skills(agent_id)
}

pub fn open_agent_path(
    broker: &DaemonBroker,
    agent_id: &str,
    target: &str,
) -> Result<AgentPathOpenReceipt, AgentPathError> {
    broker.open_agent_path(agent_id, target)
}

pub fn list_conversations(broker: &DaemonBroker) -> ConversationListReceipt {
    broker.list_conversations()
}

pub fn create_dm_conversation(
    broker: &DaemonBroker,
    agent_id: &str,
) -> Result<ConversationReceipt, ConversationError> {
    broker.create_dm_conversation(agent_id)
}

pub fn reset_conversation_runtime_session(
    broker: &DaemonBroker,
    conversation_id: &str,
) -> Result<ConversationReceipt, ConversationError> {
    broker.reset_conversation_runtime_session(conversation_id)
}

pub fn list_conversation_sessions(
    broker: &DaemonBroker,
    conversation_id: &str,
) -> ConversationSessionListReceipt {
    broker.list_conversation_sessions(conversation_id)
}

pub fn create_conversation_session(
    broker: &DaemonBroker,
    conversation_id: &str,
) -> Result<ConversationSessionReceipt, ConversationError> {
    broker.create_conversation_session(conversation_id)
}

pub fn activate_conversation_session(
    broker: &DaemonBroker,
    conversation_id: &str,
    session_id: &str,
) -> Result<ConversationSessionReceipt, ConversationError> {
    broker.activate_conversation_session(conversation_id, session_id)
}

pub fn upload_conversation_attachment(
    broker: &DaemonBroker,
    request: ConversationAttachmentUploadRequest,
) -> Result<ConversationAttachmentReceipt, ConversationError> {
    broker.upload_conversation_attachment(request)
}

pub fn list_saved_messages(broker: &DaemonBroker) -> SavedMessageListReceipt {
    broker.list_saved_messages()
}

pub fn save_message(
    broker: &DaemonBroker,
    request: SaveMessageRequest,
) -> Result<SavedMessageReceipt, ConversationError> {
    broker.save_message(request)
}

pub fn unsave_message(broker: &DaemonBroker, message_id: &str) -> Result<(), ConversationError> {
    broker.unsave_message(message_id)
}

pub fn list_conversation_messages(
    broker: &DaemonBroker,
    conversation_id: &str,
) -> ConversationMessageListReceipt {
    broker.list_conversation_messages(conversation_id)
}

pub fn send_conversation_message(
    broker: &DaemonBroker,
    conversation_id: &str,
    request: ConversationMessageRequest,
) -> Result<ConversationMessageReceipt, ConversationError> {
    broker.send_conversation_message(conversation_id, request)
}

pub fn resolve_permission(
    broker: &DaemonBroker,
    request: PermissionResolveRequest,
) -> Result<ConversationMessageReceipt, ConversationError> {
    broker.resolve_permission(request)
}

#[tauri::command]
pub fn log_frontend_crash_command(report: FrontendCrashReport) {
    log_frontend_crash(report);
}

#[tauri::command]
pub fn daemon_status_command(state: tauri::State<'_, DaemonBroker>) -> SanitizedDaemonStatus {
    daemon_status(state.inner())
}

#[tauri::command]
pub fn reconnect_events_command(
    state: tauri::State<'_, DaemonBroker>,
    after: u64,
) -> EventReconnectReceipt {
    reconnect_events(state.inner(), after)
}

#[tauri::command]
pub fn list_nodes_command(state: tauri::State<'_, DaemonBroker>) -> NodeListReceipt {
    list_nodes(state.inner())
}

#[tauri::command]
pub fn refresh_runtime_status_command(state: tauri::State<'_, DaemonBroker>) -> NodeListReceipt {
    refresh_runtime_status(state.inner())
}

#[tauri::command]
pub fn rename_local_node_command(
    state: tauri::State<'_, DaemonBroker>,
    name: String,
) -> Result<NodeRenameReceipt, String> {
    rename_local_node(state.inner(), &name).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_preferences_command(state: tauri::State<'_, DaemonBroker>) -> PreferencesReceipt {
    list_preferences(state.inner())
}

#[tauri::command]
pub fn update_preferences_command(
    state: tauri::State<'_, DaemonBroker>,
    request: PreferencesUpdateRequest,
) -> Result<PreferencesReceipt, String> {
    update_preferences(state.inner(), request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn bootstrap_guide_agent_command(
    state: tauri::State<'_, DaemonBroker>,
) -> GuideBootstrapReceipt {
    bootstrap_guide_agent(state.inner())
}

#[tauri::command]
pub fn list_channels_command(state: tauri::State<'_, DaemonBroker>) -> ChannelListReceipt {
    list_channels(state.inner())
}

#[tauri::command]
pub fn create_channel_command(
    state: tauri::State<'_, DaemonBroker>,
    request: ChannelCreateRequest,
) -> Result<ChannelReceipt, String> {
    create_channel(state.inner(), request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_channel_members_command(
    state: tauri::State<'_, DaemonBroker>,
    channel_id: String,
) -> ChannelMemberListReceipt {
    list_channel_members(state.inner(), &channel_id)
}

#[tauri::command]
pub fn send_channel_message_command(
    state: tauri::State<'_, DaemonBroker>,
    channel_id: String,
    request: SendChannelMessageRequest,
) -> Result<SendChannelMessageReceipt, String> {
    send_channel_message(state.inner(), &channel_id, request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn complete_interactive_card_command(
    state: tauri::State<'_, DaemonBroker>,
    card_id: String,
) -> Result<InteractiveCardReceipt, String> {
    complete_interactive_card(state.inner(), &card_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_agents_command(state: tauri::State<'_, DaemonBroker>) -> AgentListReceipt {
    list_agents(state.inner())
}

#[tauri::command]
pub fn create_agent_command(
    state: tauri::State<'_, DaemonBroker>,
    request: AgentCreateRequest,
) -> Result<AgentReceipt, String> {
    create_agent(state.inner(), request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_agent_command(
    state: tauri::State<'_, DaemonBroker>,
    agent_id: String,
    request: AgentUpdateRequest,
) -> Result<AgentReceipt, String> {
    update_agent(state.inner(), &agent_id, request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn remember_agent_fact_command(
    state: tauri::State<'_, DaemonBroker>,
    agent_id: String,
    fact: String,
) -> Result<AgentReceipt, String> {
    remember_agent_fact(state.inner(), &agent_id, &fact).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_agent_skills_command(
    state: tauri::State<'_, DaemonBroker>,
    agent_id: String,
) -> Result<SkillListReceipt, String> {
    list_agent_skills(state.inner(), &agent_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_agent_path_command(
    state: tauri::State<'_, DaemonBroker>,
    agent_id: String,
    target: String,
) -> Result<AgentPathOpenReceipt, String> {
    open_agent_path(state.inner(), &agent_id, &target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_conversations_command(
    state: tauri::State<'_, DaemonBroker>,
) -> ConversationListReceipt {
    list_conversations(state.inner())
}

#[tauri::command]
pub fn create_dm_conversation_command(
    state: tauri::State<'_, DaemonBroker>,
    agent_id: String,
) -> Result<ConversationReceipt, String> {
    create_dm_conversation(state.inner(), &agent_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reset_conversation_runtime_session_command(
    state: tauri::State<'_, DaemonBroker>,
    conversation_id: String,
) -> Result<ConversationReceipt, String> {
    reset_conversation_runtime_session(state.inner(), &conversation_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_conversation_messages_command(
    state: tauri::State<'_, DaemonBroker>,
    conversation_id: String,
) -> ConversationMessageListReceipt {
    list_conversation_messages(state.inner(), &conversation_id)
}

#[tauri::command]
pub fn list_conversation_sessions_command(
    state: tauri::State<'_, DaemonBroker>,
    conversation_id: String,
) -> ConversationSessionListReceipt {
    list_conversation_sessions(state.inner(), &conversation_id)
}

#[tauri::command]
pub fn create_conversation_session_command(
    state: tauri::State<'_, DaemonBroker>,
    conversation_id: String,
) -> Result<ConversationSessionReceipt, String> {
    create_conversation_session(state.inner(), &conversation_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn activate_conversation_session_command(
    state: tauri::State<'_, DaemonBroker>,
    conversation_id: String,
    session_id: String,
) -> Result<ConversationSessionReceipt, String> {
    activate_conversation_session(state.inner(), &conversation_id, &session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn send_conversation_message_command(
    state: tauri::State<'_, DaemonBroker>,
    conversation_id: String,
    request: ConversationMessageRequest,
) -> Result<ConversationMessageReceipt, String> {
    send_conversation_message(state.inner(), &conversation_id, request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upload_conversation_attachment_command(
    state: tauri::State<'_, DaemonBroker>,
    request: ConversationAttachmentUploadRequest,
) -> Result<ConversationAttachmentReceipt, String> {
    upload_conversation_attachment(state.inner(), request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resolve_permission_command(
    state: tauri::State<'_, DaemonBroker>,
    request: PermissionResolveRequest,
) -> Result<ConversationMessageReceipt, String> {
    resolve_permission(state.inner(), request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_saved_messages_command(
    state: tauri::State<'_, DaemonBroker>,
) -> SavedMessageListReceipt {
    list_saved_messages(state.inner())
}

#[tauri::command]
pub fn save_message_command(
    state: tauri::State<'_, DaemonBroker>,
    request: SaveMessageRequest,
) -> Result<SavedMessageReceipt, String> {
    save_message(state.inner(), request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn unsave_message_command(
    state: tauri::State<'_, DaemonBroker>,
    message_id: String,
) -> Result<(), String> {
    unsave_message(state.inner(), &message_id).map_err(|error| error.to_string())
}
