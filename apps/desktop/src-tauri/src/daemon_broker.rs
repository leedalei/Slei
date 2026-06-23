use std::{
    env, fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use slei_default_agent_assets::{
    initial_memory as shared_initial_memory, standard_skill_assets, AgentTemplateInput,
};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct RuntimeDescriptor {
    pub endpoint: String,
    pub event_socket: String,
    pub token: String,
    pub daemon_version: String,
    pub protocol_version: String,
}

#[derive(Debug)]
pub struct DaemonBroker {
    descriptor: RuntimeDescriptor,
    data_root: String,
    offline_fallback: OfflineFallback,
    last_authorization_header: Mutex<Option<String>>,
    local_node_name: Mutex<String>,
    agents: Mutex<Vec<DesktopAgentView>>,
    channels: Mutex<Vec<ChannelView>>,
    channel_sessions: Mutex<Vec<ChannelSessionView>>,
    channel_members: Mutex<Vec<ChannelMemberView>>,
    channel_messages: Mutex<Vec<ChannelMessageView>>,
    tasks: Mutex<Vec<TaskSummaryView>>,
    task_threads: Mutex<Vec<TaskThreadView>>,
    cards: Mutex<Vec<InteractiveCardView>>,
    conversations: Arc<Mutex<Vec<ConversationView>>>,
    conversation_sessions: Mutex<Vec<ConversationSessionView>>,
    conversation_messages: Arc<Mutex<Vec<ConversationMessageView>>>,
    conversation_attachments: Mutex<Vec<ConversationAttachmentView>>,
    preferences: Mutex<UserPreferencesView>,
    profile: Mutex<Option<UserProfileView>>,
    diagnostic_events: Mutex<Vec<String>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OfflineFallback {
    Empty,
    MemoryOnly,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizedDaemonStatus {
    pub connected: bool,
    pub daemon_version: String,
    pub protocol_version: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct EventReconnectReceipt {
    pub after: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactOpenReceipt {
    pub artifact_id: String,
    pub open_token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadinessView {
    pub kind: String,
    pub readiness: String,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMetaView {
    pub platform: String,
    pub arch: String,
    pub hostname: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNodeView {
    pub id: String,
    pub name: String,
    pub status: String,
    #[serde(alias = "daemon_version")]
    pub daemon_version: String,
    pub device: DeviceMetaView,
    pub runtimes: Vec<RuntimeReadinessView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeListReceipt {
    pub nodes: Vec<DesktopNodeView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRenameReceipt {
    pub node: DesktopNodeView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPreferencesView {
    pub mentions: bool,
    pub human_replies: bool,
    pub approvals: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferencesView {
    pub locale: String,
    pub time_zone: String,
    pub appearance: AppearancePreferencesView,
    pub notifications: NotificationPreferencesView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearancePreferencesView {
    pub theme: String,
    pub font_size: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesReceipt {
    pub preferences: UserPreferencesView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeFlagsView {
    pub debug: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEventView {
    pub sequence: u64,
    pub event_type: String,
    pub entity_id: String,
    pub payload: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshotView {
    pub node: String,
    pub runtime: String,
    pub worker: String,
    pub protocol_version: String,
    pub schema_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_summary: Option<String>,
    pub agent_inbox_event_count: u64,
    pub memory_update_event_count: u64,
    pub recent_events: Vec<DiagnosticEventView>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesUpdateRequest {
    pub locale: Option<String>,
    pub time_zone: Option<String>,
    pub appearance: Option<AppearancePreferencesView>,
    pub notifications: Option<NotificationPreferencesView>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileView {
    pub display_name: String,
    pub handle: String,
    pub avatar: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileReceipt {
    pub profile: Option<UserProfileView>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdateRequest {
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub handle: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentView {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub agent_kind: Option<String>,
    pub system_owned: Option<bool>,
    pub runtime_kind: String,
    pub model: String,
    pub node_id: String,
    pub description: String,
    pub workspace_path: String,
    pub memory_path: String,
    pub docs_path: String,
    pub avatar_seed: String,
    pub runtime_thread: Option<RuntimeThreadView>,
    pub skills: Option<Vec<SkillView>>,
    pub channel_ids: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeThreadView {
    pub runtime_kind: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    pub id: String,
    pub name: String,
    pub trigger: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListReceipt {
    pub agents: Vec<DesktopAgentView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityLogView {
    pub id: String,
    pub agent_id: String,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub state: String,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub event_kind: String,
    pub severity: String,
    pub summary: String,
    pub payload_preview: Option<String>,
    pub tool_name: Option<String>,
    pub ok: Option<bool>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityListReceipt {
    pub logs: Vec<AgentActivityLogView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReceipt {
    pub agent: DesktopAgentView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillListReceipt {
    pub skills: Vec<SkillView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPathOpenReceipt {
    pub agent_id: String,
    pub target: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceEntry {
    pub kind: String,
    pub name: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceListReceipt {
    pub agent_id: String,
    pub relative_path: String,
    pub entries: Vec<AgentWorkspaceEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceFileReceipt {
    pub agent_id: String,
    pub content: String,
    pub name: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateRequest {
    pub name: String,
    pub handle: String,
    #[serde(alias = "runtimeKind")]
    pub runtime_kind: String,
    pub model: String,
    #[serde(alias = "nodeId")]
    pub node_id: String,
    pub description: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdateRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(alias = "runtimeKind")]
    pub runtime_kind: Option<String>,
    pub model: Option<String>,
    #[serde(alias = "nodeId")]
    pub node_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationView {
    pub id: String,
    pub kind: String,
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_session: Option<RuntimeSessionView>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSessionView {
    pub runtime_kind: String,
    pub session_id: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSessionView {
    pub id: String,
    pub conversation_id: String,
    pub title: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_session: Option<RuntimeSessionView>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationAttachmentView {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageView {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<i64>,
    pub conversation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub author_id: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<ConversationAttachmentView>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cards: Option<Vec<InteractiveCardView>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread: Option<MessageThreadSummaryView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelView {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default, alias = "projectPaths")]
    pub project_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSessionView {
    pub id: String,
    pub channel_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberView {
    pub channel_id: String,
    pub agent_id: String,
    pub joined_at: String,
    pub readiness: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelListReceipt {
    pub channels: Vec<ChannelView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelReceipt {
    pub channel: ChannelView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDeleteReceipt {
    pub deleted_channel: ChannelView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSessionListReceipt {
    pub sessions: Vec<ChannelSessionView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSessionReceipt {
    pub channel: ChannelView,
    pub session: ChannelSessionView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCreateRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default, alias = "agentIds")]
    pub agent_ids: Vec<String>,
    #[serde(default, alias = "projectPaths")]
    pub project_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelProjectPathsRequest {
    #[serde(default, alias = "projectPaths")]
    pub project_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberAddRequest {
    pub agent_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberListReceipt {
    pub members: Vec<ChannelMemberView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberReceipt {
    pub member: ChannelMemberView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberRemoveReceipt {
    pub removed_member: Option<ChannelMemberView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageView {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<i64>,
    pub channel_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub author_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cards: Option<Vec<InteractiveCardView>>,
    pub kind: String,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub edited: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread: Option<MessageThreadSummaryView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<TaskSummaryView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageListReceipt {
    pub messages: Vec<ChannelMessageView>,
    pub page_info: MessagePageInfo,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePageQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub around_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePageInfo {
    pub has_more_before: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oldest_cursor: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub newest_cursor: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageRequest {
    pub author_id: String,
    pub body: String,
    #[serde(default)]
    pub as_task: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageOutcome {
    pub message_id: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee_agent_id: Option<String>,
    #[serde(default)]
    pub assignee_agent_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordinator_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision_status: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageReceipt {
    pub outcome: SendChannelMessageOutcome,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummaryView {
    pub id: String,
    pub channel_id: String,
    pub creator_id: String,
    pub assignee_id: Option<String>,
    pub source_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    pub title: String,
    pub status: String,
    pub attention_required: bool,
    pub reply_count: usize,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadMessageView {
    pub id: String,
    pub task_id: String,
    pub sender_id: String,
    pub role: String,
    pub body: String,
    pub status: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadView {
    pub task: TaskSummaryView,
    pub root: TaskThreadMessageView,
    pub replies: Vec<TaskThreadMessageView>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListQuery {
    pub channel_id: Option<String>,
    pub creator_id: Option<String>,
    pub assignee_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListReceipt {
    pub tasks: Vec<TaskSummaryView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadReceipt {
    pub thread: TaskThreadView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyRequest {
    pub sender_id: String,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyRoute {
    pub handoff_agent_ids: Vec<String>,
    pub needs_assignment: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyReceipt {
    pub reply: TaskThreadMessageView,
    pub route: TaskReplyRoute,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusUpdateRequest {
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReceipt {
    pub task: TaskSummaryView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveCardView {
    pub id: String,
    pub kind: String,
    pub state: String,
    pub title: String,
    pub summary: String,
    pub draft: serde_json::Value,
    pub action_label: String,
    pub done_label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveCardReceipt {
    pub card: InteractiveCardView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideBootstrapReceipt {
    pub status: String,
    pub agent: Option<DesktopAgentView>,
    pub conversation: Option<ConversationView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationListReceipt {
    pub conversations: Vec<ConversationView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationReceipt {
    pub conversation: ConversationView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSessionListReceipt {
    pub sessions: Vec<ConversationSessionView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSessionReceipt {
    pub conversation: ConversationView,
    pub session: ConversationSessionView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageListReceipt {
    pub messages: Vec<ConversationMessageView>,
    pub page_info: MessagePageInfo,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadSummaryView {
    pub id: String,
    pub source_message_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub reply_count: usize,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadReplyView {
    pub id: String,
    pub thread_id: String,
    pub sender_id: String,
    pub role: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadReceipt {
    pub thread: MessageThreadSummaryView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replies: Option<Vec<MessageThreadReplyView>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadReplyReceipt {
    pub reply: MessageThreadReplyView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageThreadRequest {
    pub source_message_id: String,
    pub created_by: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyToMessageThreadRequest {
    pub sender_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageReceipt {
    pub message: ConversationMessageView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMountView {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResolveRequest {
    pub request_id: String,
    pub decision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRequest {
    pub author_id: String,
    pub body: String,
    pub session_id: Option<String>,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    #[serde(default, alias = "workspaceMounts")]
    pub workspace_mounts: Vec<WorkspaceMountView>,
    #[serde(default, alias = "sourceChannelId")]
    pub source_channel_id: Option<String>,
    #[serde(default, alias = "sourceChannelName")]
    pub source_channel_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationAttachmentUploadRequest {
    pub name: String,
    pub mime_type: String,
    pub bytes_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationAttachmentReceipt {
    pub attachment: ConversationAttachmentView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMessageView {
    pub id: String,
    pub message_id: String,
    pub source_id: String,
    pub source_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub saved_at: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub author_id: String,
    #[serde(default)]
    pub author_name: String,
    #[serde(default)]
    pub message_created_at: String,
    #[serde(default)]
    pub source_name: String,
    #[serde(default)]
    pub source_label: String,
    #[serde(default)]
    pub message_deleted: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMessageListReceipt {
    pub saved_messages: Vec<SavedMessageView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMessageReceipt {
    pub saved_message: SavedMessageView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMessageRequest {
    pub message_id: String,
    pub source_id: String,
    pub source_kind: String,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchQuery {
    #[serde(alias = "query")]
    pub q: String,
    pub from_id: Option<String>,
    pub channel_id: Option<String>,
    pub time_range: Option<String>,
    pub time_zone: Option<String>,
    pub include_agents: Option<bool>,
    pub include_channels: Option<bool>,
    pub include_messages: Option<bool>,
    pub agent_limit: Option<i64>,
    pub channel_limit: Option<i64>,
    pub message_limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchReceipt {
    pub query: String,
    pub totals: GlobalSearchTotals,
    pub agents: Vec<GlobalAgentSearchResult>,
    pub channels: Vec<GlobalChannelSearchResult>,
    pub messages: Vec<GlobalMessageSearchResult>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchTotals {
    pub agents: usize,
    pub channels: usize,
    pub messages: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalAgentSearchResult {
    pub kind: String,
    pub agent_id: String,
    pub title: String,
    pub subtitle: String,
    pub avatar_seed: String,
    pub matched_fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalChannelSearchResult {
    pub kind: String,
    pub channel_id: String,
    pub title: String,
    pub subtitle: String,
    pub matched_fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMessageSearchResult {
    pub kind: String,
    pub source_kind: String,
    pub message_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_label: Option<String>,
    pub snippet: String,
    pub created_at: String,
    #[serde(default)]
    pub matched_fields: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum GlobalSearchError {
    #[error("daemon request failed: {0}")]
    DaemonRequest(String),
    #[error("daemon response invalid: {0}")]
    DaemonResponse(String),
}

impl DaemonBroker {
    pub fn default_local() -> Self {
        Self::new(
            RuntimeDescriptor {
                endpoint: "http://127.0.0.1:4319".to_string(),
                event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
                token: "desktop-session-token".to_string(),
                daemon_version: "0.1.0".to_string(),
                protocol_version: "v1".to_string(),
            },
            OfflineFallback::Empty,
        )
    }

    pub fn for_tests(descriptor: RuntimeDescriptor) -> Self {
        Self::new(descriptor, OfflineFallback::MemoryOnly)
    }

    #[cfg(test)]
    pub fn for_tests_empty_fallback(descriptor: RuntimeDescriptor) -> Self {
        Self::new(descriptor, OfflineFallback::Empty)
    }

    fn new(descriptor: RuntimeDescriptor, offline_fallback: OfflineFallback) -> Self {
        let data_root = local_data_root();
        Self {
            descriptor,
            data_root: data_root.clone(),
            offline_fallback,
            last_authorization_header: Mutex::new(None),
            local_node_name: Mutex::new("本机设备".to_string()),
            agents: Mutex::new(Vec::new()),
            channels: Mutex::new(vec![ChannelView {
                id: "all".to_string(),
                name: "all".to_string(),
                description: Some("默认团队频道".to_string()),
                is_default: Some(true),
                active_session_id: Some("session:channel:all:default".to_string()),
                project_paths: Vec::new(),
            }]),
            channel_sessions: Mutex::new(vec![ChannelSessionView {
                id: "session:channel:all:default".to_string(),
                channel_id: "all".to_string(),
                title: "新会话".to_string(),
                status: "ready".to_string(),
                created_at: "0".to_string(),
                updated_at: "0".to_string(),
            }]),
            channel_members: Mutex::new(Vec::new()),
            channel_messages: Mutex::new(Vec::new()),
            tasks: Mutex::new(Vec::new()),
            task_threads: Mutex::new(Vec::new()),
            cards: Mutex::new(Vec::new()),
            conversations: Arc::new(Mutex::new(Vec::new())),
            conversation_sessions: Mutex::new(Vec::new()),
            conversation_messages: Arc::new(Mutex::new(Vec::new())),
            conversation_attachments: Mutex::new(Vec::new()),
            preferences: Mutex::new(default_preferences()),
            profile: Mutex::new(None),
            diagnostic_events: Mutex::new(Vec::new()),
        }
    }

    pub fn status(&self) -> SanitizedDaemonStatus {
        SanitizedDaemonStatus {
            connected: true,
            daemon_version: self.descriptor.daemon_version.clone(),
            protocol_version: self.descriptor.protocol_version.clone(),
        }
    }

    pub fn runtime_flags(&self) -> AppRuntimeFlagsView {
        AppRuntimeFlagsView {
            debug: slei_debug_enabled(),
        }
    }

    pub fn list_diagnostics(&self) -> DiagnosticsSnapshotView {
        if let Some(response) = self.send_daemon_request("GET", "/v1/diagnostics", None, &[]) {
            if let Ok(snapshot) = serde_json::from_str::<DiagnosticsSnapshotView>(&response) {
                return snapshot;
            }
        }
        let local_events = self
            .diagnostic_events
            .lock()
            .expect("diagnostic events mutex poisoned")
            .iter()
            .enumerate()
            .map(|(index, payload)| DiagnosticEventView {
                sequence: index as u64 + 1,
                event_type: "desktop.local_diagnostic".to_string(),
                entity_id: "local".to_string(),
                payload: payload.clone(),
                created_at: String::new(),
            })
            .collect();
        DiagnosticsSnapshotView {
            node: "local-node".to_string(),
            runtime: "unknown".to_string(),
            worker: "claude-agent".to_string(),
            protocol_version: self.descriptor.protocol_version.clone(),
            schema_version: "local".to_string(),
            failure_summary: None,
            agent_inbox_event_count: 0,
            memory_update_event_count: 0,
            recent_events: local_events,
        }
    }

    pub fn reconnect_events(&self, after: u64) -> EventReconnectReceipt {
        let _socket = &self.descriptor.event_socket;
        self.last_authorization_header
            .lock()
            .expect("authorization mutex poisoned")
            .replace(format!("Bearer {}", self.descriptor.token));
        EventReconnectReceipt { after }
    }

    pub fn request_artifact_open(
        &self,
        artifact_id: &str,
    ) -> Result<ArtifactOpenReceipt, ArtifactOpenError> {
        if !artifact_id.starts_with("artifact_")
            || artifact_id.contains('/')
            || artifact_id.starts_with("file:")
        {
            return Err(ArtifactOpenError::ArtifactIdRequired);
        }

        self.last_authorization_header
            .lock()
            .expect("authorization mutex poisoned")
            .replace(format!("Bearer {}", self.descriptor.token));
        Ok(ArtifactOpenReceipt {
            artifact_id: artifact_id.to_string(),
            open_token: format!("open:{artifact_id}"),
        })
    }

    pub fn list_nodes(&self) -> NodeListReceipt {
        self.fetch_nodes_from_daemon()
            .unwrap_or_else(|| NodeListReceipt {
                nodes: vec![self.local_node()],
            })
    }

    pub fn refresh_runtime_status(&self) -> NodeListReceipt {
        self.list_nodes()
    }

    pub fn list_preferences(&self) -> PreferencesReceipt {
        if let Some(receipt) = self.fetch_preferences_from_daemon() {
            self.replace_local_preferences(receipt.preferences.clone());
            return receipt;
        }

        PreferencesReceipt {
            preferences: self
                .preferences
                .lock()
                .expect("preferences mutex poisoned")
                .clone(),
        }
    }

    pub fn update_preferences(
        &self,
        request: PreferencesUpdateRequest,
    ) -> Result<PreferencesReceipt, PreferencesError> {
        if let Some(receipt) = self.update_preferences_in_daemon(&request) {
            self.replace_local_preferences(receipt.preferences.clone());
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(PreferencesError::DaemonUnavailable);
        }

        let mut preferences = self.preferences.lock().expect("preferences mutex poisoned");
        if let Some(locale) = request.locale {
            if !matches!(locale.as_str(), "zh-CN" | "en-US") {
                return Err(PreferencesError::InvalidLocale);
            }
            preferences.locale = locale;
        }
        if let Some(time_zone) = request.time_zone {
            if time_zone.trim().is_empty() || time_zone.chars().count() > 64 {
                return Err(PreferencesError::InvalidTimeZone);
            }
            preferences.time_zone = time_zone.trim().to_string();
        }
        if let Some(appearance) = request.appearance {
            if !matches!(
                appearance.theme.as_str(),
                "system" | "light" | "dark" | "highContrast"
            ) || !matches!(appearance.font_size.as_str(), "sm" | "md" | "lg")
            {
                return Err(PreferencesError::InvalidAppearance);
            }
            preferences.appearance = appearance;
        }
        if let Some(notifications) = request.notifications {
            preferences.notifications = notifications;
        }
        Ok(PreferencesReceipt {
            preferences: preferences.clone(),
        })
    }

    pub fn list_profile(&self) -> ProfileReceipt {
        if let Some(receipt) = self.fetch_profile_from_daemon() {
            self.replace_local_profile(receipt.profile.clone());
            return receipt;
        }

        ProfileReceipt {
            profile: self.profile.lock().expect("profile mutex poisoned").clone(),
        }
    }

    pub fn update_profile(
        &self,
        request: ProfileUpdateRequest,
    ) -> Result<ProfileReceipt, ProfileError> {
        let receipt = self.update_profile_in_daemon(&request)?;
        self.replace_local_profile(receipt.profile.clone());
        Ok(receipt)
    }

    pub fn rename_local_node(&self, name: &str) -> Result<NodeRenameReceipt, NodeNameError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(NodeNameError::NameRequired);
        }
        if trimmed.chars().count() > 64 {
            return Err(NodeNameError::NameTooLong);
        }

        if let Some(receipt) = self.rename_local_node_in_daemon(trimmed) {
            *self
                .local_node_name
                .lock()
                .expect("node name mutex poisoned") = receipt.node.name.clone();
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(NodeNameError::DaemonUnavailable);
        }

        *self
            .local_node_name
            .lock()
            .expect("node name mutex poisoned") = trimmed.to_string();

        Ok(NodeRenameReceipt {
            node: self.local_node(),
        })
    }

    pub fn bootstrap_guide_agent(&self) -> GuideBootstrapReceipt {
        if let Some(receipt) = self.bootstrap_guide_agent_in_daemon() {
            if let Some(agent) = receipt.agent.clone() {
                self.upsert_local_agent(agent);
            }
            if let Some(conversation) = receipt.conversation.clone() {
                let _ = self.upsert_local_conversation(conversation);
            }
            return receipt;
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return GuideBootstrapReceipt {
                status: "daemonUnavailable".to_string(),
                agent: None,
                conversation: None,
            };
        }

        let has_ready_runtime = self.list_nodes().nodes.iter().any(|node| {
            node.runtimes
                .iter()
                .any(|runtime| runtime.kind == "ClaudeCode" && runtime.readiness == "ready")
        });
        if !has_ready_runtime {
            return GuideBootstrapReceipt {
                status: "runtimeUnavailable".to_string(),
                agent: None,
                conversation: None,
            };
        }
        let existing_guide = {
            let agents = self.agents.lock().expect("agents mutex poisoned");
            agents
                .iter()
                .find(|agent| {
                    agent.id == "agent_guide_local_node"
                        || agent.handle == "@yeal"
                        || agent.handle == "@leelei"
                })
                .cloned()
        };
        if let Some(existing) = existing_guide {
            let existing = normalize_guide_agent_identity(existing);
            let _ = sanitize_legacy_guide_memory(&existing);
            let _ = write_local_agent_skills(&existing);
            self.upsert_local_agent(existing.clone());
            let conversation = self
                .create_dm_conversation(&existing.id)
                .ok()
                .map(|receipt| receipt.conversation);
            return GuideBootstrapReceipt {
                status: "alreadyExists".to_string(),
                agent: Some(existing),
                conversation,
            };
        }
        let now = monotonic_id();
        let workspace_path = self.local_agent_workspace("agent_guide_local_node");
        let mut agent = DesktopAgentView {
            id: "agent_guide_local_node".to_string(),
            name: "Yeal".to_string(),
            handle: "@yeal".to_string(),
            agent_kind: Some("guide".to_string()),
            system_owned: Some(true),
            runtime_kind: "ClaudeCode".to_string(),
            model: "Sonnet".to_string(),
            node_id: "local-node".to_string(),
            description: "回答关于 Slei App 如何使用的问题，用于帮助和引导用户建立自己的团队。"
                .to_string(),
            workspace_path: workspace_path.clone(),
            memory_path: format!("{workspace_path}/MEMORY.md"),
            docs_path: format!("{workspace_path}/docs"),
            avatar_seed: "yeal".to_string(),
            runtime_thread: Some(RuntimeThreadView {
                runtime_kind: "ClaudeCode".to_string(),
                status: "ready".to_string(),
                created_at: now.clone(),
            }),
            skills: None,
            channel_ids: Some(vec!["all".to_string()]),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        agent.skills = Some(default_skill_records(&agent));
        let _ = create_local_agent_workspace(&agent);
        self.upsert_local_agent(agent.clone());
        self.ensure_channel_membership("all", &agent.id);
        let conversation = self
            .create_dm_conversation(&agent.id)
            .ok()
            .map(|receipt| receipt.conversation);
        GuideBootstrapReceipt {
            status: "created".to_string(),
            agent: Some(agent),
            conversation,
        }
    }

    pub fn list_channels(&self) -> ChannelListReceipt {
        if let Some(receipt) = self.fetch_channels_from_daemon() {
            return receipt;
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return ChannelListReceipt {
                channels: Vec::new(),
            };
        }
        ChannelListReceipt {
            channels: self
                .channels
                .lock()
                .expect("channels mutex poisoned")
                .clone(),
        }
    }

    pub fn create_channel(
        &self,
        request: ChannelCreateRequest,
    ) -> Result<ChannelReceipt, ChannelError> {
        let receipt = self.create_channel_in_daemon(&request)?;
        self.upsert_local_channel(receipt.channel.clone());
        Ok(receipt)
    }

    pub fn delete_channel(&self, channel_id: &str) -> Result<ChannelDeleteReceipt, ChannelError> {
        let receipt = self.delete_channel_in_daemon(channel_id)?;
        self.remove_local_channel(channel_id);
        Ok(receipt)
    }

    pub fn replace_channel_project_paths(
        &self,
        channel_id: &str,
        request: ChannelProjectPathsRequest,
    ) -> Result<ChannelReceipt, ChannelError> {
        let receipt = self.replace_channel_project_paths_in_daemon(channel_id, &request)?;
        self.upsert_local_channel(receipt.channel.clone());
        Ok(receipt)
    }

    pub fn list_channel_members(&self, channel_id: &str) -> ChannelMemberListReceipt {
        if let Some(receipt) = self.fetch_channel_members_from_daemon(channel_id) {
            return receipt;
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return ChannelMemberListReceipt {
                members: Vec::new(),
            };
        }
        ChannelMemberListReceipt {
            members: self
                .channel_members
                .lock()
                .expect("channel members mutex poisoned")
                .iter()
                .filter(|member| member.channel_id == channel_id)
                .cloned()
                .collect(),
        }
    }

    pub fn add_channel_member(
        &self,
        channel_id: &str,
        request: ChannelMemberAddRequest,
    ) -> Result<ChannelMemberReceipt, ChannelError> {
        let receipt = self.add_channel_member_in_daemon(channel_id, &request)?;
        self.upsert_channel_member(receipt.member.clone());
        Ok(receipt)
    }

    pub fn remove_channel_member(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<ChannelMemberRemoveReceipt, ChannelError> {
        let receipt = self.remove_channel_member_in_daemon(channel_id, agent_id)?;
        if let Some(member) = receipt.removed_member.as_ref() {
            self.channel_members
                .lock()
                .expect("channel members mutex poisoned")
                .retain(|candidate| {
                    candidate.channel_id != member.channel_id
                        || candidate.agent_id != member.agent_id
                });
        }
        Ok(receipt)
    }

    pub fn list_channel_messages(
        &self,
        channel_id: &str,
        query: Option<&MessagePageQuery>,
    ) -> ChannelMessageListReceipt {
        if let Some(receipt) = self.fetch_channel_messages_from_daemon(channel_id, query) {
            return receipt;
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return ChannelMessageListReceipt {
                messages: Vec::new(),
                page_info: MessagePageInfo::default(),
            };
        }
        ChannelMessageListReceipt {
            messages: self
                .channel_messages
                .lock()
                .expect("channel messages mutex poisoned")
                .iter()
                .filter(|message| message.channel_id == channel_id && !message.deleted)
                .cloned()
                .collect(),
            page_info: MessagePageInfo::default(),
        }
    }

    pub fn list_channel_sessions(&self, channel_id: &str) -> ChannelSessionListReceipt {
        if let Some(receipt) = self.list_channel_sessions_from_daemon(channel_id) {
            return receipt;
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return ChannelSessionListReceipt {
                sessions: Vec::new(),
            };
        }
        let mut sessions = self
            .channel_sessions
            .lock()
            .expect("channel sessions mutex poisoned")
            .iter()
            .filter(|session| session.channel_id == channel_id)
            .cloned()
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        ChannelSessionListReceipt { sessions }
    }

    pub fn create_channel_session(
        &self,
        channel_id: &str,
    ) -> Result<ChannelSessionReceipt, ChannelError> {
        if let Some(receipt) = self.create_channel_session_in_daemon(channel_id) {
            self.upsert_local_channel(receipt.channel.clone());
            self.upsert_local_channel_session(receipt.session.clone());
            return Ok(receipt);
        }
        Err(ChannelError::DaemonRequest(
            "daemon unavailable for channel session creation".to_string(),
        ))
    }

    pub fn activate_channel_session(
        &self,
        channel_id: &str,
        session_id: &str,
    ) -> Result<ChannelSessionReceipt, ChannelError> {
        if let Some(receipt) = self.activate_channel_session_in_daemon(channel_id, session_id) {
            self.upsert_local_channel(receipt.channel.clone());
            self.upsert_local_channel_session(receipt.session.clone());
            return Ok(receipt);
        }
        Err(ChannelError::DaemonRequest(
            "daemon unavailable for channel session activation".to_string(),
        ))
    }

    pub fn send_channel_message(
        &self,
        channel_id: &str,
        request: SendChannelMessageRequest,
    ) -> Result<SendChannelMessageReceipt, ChannelError> {
        self.record_local_diagnostic(format!(
            "desktop_channel_message.attempt channel_id={} author_id={} body=[redacted-body]",
            channel_id, request.author_id
        ));
        match self.send_channel_message_to_daemon(channel_id, &request) {
            Ok(receipt) => {
                self.record_local_diagnostic(format!(
                    "desktop_channel_message.outcome channel_id={} message_id={} action={}",
                    channel_id, receipt.outcome.message_id, receipt.outcome.action
                ));
                Ok(receipt)
            }
            Err(ChannelError::DaemonRequest(error))
                if channel_id == "all" && is_daemon_unavailable_error(&error) =>
            {
                if self.offline_fallback == OfflineFallback::Empty || !request.as_task {
                    return Err(ChannelError::DaemonRequest(error));
                }
                self.record_local_diagnostic(
                    "desktop_channel_message.fallback channel_id=all reason=daemon_unavailable body=[redacted-body]"
                        .to_string(),
                );
                self.send_default_all_channel_message_locally(&request)
            }
            Err(error) => Err(error),
        }
    }

    pub fn list_tasks(&self, query: TaskListQuery) -> TaskListReceipt {
        if let Some(receipt) = self.fetch_tasks_from_daemon(&query) {
            return receipt;
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return TaskListReceipt { tasks: Vec::new() };
        }
        self.list_tasks_locally(&query)
    }

    pub fn global_search(
        &self,
        query: GlobalSearchQuery,
    ) -> Result<GlobalSearchReceipt, GlobalSearchError> {
        self.fetch_global_search_from_daemon(&query)
    }

    pub fn get_task_thread(&self, task_id: &str) -> Result<TaskThreadReceipt, TaskError> {
        match self.fetch_task_thread_from_daemon(task_id) {
            Ok(receipt) => {
                self.upsert_local_task_thread(receipt.thread.clone());
                Ok(receipt)
            }
            Err(TaskError::DaemonRequest(error))
                if self.offline_fallback == OfflineFallback::Empty =>
            {
                Err(TaskError::DaemonRequest(error))
            }
            Err(TaskError::DaemonRequest(error)) if is_daemon_unavailable_error(&error) => {
                self.get_task_thread_locally(task_id)
            }
            Err(error) => Err(error),
        }
    }

    pub fn reply_to_task(
        &self,
        task_id: &str,
        request: TaskReplyRequest,
    ) -> Result<TaskReplyReceipt, TaskError> {
        match self.reply_to_task_in_daemon(task_id, &request) {
            Ok(receipt) => {
                self.apply_local_task_reply(task_id, receipt.reply.clone());
                Ok(receipt)
            }
            Err(TaskError::DaemonRequest(error))
                if self.offline_fallback == OfflineFallback::Empty =>
            {
                Err(TaskError::DaemonRequest(error))
            }
            Err(TaskError::DaemonRequest(error)) if is_daemon_unavailable_error(&error) => {
                self.reply_to_task_locally(task_id, request)
            }
            Err(error) => Err(error),
        }
    }

    pub fn create_message_thread_from_source(
        &self,
        request: CreateMessageThreadRequest,
    ) -> Result<MessageThreadReceipt, ChannelError> {
        self.create_message_thread_from_source_in_daemon(&request)
    }

    pub fn get_message_thread(
        &self,
        thread_id: &str,
    ) -> Result<MessageThreadReceipt, ChannelError> {
        self.get_message_thread_from_daemon(thread_id)
    }

    pub fn reply_to_message_thread(
        &self,
        thread_id: &str,
        request: ReplyToMessageThreadRequest,
    ) -> Result<MessageThreadReplyReceipt, ChannelError> {
        self.reply_to_message_thread_in_daemon(thread_id, &request)
    }

    pub fn update_task_status(
        &self,
        task_id: &str,
        request: TaskStatusUpdateRequest,
    ) -> Result<TaskReceipt, TaskError> {
        match self.update_task_status_in_daemon(task_id, &request) {
            Ok(receipt) => {
                self.upsert_local_task(receipt.task.clone());
                Ok(receipt)
            }
            Err(TaskError::DaemonRequest(error))
                if self.offline_fallback == OfflineFallback::Empty =>
            {
                Err(TaskError::DaemonRequest(error))
            }
            Err(TaskError::DaemonRequest(error)) if is_daemon_unavailable_error(&error) => {
                self.update_task_status_locally(task_id, request)
            }
            Err(error) => Err(error),
        }
    }

    pub fn diagnostic_events_for_tests(&self) -> Vec<String> {
        self.diagnostic_events
            .lock()
            .expect("diagnostic events mutex poisoned")
            .clone()
    }

    pub fn complete_interactive_card(
        &self,
        card_id: &str,
    ) -> Result<InteractiveCardReceipt, CardError> {
        if let Some(receipt) = self.complete_interactive_card_in_daemon(card_id) {
            self.upsert_local_card(receipt.card.clone());
            if let Some(card) = self
                .complete_loaded_message_card(card_id)
                .map_err(CardError::Conversation)?
            {
                self.upsert_local_card(card);
            } else if let Some(card) = complete_local_message_card(&self.data_root, card_id)
                .map_err(CardError::Conversation)?
            {
                self.upsert_local_card(card);
            }
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(CardError::CardNotFound);
        }
        if let Some(card) = self
            .complete_loaded_message_card(card_id)
            .map_err(CardError::Conversation)?
        {
            self.upsert_local_card(card.clone());
            return Ok(InteractiveCardReceipt { card });
        }
        let card = complete_local_message_card(&self.data_root, card_id)
            .map_err(CardError::Conversation)?;
        if let Some(card) = card {
            self.upsert_local_card(card.clone());
            return Ok(InteractiveCardReceipt { card });
        }
        let mut cards = self.cards.lock().expect("cards mutex poisoned");
        if let Some(card) = cards.iter_mut().find(|card| card.id == card_id) {
            card.state = "done".to_string();
            return Ok(InteractiveCardReceipt { card: card.clone() });
        }
        Err(CardError::CardNotFound)
    }

    pub fn resolve_permission(
        &self,
        request: PermissionResolveRequest,
    ) -> Result<ConversationMessageReceipt, ConversationError> {
        if let Some(receipt) = self.resolve_permission_in_daemon(&request) {
            self.upsert_local_conversation_message(receipt.message.clone())?;
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(ConversationError::DaemonUnavailable);
        }
        let mut messages = self
            .conversation_messages
            .lock()
            .expect("conversation messages mutex poisoned");
        for message in messages.iter_mut() {
            let Some(cards) = message.cards.as_mut() else {
                continue;
            };
            if !cards.iter().any(|card| {
                card.kind == "permissionApproval"
                    && card
                        .draft
                        .get("requestId")
                        .and_then(serde_json::Value::as_str)
                        == Some(request.request_id.as_str())
            }) {
                continue;
            }
            let state = if request.decision == "deny" {
                "rejected"
            } else {
                "done"
            };
            for card in cards.iter_mut() {
                if card.kind == "permissionApproval"
                    && card
                        .draft
                        .get("requestId")
                        .and_then(serde_json::Value::as_str)
                        == Some(request.request_id.as_str())
                {
                    card.state = state.to_string();
                    card.done_label = if request.decision == "deny" {
                        "已拒绝".to_string()
                    } else {
                        "已允许".to_string()
                    };
                }
            }
            message.status = Some(if request.decision == "deny" {
                "failed".to_string()
            } else {
                "done".to_string()
            });
            let updated = message.clone();
            persist_local_conversation_messages_at_root(
                &self.data_root,
                &updated.conversation_id,
                &messages,
            )?;
            return Ok(ConversationMessageReceipt { message: updated });
        }
        Err(ConversationError::ConversationNotFound)
    }

    pub fn list_agents(&self) -> AgentListReceipt {
        if let Some(receipt) = self.fetch_agents_from_daemon() {
            for agent in &receipt.agents {
                self.upsert_local_agent(agent.clone());
            }
            receipt
        } else if self.offline_fallback == OfflineFallback::Empty {
            AgentListReceipt { agents: Vec::new() }
        } else {
            AgentListReceipt {
                agents: self.agents.lock().expect("agents mutex poisoned").clone(),
            }
        }
    }

    pub fn list_agent_activity(
        &self,
        agent_id: &str,
        limit: Option<u32>,
    ) -> Result<AgentActivityListReceipt, AgentError> {
        let limit = limit.unwrap_or(200).min(200);
        let path = format!("/v1/agents/{agent_id}/activity?limit={limit}");
        match self.send_daemon_request_checked("GET", &path, None, &[]) {
            Ok(response) => serde_json::from_str::<AgentActivityListReceipt>(&response)
                .map_err(|error| AgentError::DaemonResponse(error.to_string())),
            Err(error) if is_daemon_unavailable_error(&error) => {
                if self.offline_fallback == OfflineFallback::Empty {
                    Err(AgentError::DaemonUnavailable)
                } else {
                    Ok(AgentActivityListReceipt { logs: Vec::new() })
                }
            }
            Err(error) => Err(AgentError::DaemonRequest(error)),
        }
    }

    pub fn create_agent(&self, request: AgentCreateRequest) -> Result<AgentReceipt, AgentError> {
        validate_agent_create(&request)?;

        if let Some(receipt) = self.create_agent_in_daemon(&request) {
            self.upsert_local_agent(receipt.agent.clone());
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(AgentError::DaemonUnavailable);
        }

        let handle = normalize_handle(&request.handle)?;
        let mut agents = self.agents.lock().expect("agents mutex poisoned");
        if agents
            .iter()
            .any(|agent| agent.handle.eq_ignore_ascii_case(&handle))
        {
            return Err(AgentError::DuplicateHandle);
        }

        let id = format!("agent_{}", monotonic_id());
        let workspace_path = self.local_agent_workspace(&id);
        let now = monotonic_id();
        let mut agent = DesktopAgentView {
            id: id.clone(),
            name: request.name.trim().to_string(),
            handle,
            agent_kind: Some("agent".to_string()),
            system_owned: Some(false),
            runtime_kind: request.runtime_kind.trim().to_string(),
            model: request.model.trim().to_string(),
            node_id: request.node_id.trim().to_string(),
            description: request.description.trim().to_string(),
            workspace_path: workspace_path.clone(),
            memory_path: format!("{workspace_path}/MEMORY.md"),
            docs_path: format!("{workspace_path}/docs"),
            avatar_seed: id,
            runtime_thread: Some(RuntimeThreadView {
                runtime_kind: request.runtime_kind.trim().to_string(),
                status: "ready".to_string(),
                created_at: now.clone(),
            }),
            skills: None,
            channel_ids: Some(vec!["all".to_string()]),
            created_at: now.clone(),
            updated_at: now,
        };
        agent.skills = Some(default_skill_records(&agent));
        create_local_agent_workspace(&agent)?;
        agents.push(agent.clone());
        persist_local_agents_at_root(&self.data_root, &agents)?;
        drop(agents);
        self.ensure_channel_membership("all", &agent.id);
        Ok(AgentReceipt { agent })
    }

    pub fn update_agent(
        &self,
        agent_id: &str,
        request: AgentUpdateRequest,
    ) -> Result<AgentReceipt, AgentError> {
        if let Some(receipt) = self.update_agent_in_daemon(agent_id, &request) {
            self.upsert_local_agent(receipt.agent.clone());
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(AgentError::DaemonUnavailable);
        }

        let mut agents = self.agents.lock().expect("agents mutex poisoned");
        let agent = agents
            .iter_mut()
            .find(|agent| agent.id == agent_id)
            .ok_or(AgentError::AgentNotFound)?;
        if let Some(name) = request.name {
            if name.trim().is_empty() {
                return Err(AgentError::InvalidAgent);
            }
            agent.name = name.trim().to_string();
        }
        if let Some(description) = request.description {
            agent.description = description.trim().to_string();
        }
        if let Some(runtime_kind) = request.runtime_kind {
            let runtime_kind = runtime_kind.trim().to_string();
            agent.runtime_kind = runtime_kind.clone();
            if let Some(runtime_thread) = agent.runtime_thread.as_mut() {
                runtime_thread.runtime_kind = runtime_kind;
            }
        }
        if let Some(model) = request.model {
            agent.model = model.trim().to_string();
        }
        if let Some(node_id) = request.node_id {
            agent.node_id = node_id.trim().to_string();
        }
        agent.updated_at = monotonic_id();
        let updated = agent.clone();
        persist_local_agents_at_root(&self.data_root, &agents)?;
        Ok(AgentReceipt { agent: updated })
    }

    pub fn delete_agent(&self, agent_id: &str) -> Result<AgentReceipt, AgentError> {
        if let Some(receipt) = self.delete_agent_in_daemon(agent_id) {
            self.remove_local_agent_state(agent_id, None)?;
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(AgentError::DaemonUnavailable);
        }

        let agent = self
            .agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(AgentError::AgentNotFound)?;
        self.remove_local_agent_state(agent_id, Some(&agent))?;
        Ok(AgentReceipt { agent })
    }

    pub fn remember_agent_fact(
        &self,
        agent_id: &str,
        fact: &str,
    ) -> Result<AgentReceipt, AgentError> {
        if fact.trim().is_empty() {
            return Err(AgentError::InvalidMemory);
        }
        if let Some(receipt) = self.remember_agent_fact_in_daemon(agent_id, fact) {
            self.upsert_local_agent(receipt.agent.clone());
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(AgentError::DaemonUnavailable);
        }

        let agent = self
            .agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(AgentError::AgentNotFound)?;
        append_local_agent_memory(&agent, fact)?;
        Ok(AgentReceipt { agent })
    }

    pub fn list_agent_skills(&self, agent_id: &str) -> Result<SkillListReceipt, AgentError> {
        if let Some(receipt) = self.fetch_agent_skills_from_daemon(agent_id) {
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(AgentError::DaemonUnavailable);
        }

        let agent = self
            .agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(AgentError::AgentNotFound)?;

        if let Some(skills) = agent.skills.clone() {
            return Ok(SkillListReceipt { skills });
        }

        Ok(SkillListReceipt {
            skills: read_local_agent_skills(&agent)?,
        })
    }

    pub fn open_agent_path(
        &self,
        agent_id: &str,
        target: &str,
    ) -> Result<AgentPathOpenReceipt, AgentPathError> {
        let agent = self
            .agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(AgentPathError::AgentNotFound)?;
        let target_path = match target {
            "workspace" => &agent.workspace_path,
            "memory" => &agent.memory_path,
            "docs" => &agent.docs_path,
            _ => return Err(AgentPathError::InvalidTarget),
        };
        let workspace = canonicalize_agent_path(&agent.workspace_path)?;
        let path = canonicalize_agent_path(target_path)?;
        if !path.starts_with(&workspace) {
            return Err(AgentPathError::WorkspaceBoundary);
        }
        open_system_path(&path)?;
        Ok(AgentPathOpenReceipt {
            agent_id: agent.id,
            target: target.to_string(),
        })
    }

    pub fn list_agent_workspace(
        &self,
        agent_id: &str,
        relative_path: Option<String>,
    ) -> Result<AgentWorkspaceListReceipt, AgentPathError> {
        let agent = self.find_agent_for_path(agent_id)?;
        let (workspace, path, relative_path) =
            resolve_workspace_child_path(&agent.workspace_path, relative_path.as_deref())?;
        if !path.is_dir() {
            return Err(AgentPathError::InvalidTarget);
        }

        let mut entries = Vec::new();
        for entry in fs::read_dir(&path).map_err(AgentPathError::Io)? {
            let entry = entry.map_err(AgentPathError::Io)?;
            let entry_path = entry.path().canonicalize().map_err(AgentPathError::Io)?;
            if !entry_path.starts_with(&workspace) {
                continue;
            }
            let metadata = fs::metadata(&entry_path).map_err(AgentPathError::Io)?;
            entries.push(AgentWorkspaceEntry {
                kind: if metadata.is_dir() {
                    "directory"
                } else {
                    "file"
                }
                .to_string(),
                name: entry.file_name().to_string_lossy().to_string(),
                relative_path: workspace_relative_path(&workspace, &entry_path)?,
            });
        }
        entries.sort_by(|left, right| {
            let left_rank = if left.kind == "directory" { 0 } else { 1 };
            let right_rank = if right.kind == "directory" { 0 } else { 1 };
            left_rank
                .cmp(&right_rank)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });

        Ok(AgentWorkspaceListReceipt {
            agent_id: agent.id,
            relative_path,
            entries,
        })
    }

    pub fn read_agent_workspace_file(
        &self,
        agent_id: &str,
        relative_path: &str,
    ) -> Result<AgentWorkspaceFileReceipt, AgentPathError> {
        let agent = self.find_agent_for_path(agent_id)?;
        let (workspace, path, relative_path) =
            resolve_workspace_child_path(&agent.workspace_path, Some(relative_path))?;
        if !path.is_file() {
            return Err(AgentPathError::InvalidTarget);
        }
        let content = fs::read_to_string(&path).map_err(AgentPathError::Io)?;
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| relative_path.clone());

        Ok(AgentWorkspaceFileReceipt {
            agent_id: agent.id,
            content,
            name,
            relative_path: workspace_relative_path(&workspace, &path)?,
        })
    }

    fn find_agent_for_path(&self, agent_id: &str) -> Result<DesktopAgentView, AgentPathError> {
        self.agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(AgentPathError::AgentNotFound)
    }

    pub fn list_conversations(&self) -> ConversationListReceipt {
        self.fetch_conversations_from_daemon().unwrap_or_else(|| {
            if self.offline_fallback == OfflineFallback::Empty {
                ConversationListReceipt {
                    conversations: Vec::new(),
                }
            } else {
                ConversationListReceipt {
                    conversations: self
                        .conversations
                        .lock()
                        .expect("conversations mutex poisoned")
                        .clone(),
                }
            }
        })
    }

    pub fn create_dm_conversation(
        &self,
        agent_id: &str,
    ) -> Result<ConversationReceipt, ConversationError> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(ConversationError::InvalidConversation);
        }
        let agent = self
            .list_agents()
            .agents
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned();
        if agent.is_none() {
            return Err(ConversationError::AgentNotFound);
        }
        if let Some(receipt) = self.create_dm_conversation_in_daemon(agent_id) {
            self.upsert_local_conversation(receipt.conversation.clone())?;
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(ConversationError::DaemonUnavailable);
        }

        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        if let Some(existing) = conversations
            .iter()
            .find(|conversation| conversation.kind == "dm" && conversation.agent_id == agent_id)
            .cloned()
        {
            return Ok(ConversationReceipt {
                conversation: existing,
            });
        }

        let now = monotonic_id();
        let session = ConversationSessionView {
            id: format!("session:{agent_id}:default"),
            conversation_id: format!("dm:{agent_id}"),
            title: "新会话".to_string(),
            status: "ready".to_string(),
            runtime_session: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let conversation = ConversationView {
            id: session.conversation_id.clone(),
            kind: "dm".to_string(),
            agent_id: agent_id.to_string(),
            active_session_id: Some(session.id.clone()),
            runtime_session: None,
            created_at: now.clone(),
            updated_at: now,
        };
        conversations.push(conversation.clone());
        persist_local_conversations_at_root(&self.data_root, &conversations)?;
        drop(conversations);
        let mut sessions = self
            .conversation_sessions
            .lock()
            .expect("conversation sessions mutex poisoned");
        sessions.push(session);
        persist_local_conversation_sessions_at_root(&self.data_root, &sessions)?;
        Ok(ConversationReceipt { conversation })
    }

    pub fn reset_conversation_runtime_session(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationReceipt, ConversationError> {
        if let Some(receipt) = self.reset_conversation_runtime_session_in_daemon(conversation_id) {
            self.upsert_local_conversation(receipt.conversation.clone())?;
            self.clear_local_active_session_cache(conversation_id)?;
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(ConversationError::DaemonUnavailable);
        }

        let existing = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned")
            .iter()
            .find(|conversation| conversation.id == conversation_id)
            .cloned()
            .ok_or(ConversationError::ConversationNotFound)?;
        if let Some(runtime_session) = existing.runtime_session.clone() {
            let agent = self
                .agents
                .lock()
                .expect("agents mutex poisoned")
                .iter()
                .find(|agent| agent.id == existing.agent_id)
                .cloned()
                .ok_or(ConversationError::AgentNotFound)?;
            run_local_claude_clear_session(&agent, &runtime_session)
                .map_err(ConversationError::RuntimeClearFailed)?;
        }

        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        let conversation = conversations
            .iter_mut()
            .find(|conversation| conversation.id == conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        conversation.runtime_session = None;
        conversation.updated_at = monotonic_id();
        let updated = conversation.clone();
        persist_local_conversations_at_root(&self.data_root, &conversations)?;
        drop(conversations);
        self.clear_local_active_session_cache(conversation_id)?;
        Ok(ConversationReceipt {
            conversation: updated,
        })
    }

    pub fn list_conversation_sessions(
        &self,
        conversation_id: &str,
    ) -> ConversationSessionListReceipt {
        if let Some(receipt) = self.list_conversation_sessions_from_daemon(conversation_id) {
            return receipt;
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return ConversationSessionListReceipt {
                sessions: Vec::new(),
            };
        }
        let mut sessions = self
            .conversation_sessions
            .lock()
            .expect("conversation sessions mutex poisoned")
            .iter()
            .filter(|session| session.conversation_id == conversation_id)
            .cloned()
            .collect::<Vec<_>>();
        if sessions.is_empty() {
            if let Some(conversation) = self
                .conversations
                .lock()
                .expect("conversations mutex poisoned")
                .iter()
                .find(|conversation| conversation.id == conversation_id)
                .cloned()
            {
                let session = legacy_session_for_conversation(&conversation);
                sessions.push(session.clone());
                let mut all_sessions = self
                    .conversation_sessions
                    .lock()
                    .expect("conversation sessions mutex poisoned");
                all_sessions.push(session);
                let _ = persist_local_conversation_sessions_at_root(&self.data_root, &all_sessions);
            }
        }
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        ConversationSessionListReceipt { sessions }
    }

    pub fn create_conversation_session(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationSessionReceipt, ConversationError> {
        if let Some(receipt) = self.create_conversation_session_in_daemon(conversation_id) {
            self.upsert_local_conversation(receipt.conversation.clone())?;
            self.upsert_local_conversation_session(receipt.session.clone())?;
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(ConversationError::DaemonUnavailable);
        }
        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        let conversation = conversations
            .iter_mut()
            .find(|conversation| conversation.id == conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        let now = monotonic_id();
        let session = ConversationSessionView {
            id: format!("session:{}:{}", safe_conversation_id(conversation_id), now),
            conversation_id: conversation_id.to_string(),
            title: "新会话".to_string(),
            status: "ready".to_string(),
            runtime_session: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        conversation.active_session_id = Some(session.id.clone());
        conversation.runtime_session = None;
        conversation.updated_at = now;
        let updated = conversation.clone();
        persist_local_conversations_at_root(&self.data_root, &conversations)?;
        drop(conversations);
        let mut sessions = self
            .conversation_sessions
            .lock()
            .expect("conversation sessions mutex poisoned");
        sessions.push(session.clone());
        persist_local_conversation_sessions_at_root(&self.data_root, &sessions)?;
        Ok(ConversationSessionReceipt {
            conversation: updated,
            session,
        })
    }

    pub fn activate_conversation_session(
        &self,
        conversation_id: &str,
        session_id: &str,
    ) -> Result<ConversationSessionReceipt, ConversationError> {
        if let Some(receipt) =
            self.activate_conversation_session_in_daemon(conversation_id, session_id)
        {
            self.upsert_local_conversation(receipt.conversation.clone())?;
            self.upsert_local_conversation_session(receipt.session.clone())?;
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(ConversationError::DaemonUnavailable);
        }
        let session = self
            .list_conversation_sessions(conversation_id)
            .sessions
            .into_iter()
            .find(|session| session.id == session_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        let conversation = conversations
            .iter_mut()
            .find(|conversation| conversation.id == conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        conversation.active_session_id = Some(session.id.clone());
        conversation.runtime_session = session.runtime_session.clone();
        conversation.updated_at = monotonic_id();
        let updated = conversation.clone();
        persist_local_conversations_at_root(&self.data_root, &conversations)?;
        Ok(ConversationSessionReceipt {
            conversation: updated,
            session,
        })
    }

    pub fn list_conversation_messages(
        &self,
        conversation_id: &str,
        query: Option<&MessagePageQuery>,
    ) -> ConversationMessageListReceipt {
        if self.offline_fallback == OfflineFallback::Empty {
            return self
                .list_conversation_messages_from_daemon(conversation_id, query)
                .unwrap_or_else(|| ConversationMessageListReceipt {
                    messages: Vec::new(),
                    page_info: MessagePageInfo::default(),
                });
        }
        if self.has_local_conversation_messages(conversation_id) {
            return self.list_local_conversation_messages(conversation_id);
        }
        if let Some(receipt) = self.list_conversation_messages_from_daemon(conversation_id, query) {
            return receipt;
        }

        self.list_local_conversation_messages(conversation_id)
    }

    fn list_local_conversation_messages(
        &self,
        conversation_id: &str,
    ) -> ConversationMessageListReceipt {
        ConversationMessageListReceipt {
            messages: {
                self.conversation_messages
                    .lock()
                    .expect("conversation messages mutex poisoned")
                    .iter()
                    .filter(|message| message.conversation_id == conversation_id)
                    .cloned()
                    .collect()
            },
            page_info: MessagePageInfo::default(),
        }
    }

    fn has_local_conversation_messages(&self, conversation_id: &str) -> bool {
        self.conversation_messages
            .lock()
            .expect("conversation messages mutex poisoned")
            .iter()
            .any(|message| message.conversation_id == conversation_id)
    }

    pub fn send_conversation_message(
        &self,
        conversation_id: &str,
        request: ConversationMessageRequest,
    ) -> Result<ConversationMessageReceipt, ConversationError> {
        let body = request.body.trim();
        if request.author_id.trim().is_empty() {
            return Err(ConversationError::InvalidMessage);
        }

        let should_run_local_runtime = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned")
            .iter()
            .find(|conversation| conversation.id == conversation_id)
            .is_some_and(|conversation| {
                conversation.kind == "dm" && request.author_id.starts_with("human:")
            });

        if let Some(receipt) = self.send_conversation_message_to_daemon(conversation_id, &request) {
            self.upsert_local_conversation_message(receipt.message.clone())?;
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(ConversationError::DaemonUnavailable);
        }
        if should_run_local_runtime {
            eprintln!(
                "[slei-runtime] local_runtime_selected conversation_id={} author_id={}",
                conversation_id, request.author_id
            );
        }

        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        let conversation = conversations
            .iter_mut()
            .find(|conversation| conversation.id == conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        let agent_id = conversation.agent_id.clone();
        let session_id = request
            .session_id
            .clone()
            .or_else(|| conversation.active_session_id.clone())
            .unwrap_or_else(|| {
                format!("session:{}:default", safe_conversation_id(conversation_id))
            });
        let is_human_dm = conversation.kind == "dm" && request.author_id.starts_with("human:");
        let runtime_session = if is_human_dm {
            let now = monotonic_id();
            Some(conversation.runtime_session.clone().unwrap_or_else(|| {
                let session = RuntimeSessionView {
                    runtime_kind: "ClaudeCode".to_string(),
                    session_id: Uuid::new_v4().to_string(),
                    status: "pending".to_string(),
                    created_at: now.clone(),
                    updated_at: now,
                };
                conversation.runtime_session = Some(session.clone());
                session
            }))
        } else {
            None
        };
        if let Some(runtime_session) = runtime_session.clone() {
            self.upsert_session_runtime(
                conversation_id,
                &session_id,
                runtime_session.clone(),
                body,
            );
            conversation.active_session_id = Some(session_id.clone());
            conversation.runtime_session = Some(runtime_session);
        }
        let now = monotonic_id();
        let selected_attachments = self
            .conversation_attachments
            .lock()
            .expect("conversation attachments mutex poisoned")
            .iter()
            .filter(|attachment| request.attachment_ids.iter().any(|id| id == &attachment.id))
            .cloned()
            .collect::<Vec<_>>();
        if selected_attachments.len() != request.attachment_ids.len()
            || (body.is_empty() && selected_attachments.is_empty())
        {
            return Err(ConversationError::InvalidMessage);
        }
        let message = ConversationMessageView {
            id: format!("msg_{now}"),
            sequence: None,
            conversation_id: conversation_id.to_string(),
            session_id: Some(session_id.clone()),
            author_id: request.author_id.trim().to_string(),
            body: body.to_string(),
            attachments: (!selected_attachments.is_empty()).then_some(selected_attachments.clone()),
            cards: None,
            thread: None,
            run_id: None,
            status: None,
            created_at: now,
        };
        conversation.updated_at = message.created_at.clone();
        persist_local_conversations_at_root(&self.data_root, &conversations)?;
        drop(conversations);

        let mut messages = self
            .conversation_messages
            .lock()
            .expect("conversation messages mutex poisoned");
        messages.push(message.clone());
        persist_local_conversation_messages_at_root(&self.data_root, conversation_id, &messages)?;
        drop(messages);

        if is_human_dm {
            let run_id = format!("run_{}", monotonic_id());
            let run_message = ConversationMessageView {
                id: format!("run_message_{run_id}"),
                sequence: None,
                conversation_id: conversation_id.to_string(),
                session_id: Some(session_id.clone()),
                author_id: agent_id.clone(),
                body: String::new(),
                attachments: None,
                cards: None,
                thread: None,
                run_id: Some(run_id.clone()),
                status: Some("running".to_string()),
                created_at: monotonic_id(),
            };
            {
                let mut messages = self
                    .conversation_messages
                    .lock()
                    .expect("conversation messages mutex poisoned");
                messages.push(run_message);
                persist_local_conversation_messages_at_root(
                    &self.data_root,
                    conversation_id,
                    &messages,
                )?;
            }

            let agent = self
                .agents
                .lock()
                .expect("agents mutex poisoned")
                .iter()
                .find(|agent| agent.id == agent_id)
                .cloned();
            let conversation_id = conversation_id.to_string();
            let conversations = self.conversations.clone();
            let conversation_messages = self.conversation_messages.clone();
            let prompt = append_attachment_context(body, &selected_attachments);
            let runtime_session = runtime_session.expect("human dm has runtime session");
            let workspace_mounts = request.workspace_mounts.clone();
            let source_channel_id = request.source_channel_id.clone();
            let source_channel_name = request.source_channel_name.clone();
            thread::spawn(move || {
                run_local_agent_dm_background(
                    conversations,
                    conversation_messages,
                    conversation_id,
                    run_id,
                    agent,
                    prompt,
                    runtime_session,
                    workspace_mounts,
                    source_channel_id,
                    source_channel_name,
                );
            });
        }
        Ok(ConversationMessageReceipt { message })
    }

    pub fn upload_conversation_attachment(
        &self,
        request: ConversationAttachmentUploadRequest,
    ) -> Result<ConversationAttachmentReceipt, ConversationError> {
        if let Some(receipt) = self.upload_conversation_attachment_to_daemon(&request) {
            self.upsert_local_attachment(receipt.attachment.clone())?;
            return Ok(receipt);
        }
        if self.offline_fallback == OfflineFallback::Empty {
            return Err(ConversationError::DaemonUnavailable);
        }
        let name = sanitize_attachment_name(&request.name)?;
        let mime_type = if request.mime_type.trim().is_empty() {
            "application/octet-stream".to_string()
        } else {
            request.mime_type.trim().to_string()
        };
        let bytes =
            decode_base64(&request.bytes_base64).map_err(|_| ConversationError::InvalidMessage)?;
        let id = format!("att_{}", Uuid::new_v4().simple());
        let path = Path::new(&self.data_root)
            .join("attachments")
            .join(&id)
            .join(&name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(ConversationError::Io)?;
        }
        fs::write(&path, &bytes).map_err(ConversationError::Io)?;
        let attachment = ConversationAttachmentView {
            id,
            name,
            mime_type: mime_type.clone(),
            size: bytes.len() as u64,
            url: if mime_type.starts_with("image/") {
                Some(format!("data:{mime_type};base64,{}", request.bytes_base64))
            } else {
                None
            },
            cache_path: Some(path.to_string_lossy().to_string()),
        };
        let mut attachments = self
            .conversation_attachments
            .lock()
            .expect("conversation attachments mutex poisoned");
        attachments.push(attachment.clone());
        persist_local_attachments_at_root(&self.data_root, &attachments)?;
        Ok(ConversationAttachmentReceipt { attachment })
    }

    pub fn list_saved_messages(&self) -> SavedMessageListReceipt {
        self.fetch_saved_messages_from_daemon()
            .unwrap_or_else(|| SavedMessageListReceipt {
                saved_messages: Vec::new(),
            })
    }

    pub fn save_message(
        &self,
        request: SaveMessageRequest,
    ) -> Result<SavedMessageReceipt, ConversationError> {
        let message_id = request.message_id.trim();
        let source_id = request.source_id.trim();
        let source_kind = request.source_kind.trim();
        if message_id.is_empty() || source_id.is_empty() || !matches!(source_kind, "channel" | "dm")
        {
            return Err(ConversationError::InvalidMessage);
        }

        self.save_message_in_daemon(&SaveMessageRequest {
            message_id: message_id.to_string(),
            source_id: source_id.to_string(),
            source_kind: source_kind.to_string(),
            session_id: request
                .session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
        })
    }

    pub fn unsave_message(&self, message_id: &str) -> Result<(), ConversationError> {
        let message_id = message_id.trim();
        if message_id.is_empty() {
            return Err(ConversationError::InvalidMessage);
        }
        self.unsave_message_in_daemon(message_id)
    }

    pub fn last_authorization_header(&self) -> Option<String> {
        self.last_authorization_header
            .lock()
            .expect("authorization mutex poisoned")
            .clone()
    }

    fn local_node(&self) -> DesktopNodeView {
        DesktopNodeView {
            id: "local-node".to_string(),
            name: self
                .local_node_name
                .lock()
                .expect("node name mutex poisoned")
                .clone(),
            status: "connected".to_string(),
            daemon_version: self.descriptor.daemon_version.clone(),
            device: detect_device_meta(),
            runtimes: vec![detect_claude_runtime()],
        }
    }

    fn fetch_nodes_from_daemon(&self) -> Option<NodeListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/nodes", None, &[])?;
        serde_json::from_str::<NodeListReceipt>(&response).ok()
    }

    fn rename_local_node_in_daemon(&self, name: &str) -> Option<NodeRenameReceipt> {
        let payload = serde_json::json!({ "name": name }).to_string();
        let response =
            self.send_daemon_request("PATCH", "/v1/nodes/local-node/name", Some(&payload), &[])?;
        serde_json::from_str::<NodeRenameReceipt>(&response).ok()
    }

    fn fetch_preferences_from_daemon(&self) -> Option<PreferencesReceipt> {
        let response = self.send_daemon_request("GET", "/v1/settings/preferences", None, &[])?;
        serde_json::from_str::<PreferencesReceipt>(&response).ok()
    }

    fn fetch_profile_from_daemon(&self) -> Option<ProfileReceipt> {
        let response = self.send_daemon_request("GET", "/v1/settings/profile", None, &[])?;
        serde_json::from_str::<ProfileReceipt>(&response).ok()
    }

    fn bootstrap_guide_agent_in_daemon(&self) -> Option<GuideBootstrapReceipt> {
        let response =
            self.send_daemon_request("POST", "/v1/agents/guide/bootstrap", Some("{}"), &[])?;
        let mut receipt = serde_json::from_str::<GuideBootstrapReceipt>(&response).ok()?;
        if let Some(agent) = receipt.agent.as_mut() {
            if let Some(skills) = self.fetch_agent_skills_from_daemon(&agent.id) {
                agent.skills = Some(skills.skills);
            }
        }
        Some(receipt)
    }

    fn fetch_channels_from_daemon(&self) -> Option<ChannelListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/channels", None, &[])?;
        serde_json::from_str::<ChannelListReceipt>(&response).ok()
    }

    fn create_channel_in_daemon(
        &self,
        request: &ChannelCreateRequest,
    ) -> Result<ChannelReceipt, ChannelError> {
        let payload = serde_json::to_string(request)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))?;
        let idempotency_key = format!("desktop-channel-create-{}", monotonic_id());
        let started = Instant::now();
        eprintln!(
            "[slei-desktop][channel-create] idempotency_key={} stage=request-start name={} agent_count={} project_path_count={}",
            idempotency_key,
            request.name.trim(),
            request.agent_ids.len(),
            request.project_paths.len()
        );
        let response = match self.send_daemon_request_checked(
            "POST",
            "/v1/channels",
            Some(&payload),
            &[("Idempotency-Key", idempotency_key.as_str())],
        ) {
            Ok(response) => {
                eprintln!(
                    "[slei-desktop][channel-create] idempotency_key={} stage=request-success http_status=2xx elapsed_ms={}",
                    idempotency_key,
                    started.elapsed().as_millis()
                );
                response
            }
            Err(error) => {
                eprintln!(
                    "[slei-desktop][channel-create] idempotency_key={} stage=request-failed elapsed_ms={} error={}",
                    idempotency_key,
                    started.elapsed().as_millis(),
                    error
                );
                return Err(ChannelError::DaemonRequest(error));
            }
        };
        serde_json::from_str::<ChannelReceipt>(&response).map_err(|error| {
            eprintln!(
                "[slei-desktop][channel-create] idempotency_key={} stage=response-invalid elapsed_ms={} error={}",
                idempotency_key,
                started.elapsed().as_millis(),
                error
            );
            ChannelError::DaemonResponse(error.to_string())
        })
    }

    fn delete_channel_in_daemon(
        &self,
        channel_id: &str,
    ) -> Result<ChannelDeleteReceipt, ChannelError> {
        let response = self
            .send_daemon_request_checked("DELETE", &format!("/v1/channels/{channel_id}"), None, &[])
            .map_err(ChannelError::DaemonRequest)?;
        serde_json::from_str::<ChannelDeleteReceipt>(&response)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))
    }

    fn replace_channel_project_paths_in_daemon(
        &self,
        channel_id: &str,
        request: &ChannelProjectPathsRequest,
    ) -> Result<ChannelReceipt, ChannelError> {
        let payload = serde_json::to_string(request)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))?;
        let response = self
            .send_daemon_request_checked(
                "PATCH",
                &format!("/v1/channels/{channel_id}/project-paths"),
                Some(&payload),
                &[],
            )
            .map_err(ChannelError::DaemonRequest)?;
        serde_json::from_str::<ChannelReceipt>(&response)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))
    }

    fn fetch_channel_members_from_daemon(
        &self,
        channel_id: &str,
    ) -> Option<ChannelMemberListReceipt> {
        let response = self.send_daemon_request(
            "GET",
            &format!("/v1/channels/{channel_id}/members"),
            None,
            &[],
        )?;
        serde_json::from_str::<ChannelMemberListReceipt>(&response).ok()
    }

    fn add_channel_member_in_daemon(
        &self,
        channel_id: &str,
        request: &ChannelMemberAddRequest,
    ) -> Result<ChannelMemberReceipt, ChannelError> {
        let payload = serde_json::to_string(request)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))?;
        let response = self
            .send_daemon_request_checked(
                "POST",
                &format!("/v1/channels/{channel_id}/members"),
                Some(&payload),
                &[],
            )
            .map_err(ChannelError::DaemonRequest)?;
        serde_json::from_str::<ChannelMemberReceipt>(&response)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))
    }

    fn remove_channel_member_in_daemon(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<ChannelMemberRemoveReceipt, ChannelError> {
        let response = self
            .send_daemon_request_checked(
                "DELETE",
                &format!("/v1/channels/{channel_id}/members/{agent_id}"),
                None,
                &[],
            )
            .map_err(ChannelError::DaemonRequest)?;
        serde_json::from_str::<ChannelMemberRemoveReceipt>(&response)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))
    }

    fn fetch_channel_messages_from_daemon(
        &self,
        channel_id: &str,
        query: Option<&MessagePageQuery>,
    ) -> Option<ChannelMessageListReceipt> {
        let path = message_page_path(&format!("/v1/channels/{channel_id}/messages"), query);
        let response = self.send_daemon_request("GET", &path, None, &[])?;
        serde_json::from_str::<ChannelMessageListReceipt>(&response).ok()
    }

    fn list_channel_sessions_from_daemon(
        &self,
        channel_id: &str,
    ) -> Option<ChannelSessionListReceipt> {
        let response = self.send_daemon_request(
            "GET",
            &format!("/v1/channels/{channel_id}/sessions"),
            None,
            &[],
        )?;
        serde_json::from_str::<ChannelSessionListReceipt>(&response).ok()
    }

    fn create_channel_session_in_daemon(&self, channel_id: &str) -> Option<ChannelSessionReceipt> {
        let response = self.send_daemon_request(
            "POST",
            &format!("/v1/channels/{channel_id}/sessions"),
            Some("{}"),
            &[],
        )?;
        serde_json::from_str::<ChannelSessionReceipt>(&response).ok()
    }

    fn activate_channel_session_in_daemon(
        &self,
        channel_id: &str,
        session_id: &str,
    ) -> Option<ChannelSessionReceipt> {
        let response = self.send_daemon_request(
            "PATCH",
            &format!("/v1/channels/{channel_id}/sessions/{session_id}/active"),
            Some("{}"),
            &[],
        )?;
        serde_json::from_str::<ChannelSessionReceipt>(&response).ok()
    }

    fn send_channel_message_to_daemon(
        &self,
        channel_id: &str,
        request: &SendChannelMessageRequest,
    ) -> Result<SendChannelMessageReceipt, ChannelError> {
        let payload = serde_json::json!({
            "authorId": request.author_id,
            "body": request.body,
            "asTask": request.as_task,
        })
        .to_string();
        let idempotency_key = format!("desktop-channel-message-{}", monotonic_id());
        let response = self
            .send_daemon_request_checked(
                "POST",
                &format!("/v1/channels/{channel_id}/messages"),
                Some(&payload),
                &[("Idempotency-Key", idempotency_key.as_str())],
            )
            .map_err(ChannelError::DaemonRequest)?;
        serde_json::from_str::<SendChannelMessageReceipt>(&response)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))
    }

    fn fetch_tasks_from_daemon(&self, query: &TaskListQuery) -> Option<TaskListReceipt> {
        let response = self.send_daemon_request("GET", &task_list_path(query), None, &[])?;
        serde_json::from_str::<TaskListReceipt>(&response).ok()
    }

    fn fetch_global_search_from_daemon(
        &self,
        query: &GlobalSearchQuery,
    ) -> Result<GlobalSearchReceipt, GlobalSearchError> {
        let response = self
            .send_daemon_request_checked("GET", &global_search_path(query), None, &[])
            .map_err(GlobalSearchError::DaemonRequest)?;
        serde_json::from_str::<GlobalSearchReceipt>(&response)
            .map_err(|error| GlobalSearchError::DaemonResponse(error.to_string()))
    }

    fn fetch_saved_messages_from_daemon(&self) -> Option<SavedMessageListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/saved-messages", None, &[])?;
        serde_json::from_str::<SavedMessageListReceipt>(&response).ok()
    }

    fn save_message_in_daemon(
        &self,
        request: &SaveMessageRequest,
    ) -> Result<SavedMessageReceipt, ConversationError> {
        let body = serde_json::to_string(request).map_err(ConversationError::Json)?;
        let response = self
            .send_daemon_request_checked("POST", "/v1/saved-messages", Some(&body), &[])
            .map_err(|_| ConversationError::DaemonUnavailable)?;
        serde_json::from_str::<SavedMessageReceipt>(&response).map_err(ConversationError::Json)
    }

    fn unsave_message_in_daemon(&self, message_id: &str) -> Result<(), ConversationError> {
        self.send_daemon_request_checked(
            "DELETE",
            &format!("/v1/saved-messages/{message_id}"),
            None,
            &[],
        )
        .map_err(|_| ConversationError::DaemonUnavailable)?;
        Ok(())
    }

    fn fetch_task_thread_from_daemon(&self, task_id: &str) -> Result<TaskThreadReceipt, TaskError> {
        let response = self
            .send_daemon_request_checked("GET", &format!("/v1/tasks/{task_id}/thread"), None, &[])
            .map_err(TaskError::DaemonRequest)?;
        serde_json::from_str::<TaskThreadReceipt>(&response)
            .map_err(|error| TaskError::DaemonResponse(error.to_string()))
    }

    fn reply_to_task_in_daemon(
        &self,
        task_id: &str,
        request: &TaskReplyRequest,
    ) -> Result<TaskReplyReceipt, TaskError> {
        let payload = serde_json::to_string(request)
            .map_err(|error| TaskError::DaemonResponse(error.to_string()))?;
        let idempotency_key = format!("desktop-task-reply-{}", monotonic_id());
        let response = self
            .send_daemon_request_checked(
                "POST",
                &format!("/v1/tasks/{task_id}/replies"),
                Some(&payload),
                &[("Idempotency-Key", idempotency_key.as_str())],
            )
            .map_err(TaskError::DaemonRequest)?;
        serde_json::from_str::<TaskReplyReceipt>(&response)
            .map_err(|error| TaskError::DaemonResponse(error.to_string()))
    }

    fn update_task_status_in_daemon(
        &self,
        task_id: &str,
        request: &TaskStatusUpdateRequest,
    ) -> Result<TaskReceipt, TaskError> {
        let payload = serde_json::to_string(request)
            .map_err(|error| TaskError::DaemonResponse(error.to_string()))?;
        let response = self
            .send_daemon_request_checked(
                "PATCH",
                &format!("/v1/tasks/{task_id}/status"),
                Some(&payload),
                &[],
            )
            .map_err(TaskError::DaemonRequest)?;
        serde_json::from_str::<TaskReceipt>(&response)
            .map_err(|error| TaskError::DaemonResponse(error.to_string()))
    }

    fn create_message_thread_from_source_in_daemon(
        &self,
        request: &CreateMessageThreadRequest,
    ) -> Result<MessageThreadReceipt, ChannelError> {
        let payload = serde_json::to_string(request)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))?;
        let response = self
            .send_daemon_request_checked(
                "POST",
                "/v1/message-threads/from-source-message",
                Some(&payload),
                &[],
            )
            .map_err(ChannelError::DaemonRequest)?;
        serde_json::from_str::<MessageThreadReceipt>(&response)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))
    }

    fn get_message_thread_from_daemon(
        &self,
        thread_id: &str,
    ) -> Result<MessageThreadReceipt, ChannelError> {
        let response = self
            .send_daemon_request_checked(
                "GET",
                &format!("/v1/message-threads/{thread_id}"),
                None,
                &[],
            )
            .map_err(ChannelError::DaemonRequest)?;
        serde_json::from_str::<MessageThreadReceipt>(&response)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))
    }

    fn reply_to_message_thread_in_daemon(
        &self,
        thread_id: &str,
        request: &ReplyToMessageThreadRequest,
    ) -> Result<MessageThreadReplyReceipt, ChannelError> {
        let payload = serde_json::to_string(request)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))?;
        let response = self
            .send_daemon_request_checked(
                "POST",
                &format!("/v1/message-threads/{thread_id}/replies"),
                Some(&payload),
                &[],
            )
            .map_err(ChannelError::DaemonRequest)?;
        serde_json::from_str::<MessageThreadReplyReceipt>(&response)
            .map_err(|error| ChannelError::DaemonResponse(error.to_string()))
    }

    fn complete_interactive_card_in_daemon(&self, card_id: &str) -> Option<InteractiveCardReceipt> {
        let idempotency_key = format!("desktop-card-complete-{card_id}-{}", monotonic_id());
        let response = self.send_daemon_request(
            "POST",
            &format!("/v1/interactive-cards/{card_id}/complete"),
            Some("{}"),
            &[("Idempotency-Key", idempotency_key.as_str())],
        )?;
        serde_json::from_str::<InteractiveCardReceipt>(&response).ok()
    }

    fn resolve_permission_in_daemon(
        &self,
        request: &PermissionResolveRequest,
    ) -> Option<ConversationMessageReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response = self.send_daemon_request(
            "POST",
            "/v1/approvals/permissions/resolve",
            Some(&payload),
            &[],
        )?;
        serde_json::from_str::<ConversationMessageReceipt>(&response).ok()
    }

    fn update_preferences_in_daemon(
        &self,
        request: &PreferencesUpdateRequest,
    ) -> Option<PreferencesReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response =
            self.send_daemon_request("PATCH", "/v1/settings/preferences", Some(&payload), &[])?;
        serde_json::from_str::<PreferencesReceipt>(&response).ok()
    }

    fn update_profile_in_daemon(
        &self,
        request: &ProfileUpdateRequest,
    ) -> Result<ProfileReceipt, ProfileError> {
        let payload = serde_json::to_string(request)
            .map_err(|error| ProfileError::DaemonResponse(error.to_string()))?;
        let response = self
            .send_daemon_request_checked("PATCH", "/v1/settings/profile", Some(&payload), &[])
            .map_err(profile_daemon_request_error)?;
        serde_json::from_str::<ProfileReceipt>(&response)
            .map_err(|error| ProfileError::DaemonResponse(error.to_string()))
    }

    fn fetch_agents_from_daemon(&self) -> Option<AgentListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/agents", None, &[])?;
        let mut receipt = serde_json::from_str::<AgentListReceipt>(&response).ok()?;
        for agent in &mut receipt.agents {
            if agent.agent_kind.as_deref() == Some("guide") {
                if let Some(skills) = self.fetch_agent_skills_from_daemon(&agent.id) {
                    agent.skills = Some(skills.skills);
                }
            }
        }
        Some(receipt)
    }

    fn fetch_agent_skills_from_daemon(&self, agent_id: &str) -> Option<SkillListReceipt> {
        let response =
            self.send_daemon_request("GET", &format!("/v1/agents/{agent_id}/skills"), None, &[])?;
        serde_json::from_str::<SkillListReceipt>(&response).ok()
    }

    fn create_agent_in_daemon(&self, request: &AgentCreateRequest) -> Option<AgentReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let idempotency_key = format!(
            "desktop-agent-create-{}-{}",
            normalize_handle(&request.handle)
                .ok()?
                .trim_start_matches('@'),
            monotonic_id()
        );
        let response = self.send_daemon_request(
            "POST",
            "/v1/agents",
            Some(&payload),
            &[("Idempotency-Key", idempotency_key.as_str())],
        )?;
        serde_json::from_str::<AgentReceipt>(&response).ok()
    }

    fn update_agent_in_daemon(
        &self,
        agent_id: &str,
        request: &AgentUpdateRequest,
    ) -> Option<AgentReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response = self.send_daemon_request(
            "PATCH",
            &format!("/v1/agents/{agent_id}"),
            Some(&payload),
            &[],
        )?;
        serde_json::from_str::<AgentReceipt>(&response).ok()
    }

    fn delete_agent_in_daemon(&self, agent_id: &str) -> Option<AgentReceipt> {
        let response =
            self.send_daemon_request("DELETE", &format!("/v1/agents/{agent_id}"), None, &[])?;
        serde_json::from_str::<AgentReceipt>(&response).ok()
    }

    fn remember_agent_fact_in_daemon(&self, agent_id: &str, fact: &str) -> Option<AgentReceipt> {
        let payload = serde_json::json!({ "fact": fact }).to_string();
        let response = self.send_daemon_request(
            "POST",
            &format!("/v1/agents/{agent_id}/memory/remember"),
            Some(&payload),
            &[],
        )?;
        serde_json::from_str::<AgentReceipt>(&response).ok()
    }

    fn fetch_conversations_from_daemon(&self) -> Option<ConversationListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/conversations", None, &[])?;
        serde_json::from_str::<ConversationListReceipt>(&response).ok()
    }

    fn create_dm_conversation_in_daemon(&self, agent_id: &str) -> Option<ConversationReceipt> {
        let payload = serde_json::json!({ "agentId": agent_id }).to_string();
        let response =
            self.send_daemon_request("POST", "/v1/conversations/dm", Some(&payload), &[])?;
        serde_json::from_str::<ConversationReceipt>(&response).ok()
    }

    fn reset_conversation_runtime_session_in_daemon(
        &self,
        conversation_id: &str,
    ) -> Option<ConversationReceipt> {
        let response = self.send_daemon_request(
            "POST",
            &format!("/v1/conversations/{conversation_id}/runtime-session/reset"),
            Some("{}"),
            &[],
        )?;
        serde_json::from_str::<ConversationReceipt>(&response).ok()
    }

    fn list_conversation_messages_from_daemon(
        &self,
        conversation_id: &str,
        query: Option<&MessagePageQuery>,
    ) -> Option<ConversationMessageListReceipt> {
        let path = message_page_path(
            &format!("/v1/conversations/{conversation_id}/messages"),
            query,
        );
        let response = self.send_daemon_request("GET", &path, None, &[])?;
        serde_json::from_str::<ConversationMessageListReceipt>(&response).ok()
    }

    fn list_conversation_sessions_from_daemon(
        &self,
        conversation_id: &str,
    ) -> Option<ConversationSessionListReceipt> {
        let response = self.send_daemon_request(
            "GET",
            &format!("/v1/conversations/{conversation_id}/sessions"),
            None,
            &[],
        )?;
        serde_json::from_str::<ConversationSessionListReceipt>(&response).ok()
    }

    fn create_conversation_session_in_daemon(
        &self,
        conversation_id: &str,
    ) -> Option<ConversationSessionReceipt> {
        let response = self.send_daemon_request(
            "POST",
            &format!("/v1/conversations/{conversation_id}/sessions"),
            Some("{}"),
            &[],
        )?;
        serde_json::from_str::<ConversationSessionReceipt>(&response).ok()
    }

    fn activate_conversation_session_in_daemon(
        &self,
        conversation_id: &str,
        session_id: &str,
    ) -> Option<ConversationSessionReceipt> {
        let response = self.send_daemon_request(
            "PATCH",
            &format!("/v1/conversations/{conversation_id}/sessions/{session_id}/active"),
            Some("{}"),
            &[],
        )?;
        serde_json::from_str::<ConversationSessionReceipt>(&response).ok()
    }

    fn send_conversation_message_to_daemon(
        &self,
        conversation_id: &str,
        request: &ConversationMessageRequest,
    ) -> Option<ConversationMessageReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response = self.send_daemon_request(
            "POST",
            &format!("/v1/conversations/{conversation_id}/messages"),
            Some(&payload),
            &[],
        )?;
        serde_json::from_str::<ConversationMessageReceipt>(&response).ok()
    }

    fn upload_conversation_attachment_to_daemon(
        &self,
        request: &ConversationAttachmentUploadRequest,
    ) -> Option<ConversationAttachmentReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response = self.send_daemon_request("POST", "/v1/attachments", Some(&payload), &[])?;
        serde_json::from_str::<ConversationAttachmentReceipt>(&response).ok()
    }

    fn upsert_local_agent(&self, agent: DesktopAgentView) {
        let mut agents = self.agents.lock().expect("agents mutex poisoned");
        match agents.iter_mut().find(|candidate| candidate.id == agent.id) {
            Some(existing) => *existing = agent,
            None => agents.push(agent),
        }
        let _ = persist_local_agents_at_root(&self.data_root, &agents);
    }

    fn remove_local_agent_state(
        &self,
        agent_id: &str,
        known_agent: Option<&DesktopAgentView>,
    ) -> Result<(), AgentError> {
        let removed = {
            let mut agents = self.agents.lock().expect("agents mutex poisoned");
            let Some(index) = agents.iter().position(|agent| agent.id == agent_id) else {
                if known_agent.is_none() {
                    return Ok(());
                }
                return Err(AgentError::AgentNotFound);
            };
            if agents[index].system_owned.unwrap_or(false) {
                return Err(AgentError::SystemAgentImmutable);
            }
            let removed = agents.remove(index);
            persist_local_agents_at_root(&self.data_root, &agents)?;
            removed
        };
        self.channel_members
            .lock()
            .expect("channel members mutex poisoned")
            .retain(|member| member.agent_id != agent_id);
        let workspace_path = known_agent
            .map(|agent| agent.workspace_path.as_str())
            .unwrap_or(removed.workspace_path.as_str());
        let workspace_path = Path::new(workspace_path);
        let agents_root = Path::new(&self.data_root).join("agents");
        if !workspace_path.starts_with(&agents_root) {
            return Err(AgentError::WorkspaceBoundary);
        }
        match fs::remove_dir_all(workspace_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(AgentError::Io(error)),
        }
        Ok(())
    }

    fn local_agent_workspace(&self, id: &str) -> String {
        format!("{}/agents/{id}", self.data_root)
    }

    fn upsert_local_channel(&self, channel: ChannelView) {
        let mut channels = self.channels.lock().expect("channels mutex poisoned");
        match channels
            .iter_mut()
            .find(|candidate| candidate.id == channel.id)
        {
            Some(existing) => *existing = channel,
            None => channels.push(channel),
        }
    }

    fn remove_local_channel(&self, channel_id: &str) {
        self.channels
            .lock()
            .expect("channels mutex poisoned")
            .retain(|channel| channel.id != channel_id);
        self.channel_members
            .lock()
            .expect("channel members mutex poisoned")
            .retain(|member| member.channel_id != channel_id);
        self.channel_messages
            .lock()
            .expect("channel messages mutex poisoned")
            .retain(|message| message.channel_id != channel_id);
        self.channel_sessions
            .lock()
            .expect("channel sessions mutex poisoned")
            .retain(|session| session.channel_id != channel_id);
        self.tasks
            .lock()
            .expect("tasks mutex poisoned")
            .retain(|task| task.channel_id != channel_id);
    }

    fn upsert_local_channel_session(&self, session: ChannelSessionView) {
        let mut sessions = self
            .channel_sessions
            .lock()
            .expect("channel sessions mutex poisoned");
        match sessions
            .iter_mut()
            .find(|candidate| candidate.id == session.id)
        {
            Some(existing) => *existing = session,
            None => sessions.push(session),
        }
    }

    fn send_default_all_channel_message_locally(
        &self,
        request: &SendChannelMessageRequest,
    ) -> Result<SendChannelMessageReceipt, ChannelError> {
        if request.author_id.trim().is_empty() || request.body.trim().is_empty() {
            return Err(ChannelError::InvalidChannel);
        }
        let channel_exists = self
            .channels
            .lock()
            .expect("channels mutex poisoned")
            .iter()
            .any(|channel| channel.id == "all");
        if !channel_exists {
            return Err(ChannelError::InvalidChannel);
        }
        let message_id = format!("msg_channel_all_{}", monotonic_id());
        let created_at = monotonic_id();
        let session_id = self
            .channels
            .lock()
            .expect("channels mutex poisoned")
            .iter()
            .find(|channel| channel.id == "all")
            .and_then(|channel| channel.active_session_id.clone());
        self.channel_messages
            .lock()
            .expect("channel messages mutex poisoned")
            .push(ChannelMessageView {
                id: message_id.clone(),
                sequence: None,
                channel_id: "all".to_string(),
                session_id,
                author_id: request.author_id.clone(),
                body: Some(request.body.trim().to_string()),
                cards: None,
                kind: "human".to_string(),
                deleted: false,
                edited: false,
                created_at: created_at.clone(),
                thread: None,
                task: None,
            });
        let should_create_task = request.as_task || is_task_command(&request.body);
        if should_create_task {
            let task_id = format!("task_{message_id}");
            let now = monotonic_id();
            let body = request.body.trim().to_string();
            let task = TaskSummaryView {
                id: task_id.clone(),
                channel_id: "all".to_string(),
                creator_id: request.author_id.clone(),
                assignee_id: None,
                source_message_id: Some(message_id.clone()),
                thread_id: None,
                title: body.chars().take(40).collect(),
                status: "pending_assignment".to_string(),
                attention_required: true,
                reply_count: 0,
                updated_at: now.clone(),
            };
            let thread = TaskThreadView {
                task: task.clone(),
                root: TaskThreadMessageView {
                    id: format!("root_{task_id}"),
                    task_id: task_id.clone(),
                    sender_id: request.author_id.clone(),
                    role: role_for_sender(&request.author_id),
                    body,
                    status: None,
                    created_at: now,
                },
                replies: Vec::new(),
            };
            self.upsert_local_task_thread(thread);
            return Ok(SendChannelMessageReceipt {
                outcome: SendChannelMessageOutcome {
                    message_id,
                    action: "local_needs_manual_assignment".to_string(),
                    task_id: Some(task.id),
                    assignee_agent_id: None,
                    assignee_agent_ids: Vec::new(),
                    coordinator_run_id: None,
                    decision_status: None,
                },
            });
        }
        Ok(SendChannelMessageReceipt {
            outcome: SendChannelMessageOutcome {
                message_id,
                action: "local_archive_only".to_string(),
                task_id: None,
                assignee_agent_id: None,
                assignee_agent_ids: Vec::new(),
                coordinator_run_id: None,
                decision_status: None,
            },
        })
    }

    fn list_tasks_locally(&self, query: &TaskListQuery) -> TaskListReceipt {
        let mut tasks = self
            .tasks
            .lock()
            .expect("tasks mutex poisoned")
            .iter()
            .filter(|task| {
                query
                    .channel_id
                    .as_ref()
                    .is_none_or(|channel_id| task.channel_id == *channel_id)
                    && query
                        .creator_id
                        .as_ref()
                        .is_none_or(|creator_id| task.creator_id == *creator_id)
                    && query.assignee_id.as_ref().is_none_or(|assignee_id| {
                        task.assignee_id.as_deref() == Some(assignee_id.as_str())
                    })
            })
            .cloned()
            .collect::<Vec<_>>();
        tasks.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        TaskListReceipt { tasks }
    }

    fn get_task_thread_locally(&self, task_id: &str) -> Result<TaskThreadReceipt, TaskError> {
        self.task_threads
            .lock()
            .expect("task threads mutex poisoned")
            .iter()
            .find(|thread| thread.task.id == task_id)
            .cloned()
            .map(|thread| TaskThreadReceipt { thread })
            .ok_or(TaskError::TaskNotFound)
    }

    fn reply_to_task_locally(
        &self,
        task_id: &str,
        request: TaskReplyRequest,
    ) -> Result<TaskReplyReceipt, TaskError> {
        let body = request.body.trim();
        if request.sender_id.trim().is_empty() || body.is_empty() {
            return Err(TaskError::InvalidTask);
        }
        let mut task_threads = self
            .task_threads
            .lock()
            .expect("task threads mutex poisoned");
        let thread = task_threads
            .iter_mut()
            .find(|thread| thread.task.id == task_id)
            .ok_or(TaskError::TaskNotFound)?;
        let role = role_for_sender(&request.sender_id);
        let reply = TaskThreadMessageView {
            id: format!("reply-{task_id}-{}", thread.replies.len() + 1),
            task_id: task_id.to_string(),
            sender_id: request.sender_id,
            role,
            body: body.to_string(),
            status: None,
            created_at: monotonic_id(),
        };
        thread.replies.push(reply.clone());
        thread.task.reply_count = thread.replies.len();
        thread.task.updated_at = reply.created_at.clone();
        let task = thread.task.clone();
        drop(task_threads);
        self.upsert_local_task(task);
        Ok(TaskReplyReceipt {
            reply,
            route: TaskReplyRoute {
                handoff_agent_ids: Vec::new(),
                needs_assignment: false,
            },
        })
    }

    fn update_task_status_locally(
        &self,
        task_id: &str,
        request: TaskStatusUpdateRequest,
    ) -> Result<TaskReceipt, TaskError> {
        if !matches!(
            request.status.as_str(),
            "pending_assignment" | "in_progress" | "in_review" | "done"
        ) {
            return Err(TaskError::InvalidTask);
        }
        let mut task_threads = self
            .task_threads
            .lock()
            .expect("task threads mutex poisoned");
        let thread = task_threads
            .iter_mut()
            .find(|thread| thread.task.id == task_id)
            .ok_or(TaskError::TaskNotFound)?;
        thread.task.status = request.status;
        thread.task.attention_required = thread.task.status == "pending_assignment";
        thread.task.updated_at = monotonic_id();
        let task = thread.task.clone();
        drop(task_threads);
        self.upsert_local_task(task.clone());
        Ok(TaskReceipt { task })
    }

    fn upsert_local_task_thread(&self, thread: TaskThreadView) {
        self.upsert_local_task(thread.task.clone());
        let mut task_threads = self
            .task_threads
            .lock()
            .expect("task threads mutex poisoned");
        match task_threads
            .iter_mut()
            .find(|candidate| candidate.task.id == thread.task.id)
        {
            Some(existing) => *existing = thread,
            None => task_threads.push(thread),
        }
    }

    fn upsert_local_task(&self, task: TaskSummaryView) {
        let mut tasks = self.tasks.lock().expect("tasks mutex poisoned");
        match tasks.iter_mut().find(|candidate| candidate.id == task.id) {
            Some(existing) => *existing = task,
            None => tasks.push(task),
        }
    }

    fn apply_local_task_reply(&self, task_id: &str, reply: TaskThreadMessageView) {
        let mut updated_task = None;
        {
            let mut task_threads = self
                .task_threads
                .lock()
                .expect("task threads mutex poisoned");
            if let Some(thread) = task_threads
                .iter_mut()
                .find(|thread| thread.task.id == task_id)
            {
                thread.replies.push(reply.clone());
                thread.task.reply_count = thread.replies.len();
                thread.task.updated_at = reply.created_at.clone();
                updated_task = Some(thread.task.clone());
            }
        }
        if let Some(task) = updated_task {
            self.upsert_local_task(task);
        }
    }

    fn upsert_local_card(&self, card: InteractiveCardView) {
        let mut cards = self.cards.lock().expect("cards mutex poisoned");
        match cards.iter_mut().find(|candidate| candidate.id == card.id) {
            Some(existing) => *existing = card,
            None => cards.push(card),
        }
    }

    fn complete_loaded_message_card(
        &self,
        card_id: &str,
    ) -> Result<Option<InteractiveCardView>, ConversationError> {
        let mut messages = self
            .conversation_messages
            .lock()
            .expect("conversation messages mutex poisoned");
        let mut completed = None;
        for message in messages.iter_mut() {
            let Some(cards) = message.cards.as_mut() else {
                continue;
            };
            let Some(card) = cards.iter_mut().find(|card| card.id == card_id) else {
                continue;
            };
            card.state = "done".to_string();
            completed = Some((message.conversation_id.clone(), card.clone()));
            break;
        }
        let Some((conversation_id, card)) = completed else {
            return Ok(None);
        };
        persist_local_conversation_messages_at_root(&self.data_root, &conversation_id, &messages)?;
        Ok(Some(card))
    }

    fn ensure_channel_membership(&self, channel_id: &str, agent_id: &str) {
        let mut members = self
            .channel_members
            .lock()
            .expect("channel members mutex poisoned");
        if members
            .iter()
            .any(|member| member.channel_id == channel_id && member.agent_id == agent_id)
        {
            return;
        }
        members.push(ChannelMemberView {
            channel_id: channel_id.to_string(),
            agent_id: agent_id.to_string(),
            joined_at: monotonic_id(),
            readiness: "ready".to_string(),
        });
    }

    fn upsert_channel_member(&self, member: ChannelMemberView) {
        let mut members = self
            .channel_members
            .lock()
            .expect("channel members mutex poisoned");
        match members.iter_mut().find(|candidate| {
            candidate.channel_id == member.channel_id && candidate.agent_id == member.agent_id
        }) {
            Some(existing) => *existing = member,
            None => members.push(member),
        }
    }

    fn upsert_local_conversation(
        &self,
        conversation: ConversationView,
    ) -> Result<(), ConversationError> {
        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        match conversations
            .iter_mut()
            .find(|candidate| candidate.id == conversation.id)
        {
            Some(existing) => *existing = conversation,
            None => conversations.push(conversation),
        }
        persist_local_conversations_at_root(&self.data_root, &conversations)
    }

    fn upsert_local_conversation_session(
        &self,
        session: ConversationSessionView,
    ) -> Result<(), ConversationError> {
        let mut sessions = self
            .conversation_sessions
            .lock()
            .expect("conversation sessions mutex poisoned");
        match sessions
            .iter_mut()
            .find(|candidate| candidate.id == session.id)
        {
            Some(existing) => *existing = session,
            None => sessions.push(session),
        }
        persist_local_conversation_sessions_at_root(&self.data_root, &sessions)
    }

    fn upsert_local_conversation_message(
        &self,
        message: ConversationMessageView,
    ) -> Result<(), ConversationError> {
        let conversation_id = message.conversation_id.clone();
        let mut messages = self
            .conversation_messages
            .lock()
            .expect("conversation messages mutex poisoned");
        match messages
            .iter_mut()
            .find(|candidate| candidate.id == message.id)
        {
            Some(existing) => *existing = message,
            None => messages.push(message),
        }
        persist_local_conversation_messages_at_root(&self.data_root, &conversation_id, &messages)
    }

    fn upsert_local_attachment(
        &self,
        attachment: ConversationAttachmentView,
    ) -> Result<(), ConversationError> {
        let mut attachments = self
            .conversation_attachments
            .lock()
            .expect("conversation attachments mutex poisoned");
        match attachments
            .iter_mut()
            .find(|candidate| candidate.id == attachment.id)
        {
            Some(existing) => *existing = attachment,
            None => attachments.push(attachment),
        }
        persist_local_attachments_at_root(&self.data_root, &attachments)
    }

    fn clear_local_active_session_cache(
        &self,
        conversation_id: &str,
    ) -> Result<(), ConversationError> {
        let active_session_id = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned")
            .iter()
            .find(|conversation| conversation.id == conversation_id)
            .and_then(|conversation| conversation.active_session_id.clone())
            .ok_or(ConversationError::ConversationNotFound)?;

        let removed_attachment_ids = {
            let mut messages = self
                .conversation_messages
                .lock()
                .expect("conversation messages mutex poisoned");
            let removed_attachment_ids = messages
                .iter()
                .filter(|message| {
                    message.conversation_id == conversation_id
                        && message.session_id.as_deref() == Some(&active_session_id)
                })
                .flat_map(|message| {
                    message
                        .attachments
                        .as_deref()
                        .unwrap_or(&[])
                        .iter()
                        .map(|attachment| attachment.id.clone())
                })
                .collect::<std::collections::HashSet<_>>();
            messages.retain(|message| {
                message.conversation_id != conversation_id
                    || message.session_id.as_deref() != Some(&active_session_id)
            });
            persist_local_conversation_messages_at_root(
                &self.data_root,
                conversation_id,
                &messages,
            )?;
            removed_attachment_ids
        };

        {
            let mut sessions = self
                .conversation_sessions
                .lock()
                .expect("conversation sessions mutex poisoned");
            if let Some(session) = sessions
                .iter_mut()
                .find(|session| session.id == active_session_id)
            {
                session.title = "新会话".to_string();
                session.status = "ready".to_string();
                session.runtime_session = None;
                session.updated_at = monotonic_id();
            }
            persist_local_conversation_sessions_at_root(&self.data_root, &sessions)?;
        }

        if removed_attachment_ids.is_empty() {
            return Ok(());
        }
        let referenced_attachment_ids = self
            .conversation_messages
            .lock()
            .expect("conversation messages mutex poisoned")
            .iter()
            .flat_map(|message| {
                message
                    .attachments
                    .as_deref()
                    .unwrap_or(&[])
                    .iter()
                    .map(|attachment| attachment.id.clone())
            })
            .collect::<std::collections::HashSet<_>>();
        let mut attachments = self
            .conversation_attachments
            .lock()
            .expect("conversation attachments mutex poisoned");
        attachments.retain(|attachment| {
            if !removed_attachment_ids.contains(&attachment.id)
                || referenced_attachment_ids.contains(&attachment.id)
            {
                return true;
            }
            if let Some(path) = &attachment.cache_path {
                let _ = fs::remove_file(path);
                if let Some(parent) = Path::new(path).parent() {
                    let _ = fs::remove_dir(parent);
                }
            }
            false
        });
        persist_local_attachments_at_root(&self.data_root, &attachments)
    }

    fn upsert_session_runtime(
        &self,
        conversation_id: &str,
        session_id: &str,
        runtime_session: RuntimeSessionView,
        title_hint: &str,
    ) {
        let now = monotonic_id();
        let mut sessions = self
            .conversation_sessions
            .lock()
            .expect("conversation sessions mutex poisoned");
        if let Some(session) = sessions.iter_mut().find(|session| session.id == session_id) {
            session.runtime_session = Some(runtime_session);
            if session.title == "新会话" && !title_hint.trim().is_empty() {
                session.title = title_hint.trim().chars().take(40).collect();
            }
            session.updated_at = now;
        } else {
            sessions.push(ConversationSessionView {
                id: session_id.to_string(),
                conversation_id: conversation_id.to_string(),
                title: if title_hint.trim().is_empty() {
                    "新会话".to_string()
                } else {
                    title_hint.trim().chars().take(40).collect()
                },
                status: "ready".to_string(),
                runtime_session: Some(runtime_session),
                created_at: now.clone(),
                updated_at: now,
            });
        }
        let _ = persist_local_conversation_sessions_at_root(&self.data_root, &sessions);
    }

    fn replace_local_preferences(&self, preferences: UserPreferencesView) {
        *self.preferences.lock().expect("preferences mutex poisoned") = preferences;
    }

    fn replace_local_profile(&self, profile: Option<UserProfileView>) {
        *self.profile.lock().expect("profile mutex poisoned") = profile;
    }

    fn record_local_diagnostic(&self, event: String) {
        eprintln!("[slei-desktop] {event}");
        self.diagnostic_events
            .lock()
            .expect("diagnostic events mutex poisoned")
            .push(event);
    }

    fn send_daemon_request(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        extra_headers: &[(&str, &str)],
    ) -> Option<String> {
        self.send_daemon_request_checked(method, path, body, extra_headers)
            .ok()
    }

    fn send_daemon_request_checked(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        extra_headers: &[(&str, &str)],
    ) -> Result<String, String> {
        self.last_authorization_header
            .lock()
            .expect("authorization mutex poisoned")
            .replace(format!("Bearer {}", self.descriptor.token));

        let (host_header, socket_addr) = parse_http_endpoint(&self.descriptor.endpoint)
            .ok_or_else(|| "invalid daemon endpoint".to_string())?;
        let socket_addr = socket_addr
            .to_socket_addrs()
            .map_err(|error| format!("daemon endpoint resolution failed: {error}"))?
            .next()
            .ok_or_else(|| "daemon endpoint resolution returned no addresses".to_string())?;
        let mut stream = TcpStream::connect_timeout(&socket_addr, Duration::from_millis(80))
            .map_err(|error| format!("daemon connection failed: {error}"))?;
        stream
            .set_read_timeout(Some(Duration::from_millis(160)))
            .map_err(|error| format!("daemon read timeout setup failed: {error}"))?;
        stream
            .set_write_timeout(Some(Duration::from_millis(80)))
            .map_err(|error| format!("daemon write timeout setup failed: {error}"))?;

        let body = body.unwrap_or("");
        let content_headers = if body.is_empty() {
            String::new()
        } else {
            format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            )
        };
        let extra_headers = extra_headers
            .iter()
            .map(|(name, value)| format!("{name}: {value}\r\n"))
            .collect::<String>();
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: {host_header}\r\nAuthorization: Bearer {}\r\n{content_headers}{extra_headers}Connection: close\r\n\r\n{body}",
            self.descriptor.token
        );
        stream
            .write_all(request.as_bytes())
            .map_err(|error| format!("daemon request write failed: {error}"))?;

        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .map_err(|error| format!("daemon response read failed: {error}"))?;
        if !response.starts_with("HTTP/1.1 200")
            && !response.starts_with("HTTP/1.0 200")
            && !response.starts_with("HTTP/1.1 201")
            && !response.starts_with("HTTP/1.0 201")
            && !response.starts_with("HTTP/1.1 202")
            && !response.starts_with("HTTP/1.0 202")
            && !response.starts_with("HTTP/1.1 204")
            && !response.starts_with("HTTP/1.0 204")
        {
            let status = response
                .lines()
                .next()
                .unwrap_or("HTTP response missing status");
            let body = response.split("\r\n\r\n").nth(1).unwrap_or("");
            return Err(format!("{status}: {body}"));
        }

        response
            .split("\r\n\r\n")
            .nth(1)
            .map(str::to_string)
            .ok_or_else(|| "daemon response missing body separator".to_string())
    }
}

fn validate_agent_create(request: &AgentCreateRequest) -> Result<(), AgentError> {
    if request.name.trim().is_empty()
        || request.runtime_kind.trim().is_empty()
        || request.node_id.trim().is_empty()
    {
        return Err(AgentError::InvalidAgent);
    }
    normalize_handle(&request.handle)?;
    Ok(())
}

fn normalize_handle(handle: &str) -> Result<String, AgentError> {
    let trimmed = handle.trim().trim_start_matches('@').to_lowercase();
    let valid = !trimmed.is_empty()
        && trimmed.len() <= 32
        && trimmed.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if valid {
        Ok(format!("@{trimmed}"))
    } else {
        Err(AgentError::InvalidHandle)
    }
}

fn profile_daemon_request_error(error: String) -> ProfileError {
    if error.starts_with("HTTP/") {
        return ProfileError::DaemonRequest(extract_daemon_error_message(&error));
    }
    if error.contains("daemon response missing body separator") {
        return ProfileError::DaemonResponse(error);
    }
    ProfileError::DaemonUnavailable
}

fn extract_daemon_error_message(error: &str) -> String {
    let body = error.split_once(": ").map(|(_, body)| body.trim());
    body.and_then(|body| serde_json::from_str::<serde_json::Value>(body).ok())
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| error.to_string())
}

fn local_data_root() -> String {
    let root = env::var("SLEI_DATA_ROOT")
        .or_else(|_| env::var("HOME").map(|home| format!("{home}/.slei")))
        .unwrap_or_else(|_| ".slei".to_string());
    root
}

fn slei_debug_enabled() -> bool {
    env::var("SLEI_DEBUG")
        .map(|value| debug_flag_value_enabled(&value))
        .unwrap_or(false)
        || env::args().any(|arg| {
            arg == "--debug"
                || arg == "--slei-debug"
                || arg
                    .strip_prefix("--debug=")
                    .map(debug_flag_value_enabled)
                    .unwrap_or(false)
                || arg
                    .strip_prefix("--slei-debug=")
                    .map(debug_flag_value_enabled)
                    .unwrap_or(false)
        })
}

fn debug_flag_value_enabled(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    !normalized.is_empty() && normalized != "0" && normalized != "false" && normalized != "off"
}

fn persist_local_agents_at_root(root: &str, agents: &[DesktopAgentView]) -> Result<(), AgentError> {
    let _ = (root, agents);
    Ok(())
}

fn create_local_agent_workspace(agent: &DesktopAgentView) -> Result<(), AgentError> {
    fs::create_dir_all(&agent.docs_path).map_err(AgentError::Io)?;
    fs::write(&agent.memory_path, initial_memory(agent)).map_err(AgentError::Io)?;
    write_local_agent_channel_notes(agent)?;
    write_local_agent_skills(agent)
}

fn write_local_agent_channel_notes(agent: &DesktopAgentView) -> Result<(), AgentError> {
    let notes_dir = Path::new(&agent.workspace_path).join("notes");
    fs::create_dir_all(&notes_dir).map_err(AgentError::Io)?;
    let mut channel_ids = agent
        .channel_ids
        .clone()
        .unwrap_or_else(|| vec!["all".to_string()]);
    channel_ids.sort_by(|left, right| {
        (left != "all")
            .cmp(&(right != "all"))
            .then_with(|| left.cmp(right))
    });
    let sections = channel_ids
        .into_iter()
        .map(|channel_id| {
            format!(
                "## #{channel_id}\n- Channel id: {channel_id}\n- Associated projects: 无\n- Roster:\n- {} ({}) — {}\n- Handoff rule: finish the current stage, then visibly @ the next suitable member from this channel roster; if no handoff is needed, @ the current user for acceptance/review.\n",
                agent.handle, agent.name, agent.description
            )
        })
        .collect::<Vec<_>>();
    fs::write(
        notes_dir.join("channels.md"),
        format!("# Channel Notes\n\n{}\n", sections.join("\n")),
    )
    .map_err(AgentError::Io)
}

fn write_local_agent_skills(agent: &DesktopAgentView) -> Result<(), AgentError> {
    let skills = default_skill_assets(agent);
    for skill in &skills {
        if let Some(parent) = Path::new(&skill.path).parent() {
            fs::create_dir_all(parent).map_err(AgentError::Io)?;
        }
        fs::write(&skill.path, &skill.body).map_err(AgentError::Io)?;
    }
    cleanup_legacy_default_skills(agent)
}

fn normalize_guide_agent_identity(mut agent: DesktopAgentView) -> DesktopAgentView {
    if agent.id == "agent_guide_local_node" || agent.agent_kind.as_deref() == Some("guide") {
        agent.name = "Yeal".to_string();
        agent.handle = "@yeal".to_string();
        agent.avatar_seed = "yeal".to_string();
    }
    agent
}

fn sanitize_legacy_guide_memory(agent: &DesktopAgentView) -> Result<(), AgentError> {
    if agent.agent_kind.as_deref() != Some("guide") {
        return Ok(());
    }
    let memory = match fs::read_to_string(&agent.memory_path) {
        Ok(memory) => memory,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(AgentError::Io(error)),
    };
    let cleaned = remove_legacy_guide_memory_lines(&memory);
    if cleaned != memory {
        fs::write(&agent.memory_path, cleaned).map_err(AgentError::Io)?;
    }
    Ok(())
}

fn remove_legacy_guide_memory_lines(memory: &str) -> String {
    let mut cleaned = memory
        .lines()
        .filter(|line| !is_legacy_guide_memory_line(line))
        .collect::<Vec<_>>()
        .join("\n");
    if memory.ends_with('\n') {
        cleaned.push('\n');
    }
    cleaned
}

fn is_legacy_guide_memory_line(line: &str) -> bool {
    line.contains("@Alice")
        || line.contains("@Nancy")
        || line.contains("@Cindy")
        || line.contains("Alice + Coda + Nancy")
        || line.contains("团队协作流程：用户/Alice")
}

fn read_local_agent_skills(agent: &DesktopAgentView) -> Result<Vec<SkillView>, AgentError> {
    read_standard_agent_skills(agent).or_else(|error| {
        if matches!(error, AgentError::Io(ref io_error) if io_error.kind() == std::io::ErrorKind::NotFound)
        {
            read_legacy_agent_skills(agent).or_else(|legacy_error| {
                if matches!(legacy_error, AgentError::Io(ref io_error) if io_error.kind() == std::io::ErrorKind::NotFound)
                {
                    Ok(default_skill_records(agent))
                } else {
                    Err(legacy_error)
                }
            }).and_then(|legacy| {
                write_local_agent_skills(agent)?;
                read_standard_agent_skills(agent).or(Ok(legacy))
            })
        } else {
            Err(error)
        }
    })
}

fn default_skill_records(agent: &DesktopAgentView) -> Vec<SkillView> {
    default_skill_assets(agent)
        .into_iter()
        .map(|skill| SkillView {
            id: skill.id,
            name: skill.name,
            trigger: skill.trigger,
            path: skill.path,
        })
        .collect()
}

struct DefaultSkillFile {
    id: String,
    name: String,
    trigger: String,
    path: String,
    body: String,
}

fn default_skill_assets(agent: &DesktopAgentView) -> Vec<DefaultSkillFile> {
    standard_skill_assets(&agent_template_input(agent))
        .into_iter()
        .map(|skill| DefaultSkillFile {
            id: skill.id.to_string(),
            name: skill.name.to_string(),
            trigger: skill.trigger,
            path: standard_skill_path(agent, skill.id)
                .to_string_lossy()
                .to_string(),
            body: skill.body,
        })
        .collect()
}

fn read_standard_agent_skills(agent: &DesktopAgentView) -> Result<Vec<SkillView>, AgentError> {
    let skills_root = standard_skills_root(agent);
    let mut skills = Vec::new();
    for entry in fs::read_dir(&skills_root).map_err(AgentError::Io)? {
        let entry = entry.map_err(AgentError::Io)?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_path = path.join("SKILL.md");
        if !skill_path.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&skill_path).map_err(AgentError::Io)?;
        let id = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        let (name, trigger) =
            parse_skill_frontmatter(&raw).unwrap_or_else(|| (id.clone(), String::new()));
        skills.push(SkillView {
            id,
            name,
            trigger,
            path: skill_path.to_string_lossy().to_string(),
        });
    }
    if skills.is_empty() {
        return Err(AgentError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no standard skills found",
        )));
    }
    skills.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(skills)
}

fn read_legacy_agent_skills(agent: &DesktopAgentView) -> Result<Vec<SkillView>, AgentError> {
    let skills_index = format!("{}/skills/index.json", agent.workspace_path);
    fs::read_to_string(&skills_index)
        .map_err(AgentError::Io)
        .and_then(|raw| serde_json::from_str::<Vec<SkillView>>(&raw).map_err(AgentError::Json))
}

fn standard_skills_root(agent: &DesktopAgentView) -> PathBuf {
    PathBuf::from(&agent.workspace_path).join(".claude/skills")
}

fn standard_skill_path(agent: &DesktopAgentView, id: &str) -> PathBuf {
    standard_skills_root(agent).join(id).join("SKILL.md")
}

fn parse_skill_frontmatter(raw: &str) -> Option<(String, String)> {
    let mut lines = raw.lines();
    if lines.next()? != "---" {
        return None;
    }
    let mut name = None;
    let mut description = None;
    for line in lines {
        if line == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name:") {
            name = Some(value.trim().trim_matches('"').to_string());
        }
        if let Some(value) = line.strip_prefix("description:") {
            description = Some(value.trim().trim_matches('"').to_string());
        }
    }
    Some((name?, description?))
}

fn cleanup_legacy_default_skills(agent: &DesktopAgentView) -> Result<(), AgentError> {
    let workspace_root = PathBuf::from(&agent.workspace_path);
    for file_name in ["memory.skill.md", "guide-create.skill.md"] {
        let path = workspace_root.join(file_name);
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(AgentError::Io(error)),
        }
    }

    let legacy_root = PathBuf::from(&agent.workspace_path).join("skills");
    for file_name in ["index.json", "memory.skill.md", "guide-create.skill.md"] {
        let path = legacy_root.join(file_name);
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(AgentError::Io(error)),
        }
    }
    match fs::remove_dir(&legacy_root) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {}
        Err(error) => return Err(AgentError::Io(error)),
    }
    Ok(())
}

fn canonicalize_agent_path(path: &str) -> Result<PathBuf, AgentPathError> {
    Path::new(path).canonicalize().map_err(AgentPathError::Io)
}

fn resolve_workspace_child_path(
    workspace_path: &str,
    relative_path: Option<&str>,
) -> Result<(PathBuf, PathBuf, String), AgentPathError> {
    let workspace = canonicalize_agent_path(workspace_path)?;
    let relative_child = workspace_child_path(relative_path.unwrap_or(""))?;
    let path = workspace
        .join(relative_child)
        .canonicalize()
        .map_err(AgentPathError::Io)?;
    if !path.starts_with(&workspace) {
        return Err(AgentPathError::WorkspaceBoundary);
    }
    let normalized_relative_path = workspace_relative_path(&workspace, &path)?;
    Ok((workspace, path, normalized_relative_path))
}

fn workspace_child_path(relative_path: &str) -> Result<PathBuf, AgentPathError> {
    let trimmed = relative_path.trim().trim_start_matches('/');
    if trimmed.is_empty() {
        return Ok(PathBuf::new());
    }
    let path = Path::new(trimmed);
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(AgentPathError::WorkspaceBoundary);
    }
    Ok(path.to_path_buf())
}

fn workspace_relative_path(workspace: &Path, path: &Path) -> Result<String, AgentPathError> {
    let relative = path
        .strip_prefix(workspace)
        .map_err(|_| AgentPathError::WorkspaceBoundary)?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

fn open_system_path(path: &Path) -> Result<(), AgentPathError> {
    if env::var("SLEI_DISABLE_SYSTEM_OPEN").as_deref() == Ok("1") {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .status()
        .map_err(AgentPathError::Io)
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(AgentPathError::OpenFailed)
            }
        })
}

fn agent_template_input(agent: &DesktopAgentView) -> AgentTemplateInput<'_> {
    AgentTemplateInput {
        name: &agent.name,
        handle: &agent.handle,
        description: &agent.description,
        agent_kind: agent.agent_kind.as_deref(),
        channel_ids: agent
            .channel_ids
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(String::as_str)
            .collect(),
    }
}

fn is_active_context_fact(fact: &str) -> bool {
    let normalized = fact.to_lowercase();
    fact.contains("当前")
        || fact.contains("正在")
        || fact.contains("下次继续")
        || normalized.contains("blocked")
        || normalized.contains("next")
        || normalized.contains("resume")
}

fn append_key_knowledge(memory: &mut String, fact: &str) {
    let line = format!("\n- {}\n", fact.trim());
    if let Some(index) = memory.find("## Active Context") {
        memory.insert_str(index, &line);
    } else {
        if !memory.ends_with('\n') {
            memory.push('\n');
        }
        memory.push_str("\n## Key Knowledge\n");
        memory.push_str(&line);
    }
}

fn replace_active_context(memory: &mut String, fact: &str) {
    let active_heading = "## Active Context";
    let replacement = format!("{active_heading}\n- State: {}\n", fact.trim());
    if let Some(start) = memory.find(active_heading) {
        let after_heading = start + active_heading.len();
        let rest = &memory[after_heading..];
        let end = rest
            .find("\n## ")
            .map(|relative| after_heading + relative)
            .unwrap_or(memory.len());
        memory.replace_range(start..end, replacement.trim_end_matches('\n'));
        if !memory.ends_with('\n') {
            memory.push('\n');
        }
    } else {
        if !memory.ends_with('\n') {
            memory.push('\n');
        }
        memory.push('\n');
        memory.push_str(&replacement);
    }
}

fn append_local_agent_memory(agent: &DesktopAgentView, fact: &str) -> Result<(), AgentError> {
    let mut memory = fs::read_to_string(&agent.memory_path).map_err(AgentError::Io)?;
    let fact = fact.trim().trim_start_matches("记住：").trim();
    if is_active_context_fact(fact) {
        replace_active_context(&mut memory, fact);
    } else {
        append_key_knowledge(&mut memory, fact);
    }
    fs::write(&agent.memory_path, memory).map_err(AgentError::Io)?;
    Ok(())
}

fn initial_memory(agent: &DesktopAgentView) -> String {
    shared_initial_memory(&agent_template_input(agent))
}

fn is_daemon_unavailable_error(error: &str) -> bool {
    error.contains("daemon connection failed")
        || error.contains("invalid daemon endpoint")
        || error.contains("daemon endpoint resolution failed")
        || error.contains("daemon endpoint resolution returned no addresses")
}

fn task_list_path(query: &TaskListQuery) -> String {
    let mut pairs = Vec::new();
    if let Some(channel_id) = query
        .channel_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pairs.push(format!("channelId={}", query_component(channel_id)));
    }
    if let Some(creator_id) = query
        .creator_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pairs.push(format!("creatorId={}", query_component(creator_id)));
    }
    if let Some(assignee_id) = query
        .assignee_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pairs.push(format!("assigneeId={}", query_component(assignee_id)));
    }
    if pairs.is_empty() {
        "/v1/tasks".to_string()
    } else {
        format!("/v1/tasks?{}", pairs.join("&"))
    }
}

fn global_search_path(query: &GlobalSearchQuery) -> String {
    let mut pairs = vec![format!("query={}", query_component(query.q.trim()))];
    if let Some(from_id) = query.from_id.as_deref().filter(|value| !value.is_empty()) {
        pairs.push(format!("fromId={}", query_component(from_id)));
    }
    if let Some(channel_id) = query
        .channel_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pairs.push(format!("channelId={}", query_component(channel_id)));
    }
    if let Some(time_range) = query
        .time_range
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pairs.push(format!("timeRange={}", query_component(time_range)));
    }
    if let Some(time_zone) = query.time_zone.as_deref().filter(|value| !value.is_empty()) {
        pairs.push(format!("timeZone={}", query_component(time_zone)));
    }
    if let Some(include_agents) = query.include_agents {
        pairs.push(format!("includeAgents={include_agents}"));
    }
    if let Some(include_channels) = query.include_channels {
        pairs.push(format!("includeChannels={include_channels}"));
    }
    if let Some(include_messages) = query.include_messages {
        pairs.push(format!("includeMessages={include_messages}"));
    }
    if let Some(agent_limit) = query.agent_limit {
        pairs.push(format!("agentLimit={agent_limit}"));
    }
    if let Some(channel_limit) = query.channel_limit {
        pairs.push(format!("channelLimit={channel_limit}"));
    }
    if let Some(message_limit) = query.message_limit {
        pairs.push(format!("messageLimit={message_limit}"));
    }
    format!("/v1/search/global?{}", pairs.join("&"))
}

fn query_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn is_task_command(body: &str) -> bool {
    [
        "实现",
        "修复",
        "检查",
        "整理",
        "创建",
        "改一下",
        "写一个",
        "生成",
        "调查",
        "验证",
    ]
    .iter()
    .any(|marker| body.contains(marker))
}

fn role_for_sender(sender_id: &str) -> String {
    if sender_id.starts_with("agent") {
        "agent".to_string()
    } else if sender_id.starts_with("system") {
        "system".to_string()
    } else {
        "human".to_string()
    }
}

fn monotonic_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn parse_http_endpoint(endpoint: &str) -> Option<(String, String)> {
    let without_scheme = endpoint.strip_prefix("http://")?;
    let host_port = without_scheme.split('/').next()?.to_string();
    Some((host_port.clone(), host_port))
}

fn detect_device_meta() -> DeviceMetaView {
    DeviceMetaView {
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        hostname: command_output("hostname", &[]).unwrap_or_else(|| "local-device".to_string()),
    }
}

fn detect_claude_runtime() -> RuntimeReadinessView {
    let version = env::var("SLEI_CLAUDE_VERSION_OVERRIDE")
        .ok()
        .or_else(|| command_output("claude", &["--version"]));

    RuntimeReadinessView {
        kind: "ClaudeCode".to_string(),
        readiness: if version.is_some() {
            "ready"
        } else {
            "unavailable"
        }
        .to_string(),
        version: version.and_then(|output| parse_claude_version(&output)),
    }
}

fn parse_claude_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|part| part.chars().any(|ch| ch.is_ascii_digit()) && part.contains('.'))
        .map(|part| {
            part.trim_matches(|ch: char| ch == ',' || ch == ';')
                .to_string()
        })
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!stdout.is_empty()).then_some(stdout)
}

fn persist_local_conversations_at_root(
    root: &str,
    conversations: &[ConversationView],
) -> Result<(), ConversationError> {
    let _ = (root, conversations);
    Ok(())
}

fn persist_local_conversation_sessions_at_root(
    root: &str,
    sessions: &[ConversationSessionView],
) -> Result<(), ConversationError> {
    let _ = (root, sessions);
    Ok(())
}

fn persist_local_attachments_at_root(
    root: &str,
    attachments: &[ConversationAttachmentView],
) -> Result<(), ConversationError> {
    let _ = (root, attachments);
    Ok(())
}

fn default_preferences() -> UserPreferencesView {
    UserPreferencesView {
        locale: system_default_locale(),
        time_zone: system_default_time_zone(),
        appearance: AppearancePreferencesView {
            theme: "system".to_string(),
            font_size: "md".to_string(),
        },
        notifications: NotificationPreferencesView {
            mentions: true,
            human_replies: true,
            approvals: true,
        },
    }
}

fn system_default_locale() -> String {
    locale_from_env(
        env::var("LC_ALL").ok().as_deref(),
        env::var("LC_MESSAGES").ok().as_deref(),
        env::var("LANG").ok().as_deref(),
    )
}

fn locale_from_env(lc_all: Option<&str>, lc_messages: Option<&str>, lang: Option<&str>) -> String {
    for value in [lc_all, lc_messages, lang].into_iter().flatten() {
        let normalized = value.trim().to_ascii_lowercase().replace('_', "-");
        if normalized.starts_with("zh") {
            return "zh-CN".to_string();
        }
        if normalized.starts_with("en") {
            return "en-US".to_string();
        }
    }
    "zh-CN".to_string()
}

fn system_default_time_zone() -> String {
    if let Ok(time_zone) = env::var("TZ") {
        let trimmed = time_zone.trim();
        if is_supported_time_zone(trimmed) {
            return trimmed.to_string();
        }
    }
    if let Some(time_zone) = time_zone_from_localtime_path("/etc/localtime") {
        return time_zone;
    }
    "Asia/Shanghai".to_string()
}

fn time_zone_from_localtime_path(path: &str) -> Option<String> {
    let target = fs::read_link(path).ok()?;
    let target = target.to_string_lossy();
    let marker = "zoneinfo/";
    let index = target.find(marker)?;
    let time_zone = &target[index + marker.len()..];
    is_supported_time_zone(time_zone).then(|| time_zone.to_string())
}

fn is_supported_time_zone(time_zone: &str) -> bool {
    !time_zone.is_empty()
        && time_zone.chars().count() <= 64
        && time_zone.contains('/')
        && time_zone.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '_' | '-' | '+')
        })
}

fn legacy_session_for_conversation(conversation: &ConversationView) -> ConversationSessionView {
    let id = conversation
        .active_session_id
        .clone()
        .unwrap_or_else(|| format!("session:{}:default", safe_conversation_id(&conversation.id)));
    ConversationSessionView {
        id,
        conversation_id: conversation.id.clone(),
        title: "新会话".to_string(),
        status: "ready".to_string(),
        runtime_session: conversation.runtime_session.clone(),
        created_at: conversation.created_at.clone(),
        updated_at: conversation.updated_at.clone(),
    }
}

fn sanitize_attachment_name(name: &str) -> Result<String, ConversationError> {
    let file_name = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ConversationError::InvalidMessage)?;
    if file_name == "." || file_name == ".." || file_name.contains('/') || file_name.contains('\\')
    {
        return Err(ConversationError::InvalidMessage);
    }
    Ok(file_name.to_string())
}

fn append_attachment_context(body: &str, attachments: &[ConversationAttachmentView]) -> String {
    if attachments.is_empty() {
        return body.to_string();
    }
    let mut prompt = body.to_string();
    prompt.push_str("\n\nAttachments:");
    for attachment in attachments {
        prompt.push_str(&format!(
            "\n- {} ({}, {} bytes) {}",
            attachment.name,
            attachment.mime_type,
            attachment.size,
            attachment.cache_path.clone().unwrap_or_default()
        ));
    }
    prompt
}

fn decode_base64(input: &str) -> Result<Vec<u8>, ()> {
    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u8;
    for byte in input.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(()),
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Ok(output)
}

fn persist_local_conversation_messages_at_root(
    root: &str,
    conversation_id: &str,
    messages: &[ConversationMessageView],
) -> Result<(), ConversationError> {
    let _ = (root, conversation_id, messages);
    Ok(())
}

fn complete_local_message_card(
    data_root: &str,
    card_id: &str,
) -> Result<Option<InteractiveCardView>, ConversationError> {
    let _ = (data_root, card_id);
    Ok(None)
}

fn run_local_agent_dm_background(
    conversations: Arc<Mutex<Vec<ConversationView>>>,
    conversation_messages: Arc<Mutex<Vec<ConversationMessageView>>>,
    conversation_id: String,
    run_id: String,
    agent: Option<DesktopAgentView>,
    prompt: String,
    runtime_session: RuntimeSessionView,
    workspace_mounts: Vec<WorkspaceMountView>,
    source_channel_id: Option<String>,
    source_channel_name: Option<String>,
) {
    let started = Instant::now();
    match agent {
        Some(agent) => {
            eprintln!(
                "[slei-runtime] start run_id={} agent_id={} cwd={}",
                run_id, agent.id, agent.workspace_path
            );
            complete_local_agent_run(
                &conversations,
                &conversation_messages,
                &conversation_id,
                &run_id,
                run_local_claude_agent(
                    &agent,
                    &run_id,
                    &prompt,
                    &runtime_session,
                    &workspace_mounts,
                    source_channel_id.as_deref(),
                    source_channel_name.as_deref(),
                    |body| {
                        update_local_agent_run_body(
                            &conversation_messages,
                            &conversation_id,
                            &run_id,
                            body,
                        );
                    },
                ),
                started,
            );
        }
        None => {
            eprintln!(
                "[slei-runtime] failed run_id={} error=agent_not_found",
                run_id
            );
            complete_local_agent_run(
                &conversations,
                &conversation_messages,
                &conversation_id,
                &run_id,
                Err("agent not found".to_string()),
                started,
            );
        }
    }
}

fn complete_local_agent_run(
    conversations: &Arc<Mutex<Vec<ConversationView>>>,
    conversation_messages: &Arc<Mutex<Vec<ConversationMessageView>>>,
    conversation_id: &str,
    run_id: &str,
    result: Result<LocalAgentRunOutput, String>,
    started: Instant,
) {
    let mut messages = conversation_messages
        .lock()
        .expect("conversation messages mutex poisoned");
    let Some(reply_index) = messages
        .iter()
        .position(|candidate| candidate.run_id.as_deref() == Some(run_id))
    else {
        eprintln!(
            "[slei-runtime] failed run_id={} error=run_message_not_found",
            run_id
        );
        return;
    };
    let mut card_messages = Vec::new();
    match result {
        Ok(output) => {
            let reply_session_id = messages[reply_index].session_id.clone();
            let reply_author_id = messages[reply_index].author_id.clone();
            messages[reply_index].body = output.body;
            messages[reply_index].status = Some("done".to_string());
            for card in output.cards {
                card_messages.push(ConversationMessageView {
                    id: format!("card_message_{}", card.id),
                    sequence: None,
                    conversation_id: conversation_id.to_string(),
                    session_id: reply_session_id.clone(),
                    author_id: reply_author_id.clone(),
                    body: String::new(),
                    attachments: None,
                    cards: Some(vec![card]),
                    thread: None,
                    run_id: None,
                    status: Some("done".to_string()),
                    created_at: monotonic_id(),
                });
            }
            mark_local_runtime_session_ready(conversations, conversation_id);
            eprintln!(
                "[slei-runtime] completed run_id={} elapsed_ms={}",
                run_id,
                started.elapsed().as_millis()
            );
        }
        Err(error) => {
            messages[reply_index].body = error.clone();
            messages[reply_index].status = Some("failed".to_string());
            eprintln!(
                "[slei-runtime] failed run_id={} elapsed_ms={} error={}",
                run_id,
                started.elapsed().as_millis(),
                error
            );
        }
    };
    messages.extend(card_messages);
}

fn update_local_agent_run_body(
    conversation_messages: &Arc<Mutex<Vec<ConversationMessageView>>>,
    conversation_id: &str,
    run_id: &str,
    body: &str,
) {
    let mut messages = conversation_messages
        .lock()
        .expect("conversation messages mutex poisoned");
    let Some(reply) = messages.iter_mut().find(|candidate| {
        candidate.conversation_id == conversation_id && candidate.run_id.as_deref() == Some(run_id)
    }) else {
        eprintln!(
            "[slei-runtime] stream_update_missed run_id={} error=run_message_not_found",
            run_id
        );
        return;
    };
    reply.body = body.to_string();
    reply.status = Some("running".to_string());
    eprintln!(
        "[slei-runtime] stream_update run_id={} body_chars={}",
        run_id,
        body.chars().count()
    );
}

fn mark_local_runtime_session_ready(
    conversations: &Arc<Mutex<Vec<ConversationView>>>,
    conversation_id: &str,
) {
    let mut conversations = conversations.lock().expect("conversations mutex poisoned");
    let Some(conversation) = conversations
        .iter_mut()
        .find(|conversation| conversation.id == conversation_id)
    else {
        return;
    };
    if let Some(session) = conversation.runtime_session.as_mut() {
        session.status = "ready".to_string();
        session.updated_at = monotonic_id();
    }
}

fn run_local_claude_agent(
    agent: &DesktopAgentView,
    run_id: &str,
    prompt: &str,
    runtime_session: &RuntimeSessionView,
    workspace_mounts: &[WorkspaceMountView],
    source_channel_id: Option<&str>,
    source_channel_name: Option<&str>,
    on_output: impl FnMut(&str),
) -> Result<LocalAgentRunOutput, String> {
    run_local_claude_agent_impl(
        agent,
        run_id,
        prompt,
        runtime_session,
        workspace_mounts,
        source_channel_id,
        source_channel_name,
        on_output,
    )
}

fn run_local_claude_clear_session(
    agent: &DesktopAgentView,
    runtime_session: &RuntimeSessionView,
) -> Result<(), String> {
    run_local_claude_clear_session_impl(agent, runtime_session)
}

#[cfg(test)]
fn run_local_claude_clear_session_impl(
    _agent: &DesktopAgentView,
    _runtime_session: &RuntimeSessionView,
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
fn run_local_claude_agent_impl(
    _agent: &DesktopAgentView,
    _run_id: &str,
    _prompt: &str,
    _runtime_session: &RuntimeSessionView,
    _workspace_mounts: &[WorkspaceMountView],
    _source_channel_id: Option<&str>,
    _source_channel_name: Option<&str>,
    mut on_output: impl FnMut(&str),
) -> Result<LocalAgentRunOutput, String> {
    if _prompt.contains("__slei_streaming_runtime__") {
        on_output("chunk 1");
        std::thread::sleep(Duration::from_millis(120));
        on_output("chunk 1 chunk 2");
        return Ok(LocalAgentRunOutput {
            body: "chunk 1 chunk 2".to_string(),
            cards: Vec::new(),
        });
    }
    if _prompt.contains("__slei_delay_runtime__") {
        std::thread::sleep(Duration::from_millis(250));
    }
    if _prompt.contains("__slei_product_tool_create_bob__") {
        return Ok(LocalAgentRunOutput {
            body: "准备创建 Bob。".to_string(),
            cards: vec![InteractiveCardView {
                id: "card_test_bob".to_string(),
                kind: "createAgent".to_string(),
                state: "pending".to_string(),
                title: "创建 Bob".to_string(),
                summary: "Bob · ClaudeCode / Sonnet".to_string(),
                draft: serde_json::json!({
                    "name": "Bob",
                    "handle": "@bob",
                    "runtimeKind": "ClaudeCode",
                    "model": "Sonnet",
                    "nodeId": "local-node",
                    "description": "架构工程师"
                }),
                action_label: "创建".to_string(),
                done_label: "DONE".to_string(),
            }],
        });
    }
    Ok(LocalAgentRunOutput::default())
}

#[cfg(not(test))]
fn run_local_claude_clear_session_impl(
    agent: &DesktopAgentView,
    runtime_session: &RuntimeSessionView,
) -> Result<(), String> {
    let mut command = Command::new("claude");
    command
        .arg("-p")
        .arg("/clear")
        .arg("--output-format")
        .arg("text")
        .arg("--resume")
        .arg(&runtime_session.session_id);
    let output = command
        .current_dir(&agent.workspace_path)
        .output()
        .map_err(|error| format!("failed to clear ClaudeCode session: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("ClaudeCode clear exited with status {}", output.status)
        } else {
            stderr
        })
    }
}

#[cfg(not(test))]
fn run_local_claude_agent_impl(
    agent: &DesktopAgentView,
    run_id: &str,
    prompt: &str,
    runtime_session: &RuntimeSessionView,
    workspace_mounts: &[WorkspaceMountView],
    source_channel_id: Option<&str>,
    source_channel_name: Option<&str>,
    mut on_output: impl FnMut(&str),
) -> Result<LocalAgentRunOutput, String> {
    use std::io::BufRead as _;

    eprintln!(
        "[slei-runtime] spawn claude-agent-sdk cwd={} prompt_chars={}",
        agent.workspace_path,
        prompt.chars().count()
    );
    let runner_path = local_claude_agent_runner_path()?;
    let command_payload = local_claude_agent_runner_payload(
        agent,
        run_id,
        prompt,
        runtime_session,
        workspace_mounts,
        source_channel_id,
        source_channel_name,
    )?;
    let mut command = Command::new("node");
    command.arg(runner_path);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    let mut child = command
        .current_dir(&agent.workspace_path)
        .spawn()
        .map_err(|error| format!("failed to start Claude Agent SDK runner: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(command_payload.as_bytes())
            .map_err(|error| format!("failed to write Claude Agent SDK runner input: {error}"))?;
    }
    drop(child.stdin.take());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Claude Agent SDK runner stdout was not captured".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Claude Agent SDK runner stderr was not captured".to_string())?;
    let stderr_handle = thread::spawn(move || {
        let mut stderr_text = String::new();
        let _ = std::io::BufReader::new(stderr).read_to_string(&mut stderr_text);
        stderr_text
    });

    let mut output = LocalAgentRunOutput::default();
    let mut failed = None;
    for line in std::io::BufReader::new(stdout).lines() {
        let line =
            line.map_err(|error| format!("failed to read Claude Agent SDK runner event: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let event: LocalWorkerEvent = serde_json::from_str(&line)
            .map_err(|error| format!("invalid Claude Agent SDK runner event: {error}"))?;
        match event.event_type.as_str() {
            "output_delta" => {
                output.body.push_str(&event.delta);
                on_output(&output.body);
            }
            "product_tool_requested" if event.tool_name == "slei_propose_interactive_card" => {
                output
                    .cards
                    .push(local_card_from_product_tool_event(&event)?);
            }
            "failed" => {
                failed = Some(event.message);
                break;
            }
            "completed"
            | "tool_started"
            | "tool_completed"
            | "permission_requested"
            | "human_question_requested" => {}
            _ => {}
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("failed to wait for Claude Agent SDK runner: {error}"))?;
    let stderr = stderr_handle.join().unwrap_or_default().trim().to_string();

    if let Some(error) = failed {
        return Err(error);
    }

    if !status.success() {
        return Err(if stderr.is_empty() {
            format!("Claude Agent SDK runner exited with status {}", status)
        } else {
            stderr
        });
    }

    Ok(output)
}

#[derive(Clone, Debug, Default)]
struct LocalAgentRunOutput {
    body: String,
    cards: Vec<InteractiveCardView>,
}

#[derive(Debug, Deserialize)]
#[cfg(not(test))]
struct LocalWorkerEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    delta: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    tool_use_id: String,
    #[serde(default)]
    tool_name: String,
    #[serde(default)]
    payload: serde_json::Value,
    #[serde(default)]
    run_id: String,
}

#[cfg(not(test))]
fn local_claude_agent_runner_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("SLEI_CLAUDE_AGENT_RUNNER") {
        return Ok(PathBuf::from(path));
    }
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or_else(|| "failed to resolve Slei repository root".to_string())?;
    let path = repo_root.join("workers/claude-agent/dist/local-runner.js");
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!(
            "Claude Agent SDK runner is missing at {}. Run `pnpm --filter @slei/claude-agent build`.",
            path.display()
        ))
    }
}

#[cfg(not(test))]
fn local_claude_agent_runner_payload(
    agent: &DesktopAgentView,
    run_id: &str,
    prompt: &str,
    runtime_session: &RuntimeSessionView,
    workspace_mounts: &[WorkspaceMountView],
    source_channel_id: Option<&str>,
    source_channel_name: Option<&str>,
) -> Result<String, String> {
    let primary_project_path = workspace_mounts.first().map(|mount| mount.path.clone());
    serde_json::to_string(&serde_json::json!({
        "type": "start_run",
        "run_id": run_id,
        "session": {
            "session_id": runtime_session.session_id,
            "agent_id": agent.id,
            "runtime": "ClaudeCode",
            "cwd": agent.workspace_path,
            "agent_workspace_path": agent.workspace_path,
            "additional_directories": [agent.workspace_path],
            "workspace_mounts": workspace_mounts,
            "primary_project_path": primary_project_path,
            "channel_id": source_channel_id,
            "channel_name": source_channel_name,
            "model": agent.model,
            "persist_session": true,
            "resume_session": runtime_session.status == "ready",
        },
        "input": {
            "prompt": prompt,
            "context": [],
        }
    }))
    .map_err(|error| format!("failed to serialize Claude Agent SDK runner payload: {error}"))
}

#[cfg(not(test))]
fn local_card_from_product_tool_event(
    event: &LocalWorkerEvent,
) -> Result<InteractiveCardView, String> {
    let payload = event
        .payload
        .as_object()
        .ok_or_else(|| "slei_propose_interactive_card payload must be an object".to_string())?;
    let kind = required_payload_string(payload, "kind")?;
    if kind != "createAgent" {
        return Err("local Slei interactive cards only support createAgent".to_string());
    }
    Ok(InteractiveCardView {
        id: format!(
            "card_{}_{}",
            safe_conversation_id(&event.run_id),
            safe_conversation_id(&event.tool_use_id)
        ),
        kind,
        state: "pending".to_string(),
        title: required_payload_string(payload, "title")?,
        summary: required_payload_string(payload, "summary")?,
        draft: payload
            .get("draft")
            .cloned()
            .ok_or_else(|| "slei_propose_interactive_card missing draft".to_string())?,
        action_label: required_payload_string(payload, "actionLabel")?,
        done_label: required_payload_string(payload, "doneLabel")?,
    })
}

#[cfg(not(test))]
fn required_payload_string(
    payload: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<String, String> {
    payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("slei_propose_interactive_card missing {key}"))
}

fn safe_conversation_id(conversation_id: &str) -> String {
    conversation_id.replace([':', '/'], "_")
}

#[derive(Debug, thiserror::Error)]
pub enum ArtifactOpenError {
    #[error("artifact id is required")]
    ArtifactIdRequired,
}

#[derive(Debug, thiserror::Error)]
pub enum NodeNameError {
    #[error("daemon unavailable")]
    DaemonUnavailable,
    #[error("node name is required")]
    NameRequired,
    #[error("node name must be 64 characters or fewer")]
    NameTooLong,
}

#[derive(Debug, thiserror::Error)]
pub enum PreferencesError {
    #[error("daemon unavailable")]
    DaemonUnavailable,
    #[error("locale must be zh-CN or en-US")]
    InvalidLocale,
    #[error("time zone is invalid")]
    InvalidTimeZone,
    #[error("appearance preference is invalid")]
    InvalidAppearance,
    #[error("preferences io error: {0}")]
    Io(std::io::Error),
    #[error("preferences json error: {0}")]
    Json(serde_json::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum ProfileError {
    #[error("daemon unavailable")]
    DaemonUnavailable,
    #[error("{0}")]
    DaemonRequest(String),
    #[error("daemon response invalid: {0}")]
    DaemonResponse(String),
}

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("daemon unavailable")]
    DaemonUnavailable,
    #[error("{0}")]
    DaemonRequest(String),
    #[error("daemon response error: {0}")]
    DaemonResponse(String),
    #[error("agent not found")]
    AgentNotFound,
    #[error("agent name, runtime, and node are required")]
    InvalidAgent,
    #[error("agent handle is invalid")]
    InvalidHandle,
    #[error("agent handle already exists")]
    DuplicateHandle,
    #[error("memory fact is required")]
    InvalidMemory,
    #[error("agent path is outside workspace")]
    WorkspaceBoundary,
    #[error("system agents cannot be deleted")]
    SystemAgentImmutable,
    #[error("agent workspace io error: {0}")]
    Io(std::io::Error),
    #[error("agent workspace json error: {0}")]
    Json(serde_json::Error),
}

fn message_page_path(base: &str, query: Option<&MessagePageQuery>) -> String {
    let Some(query) = query else {
        return base.to_string();
    };
    let mut params = Vec::new();
    if let Some(before) = query.before {
        params.push(format!("before={before}"));
    }
    if let Some(around_message_id) = query.around_message_id.as_deref() {
        if !around_message_id.trim().is_empty() {
            params.push(format!("aroundMessageId={around_message_id}"));
        }
    }
    if let Some(limit) = query.limit {
        params.push(format!("limit={limit}"));
    }
    if params.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{}", params.join("&"))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AgentPathError {
    #[error("agent not found")]
    AgentNotFound,
    #[error("agent path target is invalid")]
    InvalidTarget,
    #[error("agent path is outside workspace")]
    WorkspaceBoundary,
    #[error("system open failed")]
    OpenFailed,
    #[error("agent path io error: {0}")]
    Io(std::io::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("invalid channel")]
    InvalidChannel,
    #[error("daemon request failed: {0}")]
    DaemonRequest(String),
    #[error("daemon response invalid: {0}")]
    DaemonResponse(String),
}

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("task not found")]
    TaskNotFound,
    #[error("invalid task")]
    InvalidTask,
    #[error("daemon request failed: {0}")]
    DaemonRequest(String),
    #[error("daemon response invalid: {0}")]
    DaemonResponse(String),
}

#[derive(Debug, thiserror::Error)]
pub enum CardError {
    #[error("card not found")]
    CardNotFound,
    #[error(transparent)]
    Conversation(#[from] ConversationError),
}

#[derive(Debug, thiserror::Error)]
pub enum ConversationError {
    #[error("daemon unavailable")]
    DaemonUnavailable,
    #[error("agent not found")]
    AgentNotFound,
    #[error("conversation not found")]
    ConversationNotFound,
    #[error("invalid conversation")]
    InvalidConversation,
    #[error("invalid message")]
    InvalidMessage,
    #[error("conversation runtime clear failed: {0}")]
    RuntimeClearFailed(String),
    #[error("conversation io error: {0}")]
    Io(std::io::Error),
    #[error("conversation json error: {0}")]
    Json(serde_json::Error),
}

#[cfg(test)]
mod system_preference_tests {
    use super::{is_supported_time_zone, locale_from_env};

    #[test]
    fn locale_from_env_matches_supported_app_locales() {
        assert_eq!(locale_from_env(Some("en_US.UTF-8"), None, None), "en-US");
        assert_eq!(locale_from_env(None, Some("zh_CN.UTF-8"), None), "zh-CN");
        assert_eq!(locale_from_env(None, None, Some("en_GB.UTF-8")), "en-US");
        assert_eq!(locale_from_env(None, None, Some("fr_FR.UTF-8")), "zh-CN");
    }

    #[test]
    fn system_time_zone_validator_accepts_iana_names() {
        assert!(is_supported_time_zone("Asia/Shanghai"));
        assert!(is_supported_time_zone("America/Los_Angeles"));
        assert!(!is_supported_time_zone("UTC"));
        assert!(!is_supported_time_zone("../Asia/Shanghai"));
    }
}

#[cfg(test)]
mod conversation_daemon_routing_tests {
    use super::*;

    #[test]
    fn empty_fallback_human_dm_sends_to_daemon_before_local_runtime() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind test daemon");
        listener.set_nonblocking(true).expect("set nonblocking");
        let endpoint = format!("http://{}", listener.local_addr().expect("local addr"));
        let server = std::thread::spawn(move || {
            let started = Instant::now();
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buffer = [0_u8; 2048];
                        let count = stream.read(&mut buffer).expect("read request");
                        let request = String::from_utf8_lossy(&buffer[..count]).to_string();
                        let body = serde_json::json!({
                            "message": {
                                "id": "msg_daemon",
                                "sequence": 1,
                                "conversationId": "dm:agent_guide",
                                "sessionId": "session:dm:agent_guide:default",
                                "authorId": "human:local",
                                "body": "hello",
                                "createdAt": "2026-06-22T12:00:00.000Z"
                            }
                        })
                        .to_string();
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        stream
                            .write_all(response.as_bytes())
                            .expect("write response");
                        return request;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if started.elapsed() > Duration::from_millis(500) {
                            return "NO_REQUEST".to_string();
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => return format!("ACCEPT_ERROR: {error}"),
                }
            }
        });

        let broker = DaemonBroker::for_tests_empty_fallback(RuntimeDescriptor {
            endpoint,
            event_socket: "ws://127.0.0.1:0/v1/events/ws".to_string(),
            token: "desktop-session-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });
        broker
            .conversations
            .lock()
            .expect("conversations")
            .push(ConversationView {
                id: "dm:agent_guide".to_string(),
                kind: "dm".to_string(),
                agent_id: "agent_guide".to_string(),
                active_session_id: Some("session:dm:agent_guide:default".to_string()),
                runtime_session: None,
                created_at: "2026-06-22T12:00:00.000Z".to_string(),
                updated_at: "2026-06-22T12:00:00.000Z".to_string(),
            });

        let result = broker.send_conversation_message(
            "dm:agent_guide",
            ConversationMessageRequest {
                author_id: "human:local".to_string(),
                body: "hello".to_string(),
                session_id: Some("session:dm:agent_guide:default".to_string()),
                attachment_ids: Vec::new(),
                workspace_mounts: Vec::new(),
                source_channel_id: None,
                source_channel_name: None,
            },
        );
        let request = server.join().expect("server thread");

        assert_ne!(
            request, "NO_REQUEST",
            "DM send skipped the reachable daemon"
        );
        assert!(request.starts_with("POST /v1/conversations/dm:agent_guide/messages "));
        assert_eq!(result.expect("daemon send").message.id, "msg_daemon");
    }
}
