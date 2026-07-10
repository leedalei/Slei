use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Component, Path as FsPath, PathBuf};

use crate::services::channel_service::ChannelMemberReadiness;
use crate::services::member_service::{
    MemberError, ProductAgentDraft, ProductAgentRecord, ProductAgentUpdate,
};
use crate::state::AppState;

pub async fn list_agents(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    Json(json!({ "agents": state.members().list_product_agents().await })).into_response()
}

pub async fn create_agent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ProductAgentDraft>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
    else {
        return error_response(StatusCode::BAD_REQUEST, "missing idempotency key");
    };

    if !node_runtime_exists(&state, &payload.node_id, &payload.runtime_kind) {
        return error_response(StatusCode::BAD_REQUEST, "node or runtime not available");
    }

    match state
        .members()
        .create_product_agent(payload, idempotency_key)
        .await
    {
        Ok(agent) => {
            if let Err(error) = state
                .channels()
                .ensure_default_agent_membership(&agent.id)
                .await
            {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
            if let Err(error) = state
                .memory_maintainer()
                .sync_added_channel_member("all", &agent.id)
                .await
            {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
            if let Err(error) = state
                .channel_orchestrator()
                .start_channel_agent_join_report("all", &agent.id)
                .await
            {
                eprintln!(
                    "slei channel join report failed to start: channel_id=all agent_id={} error={error}",
                    agent.id
                );
            }
            (StatusCode::CREATED, Json(json!({ "agent": agent }))).into_response()
        }
        Err(MemberError::DuplicateHandle) => {
            error_response(StatusCode::CONFLICT, "duplicate handle")
        }
        Err(MemberError::DuplicateName) => error_response(StatusCode::CONFLICT, "duplicate name"),
        Err(error) => member_error_response(error),
    }
}

pub async fn bootstrap_guide(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    if !has_ready_claude_runtime(&state, "local-node") {
        return (
            StatusCode::ACCEPTED,
            Json(json!({ "status": "runtimeUnavailable" })),
        )
            .into_response();
    }

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("bootstrap-guide");

    match state
        .members()
        .create_guide_agent("local-node", idempotency_key)
        .await
    {
        Ok((agent, created)) => {
            let membership = match state
                .channels()
                .add_agent_to_channel_with_outcome("all", &agent.id)
                .await
            {
                Ok(outcome) => outcome,
                Err(error) => {
                    return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
                }
            };
            if matches!(
                membership.member.readiness,
                ChannelMemberReadiness::Joining | ChannelMemberReadiness::MemorySyncing
            ) {
                if let Err(error) = state
                    .memory_maintainer()
                    .sync_added_channel_member("all", &agent.id)
                    .await
                {
                    return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
                }
                if let Err(error) = state
                    .channel_orchestrator()
                    .start_channel_agent_join_report("all", &agent.id)
                    .await
                {
                    eprintln!(
                        "slei guide join report failed to start: agent_id={} error={error}",
                        agent.id
                    );
                }
            }
            let (conversation, _) = match state.conversations().create_dm(&agent.id).await {
                Ok(receipt) => receipt,
                Err(error) => {
                    return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
                }
            };
            let _ = state
                .conversations()
                .append_message(
                    &conversation.id,
                    &agent.id,
                    "Yeal 已准备好，可以帮助你创建成员、频道并了解 Slei 的使用方式。",
                    Some("guide-welcome"),
                )
                .await;
            (
                if created {
                    StatusCode::CREATED
                } else {
                    StatusCode::OK
                },
                Json(json!({
                    "status": if created { "created" } else { "alreadyExists" },
                    "agent": agent,
                    "conversation": conversation,
                })),
            )
                .into_response()
        }
        Err(MemberError::DuplicateHandle) => {
            error_response(StatusCode::CONFLICT, "reserved guide handle already exists")
        }
        Err(error) => member_error_response(error),
    }
}

pub async fn update_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<ProductAgentUpdate>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    if let Some(node_id) = payload.node_id.as_deref() {
        if state.nodes().get_node(node_id).is_none() {
            return error_response(StatusCode::BAD_REQUEST, "node not available");
        }
    }
    if let Some(runtime_kind) = payload.runtime_kind.as_deref() {
        let node_id = payload.node_id.as_deref().unwrap_or("local-node");
        if !node_runtime_exists(&state, node_id, runtime_kind) {
            return error_response(StatusCode::BAD_REQUEST, "runtime not available");
        }
    }

    match state.members().update_product_agent(&id, payload).await {
        Ok(agent) => Json(json!({ "agent": agent })).into_response(),
        Err(error) => member_error_response(error),
    }
}

pub async fn delete_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.members().delete_product_agent(&id).await {
        Ok(agent) => {
            if let Err(error) = state.channels().remove_agent_from_all_channels(&id).await {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
            Json(json!({ "agent": agent })).into_response()
        }
        Err(error) => member_error_response(error),
    }
}

pub async fn list_skills(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.members().list_agent_skills(&id).await {
        Ok(skills) => Json(json!({ "skills": skills })).into_response(),
        Err(error) => member_error_response(error),
    }
}

#[derive(Debug, Deserialize)]
pub struct AgentWorkspaceQuery {
    #[serde(rename = "relativePath")]
    relative_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentWorkspaceEntryView {
    kind: String,
    name: String,
    relative_path: String,
}

pub async fn resolve_agent_path(
    State(state): State<AppState>,
    Path((id, target)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.members().get_product_agent(&id).await {
        Ok(agent) => match resolve_agent_target_path(&agent, &target) {
            Ok(path) => Json(json!({
                "agentId": id,
                "target": target,
                "path": path.to_string_lossy(),
            }))
            .into_response(),
            Err(error) => member_error_response(error),
        },
        Err(error) => member_error_response(error),
    }
}

pub async fn list_agent_workspace(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<AgentWorkspaceQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.members().get_product_agent(&id).await {
        Ok(agent) => {
            let relative_path = query.relative_path.unwrap_or_default();
            match list_agent_workspace_entries(&agent, &relative_path) {
                Ok(entries) => Json(json!({
                    "agentId": id,
                    "relativePath": normalize_relative_output(&relative_path),
                    "entries": entries,
                }))
                .into_response(),
                Err(error) => member_error_response(error),
            }
        }
        Err(error) => member_error_response(error),
    }
}

pub async fn read_agent_workspace_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<AgentWorkspaceQuery>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.members().get_product_agent(&id).await {
        Ok(agent) => {
            let relative_path = query.relative_path.unwrap_or_default();
            match read_agent_workspace_file_content(&agent, &relative_path) {
                Ok((path, content)) => Json(json!({
                    "agentId": id,
                    "name": path.file_name().and_then(|name| name.to_str()).unwrap_or_default(),
                    "relativePath": normalize_relative_output(&relative_path),
                    "content": content,
                }))
                .into_response(),
                Err(error) => member_error_response(error),
            }
        }
        Err(error) => member_error_response(error),
    }
}

#[derive(Debug, Deserialize)]
pub struct RememberFactRequest {
    fact: String,
}

pub async fn remember_agent_fact(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<RememberFactRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state
        .members()
        .remember_agent_fact(&id, &payload.fact)
        .await
    {
        Ok(agent) => Json(json!({ "agent": agent })).into_response(),
        Err(error) => member_error_response(error),
    }
}

fn node_runtime_exists(state: &AppState, node_id: &str, runtime_kind: &str) -> bool {
    state.nodes().get_node(node_id).is_some_and(|node| {
        node.runtimes
            .iter()
            .any(|runtime| runtime.kind == runtime_kind)
    })
}

fn has_ready_claude_runtime(state: &AppState, node_id: &str) -> bool {
    state.nodes().get_node(node_id).is_some_and(|node| {
        node.runtimes
            .iter()
            .any(|runtime| runtime.kind == "ClaudeCode" && runtime.readiness == "ready")
    })
}

fn resolve_agent_target_path(
    agent: &ProductAgentRecord,
    target: &str,
) -> Result<PathBuf, MemberError> {
    let raw_path = match target {
        "workspace" => &agent.workspace_path,
        "memory" => &agent.memory_path,
        "docs" => &agent.docs_path,
        _ => return Err(MemberError::InvalidAgent),
    };
    resolve_workspace_path(agent, raw_path)
}

fn list_agent_workspace_entries(
    agent: &ProductAgentRecord,
    relative_path: &str,
) -> Result<Vec<AgentWorkspaceEntryView>, MemberError> {
    let directory = resolve_workspace_relative_path(agent, relative_path)?;
    if !directory.is_dir() {
        return Err(MemberError::InvalidAgent);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(directory).map_err(MemberError::Io)? {
        let entry = entry.map_err(MemberError::Io)?;
        let file_type = entry.file_type().map_err(MemberError::Io)?;
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_relative_path = join_relative_path(relative_path, &name);
        entries.push(AgentWorkspaceEntryView {
            kind: if file_type.is_dir() {
                "directory"
            } else {
                "file"
            }
            .to_string(),
            name,
            relative_path: entry_relative_path,
        });
    }
    entries.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(entries)
}

fn read_agent_workspace_file_content(
    agent: &ProductAgentRecord,
    relative_path: &str,
) -> Result<(PathBuf, String), MemberError> {
    let path = resolve_workspace_relative_path(agent, relative_path)?;
    if !path.is_file() {
        return Err(MemberError::InvalidAgent);
    }
    let content = fs::read_to_string(&path).map_err(MemberError::Io)?;
    Ok((path, content))
}

fn resolve_workspace_relative_path(
    agent: &ProductAgentRecord,
    relative_path: &str,
) -> Result<PathBuf, MemberError> {
    let normalized = normalize_relative_output(relative_path);
    if !is_safe_relative_path(&normalized) {
        return Err(MemberError::WorkspaceBoundary);
    }
    let workspace = PathBuf::from(&agent.workspace_path);
    let target = if normalized.is_empty() {
        workspace
    } else {
        workspace.join(&normalized)
    };
    resolve_workspace_path(agent, target)
}

fn resolve_workspace_path(
    agent: &ProductAgentRecord,
    raw_path: impl AsRef<FsPath>,
) -> Result<PathBuf, MemberError> {
    let workspace = fs::canonicalize(&agent.workspace_path).map_err(MemberError::Io)?;
    let target = fs::canonicalize(raw_path).map_err(MemberError::Io)?;
    if !target.starts_with(&workspace) {
        return Err(MemberError::WorkspaceBoundary);
    }
    Ok(target)
}

fn normalize_relative_output(relative_path: &str) -> String {
    relative_path.trim().trim_matches('/').to_string()
}

fn join_relative_path(parent: &str, name: &str) -> String {
    let parent = normalize_relative_output(parent);
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn is_safe_relative_path(relative_path: &str) -> bool {
    !FsPath::new(relative_path).components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

fn member_error_response(error: MemberError) -> Response {
    match error {
        MemberError::AgentNotFound => error_response(StatusCode::NOT_FOUND, &error.to_string()),
        MemberError::DuplicateHandle => error_response(StatusCode::CONFLICT, &error.to_string()),
        MemberError::DuplicateName => error_response(StatusCode::CONFLICT, &error.to_string()),
        MemberError::MissingIdempotencyKey
        | MemberError::InvalidAgent
        | MemberError::InvalidHandle
        | MemberError::InvalidMemory
        | MemberError::WorkspaceBoundary
        | MemberError::SystemAgentImmutable => {
            error_response(StatusCode::BAD_REQUEST, &error.to_string())
        }
        MemberError::Io(_) | MemberError::Json(_) => {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
    }
}

fn error_response(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({ "error": error }))).into_response()
}
