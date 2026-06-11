use std::collections::HashSet;
use std::path::Path as FsPath;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::services::channel_service::{
    normalize_workspace_path, ChannelDraft, ChannelError, PermissionPreset, WorkspaceMount,
};
use crate::services::member_service::is_internal_coordinator_id;
use crate::state::AppState;

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(json!({ "channels": state.channels().list_channels().await })).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelRequest {
    name: String,
    description: Option<String>,
    agent_ids: Option<Vec<String>>,
    #[serde(default)]
    project_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddChannelMemberRequest {
    agent_id: String,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateChannelRequest>,
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
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "idempotency-key is required" })),
        )
            .into_response();
    };

    let idempotency_key = idempotency_key.to_string();
    let agent_ids = dedupe_agent_ids(payload.agent_ids.unwrap_or_default());
    let project_paths = dedupe_project_paths(payload.project_paths);
    if let Some(channel) = state
        .channels()
        .channel_for_idempotency_key(&idempotency_key)
        .await
    {
        channel_create_log(
            &idempotency_key,
            "idempotent-replay",
            &format!("channel_id={}", channel.id),
        );
        return (StatusCode::CREATED, Json(json!({ "channel": channel }))).into_response();
    }
    channel_create_log(
        &idempotency_key,
        "validate-agents",
        &format!(
            "agent_count={} project_path_count={}",
            agent_ids.len(),
            project_paths.len()
        ),
    );
    for agent_id in &agent_ids {
        if let Err(error) = state.members().get_product_agent(agent_id).await {
            channel_create_log(
                &idempotency_key,
                "validate-agents-failed",
                &format!("agent_id={agent_id} error={error}"),
            );
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
    }
    if let Err(error) = state
        .channels()
        .ensure_workspace_paths_available(&project_paths)
        .await
    {
        channel_create_log(
            &idempotency_key,
            "validate-workspaces-failed",
            &format!("error={error}"),
        );
        return channel_error_response(error);
    }

    match state
        .channels()
        .create_channel(
            ChannelDraft {
                name: payload.name,
                description: payload.description,
                permission: PermissionPreset::Controlled,
            },
            &idempotency_key,
        )
        .await
    {
        Ok(channel) => {
            channel_create_log(
                &idempotency_key,
                "channel-created",
                &format!("channel_id={}", channel.id),
            );
            let setup_state = state.clone();
            let setup_channel = channel.clone();
            tokio::spawn(async move {
                run_channel_setup(
                    setup_state,
                    setup_channel,
                    agent_ids,
                    project_paths,
                    idempotency_key,
                )
                .await;
            });
            (StatusCode::CREATED, Json(json!({ "channel": channel }))).into_response()
        }
        Err(error) => channel_error_response(error),
    }
}

async fn run_channel_setup(
    state: AppState,
    channel: crate::services::channel_service::ChannelRecord,
    agent_ids: Vec<String>,
    project_paths: Vec<String>,
    idempotency_key: String,
) {
    let _activity_guard = match state.reset().runtime().begin_launch().await {
        Ok(guard) => guard,
        Err(_) => return,
    };

    channel_create_log(
        &idempotency_key,
        "setup-start",
        &format!("channel_id={}", channel.id),
    );
    match state
        .members()
        .ensure_global_coordinator_agent("local-node")
        .await
    {
        Ok(coordinator) => {
            channel_create_log(
                &idempotency_key,
                "coordinator-ready",
                &format!("coordinator_id={}", coordinator.id),
            );
        }
        Err(error) => channel_create_log(
            &idempotency_key,
            "coordinator-failed",
            &format!("channel_id={} error={error}", channel.id),
        ),
    }

    for project_path in project_paths {
        match state
            .channels()
            .mount_workspace(
                &channel.id,
                WorkspaceMount {
                    label: workspace_label(&project_path),
                    path: project_path.clone(),
                },
                &format!("channel:{}:workspace:{}", channel.id, project_path),
            )
            .await
        {
            Ok(_) => channel_create_log(
                &idempotency_key,
                "workspace-mounted",
                &format!("channel_id={}", channel.id),
            ),
            Err(error) => channel_create_log(
                &idempotency_key,
                "workspace-mounted-failed",
                &format!(
                    "channel_id={} path={project_path} error={error}",
                    channel.id
                ),
            ),
        }
    }

    let should_run_memory_updates = !agent_ids.is_empty();
    for agent_id in agent_ids {
        match state
            .channels()
            .add_agent_to_channel_with_outcome(&channel.id, &agent_id)
            .await
        {
            Ok(outcome) => {
                channel_create_log(
                    &idempotency_key,
                    "agent-joined",
                    &format!("channel_id={} agent_id={agent_id}", channel.id),
                );
                if outcome.created {
                    state
                        .memory_events()
                        .request_channel_join_update(&agent_id, &channel.id)
                        .await;
                    channel_create_log(
                        &idempotency_key,
                        "memory-requested",
                        &format!("channel_id={} agent_id={agent_id}", channel.id),
                    );
                }
            }
            Err(error) => channel_create_log(
                &idempotency_key,
                "agent-joined-failed",
                &format!(
                    "channel_id={} agent_id={agent_id} error={error}",
                    channel.id
                ),
            ),
        }
    }
    if should_run_memory_updates {
        match state.run_channel_join_memory_updates(&channel.id).await {
            Ok(()) => channel_create_log(
                &idempotency_key,
                "memory-updates-complete",
                &format!("channel_id={}", channel.id),
            ),
            Err(error) => channel_create_log(
                &idempotency_key,
                "memory-updates-failed",
                &format!("channel_id={} error={error}", channel.id),
            ),
        }
    }
    channel_create_log(
        &idempotency_key,
        "setup-complete",
        &format!("channel_id={}", channel.id),
    );
}

pub async fn members(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match state.channels().channel_members(&id).await {
        Ok(members) => Json(json!({ "members": members })).into_response(),
        Err(error) => channel_error_response(error),
    }
}

pub async fn add_member(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<AddChannelMemberRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let agent = match state.members().get_product_agent(&payload.agent_id).await {
        Ok(agent) => agent,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    };
    if agent.agent_kind == "coordinator" || is_internal_coordinator_id(&agent.id) {
        return error_response(
            StatusCode::BAD_REQUEST,
            "coordinator agents cannot join channels",
        );
    }

    match state
        .channels()
        .add_agent_to_channel_with_outcome(&id, &agent.id)
        .await
    {
        Ok(outcome) => {
            if outcome.created {
                if let Err(error) = state
                    .memory_maintainer()
                    .sync_added_channel_member(&id, &agent.id)
                    .await
                {
                    return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
                }
                if let Err(error) = state
                    .channel_join_reports()
                    .create_join_report(&id, &agent.id)
                    .await
                {
                    return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
                }
            }
            let status = if outcome.created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            (status, Json(json!({ "member": outcome.member }))).into_response()
        }
        Err(error) => channel_error_response(error),
    }
}

pub async fn remove_member(
    State(state): State<AppState>,
    Path((id, agent_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    let agent = match state.members().get_product_agent(&agent_id).await {
        Ok(agent) => agent,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    };
    if agent.agent_kind == "coordinator" || is_internal_coordinator_id(&agent.id) {
        return error_response(
            StatusCode::BAD_REQUEST,
            "coordinator agents cannot be removed from channels",
        );
    }

    match state
        .channels()
        .remove_agent_from_channel(&id, &agent.id)
        .await
    {
        Ok(Some(member)) => {
            if let Err(error) = state
                .memory_maintainer()
                .sync_removed_channel_member(&id, &agent.id)
                .await
            {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
            Json(json!({ "removedMember": member })).into_response()
        }
        Ok(None) => Json(json!({ "removedMember": null })).into_response(),
        Err(error) => channel_error_response(error),
    }
}

fn dedupe_agent_ids(agent_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    agent_ids
        .into_iter()
        .filter_map(|agent_id| {
            let trimmed = agent_id.trim().to_string();
            if !seen.insert(trimmed.clone()) {
                None
            } else {
                Some(trimmed)
            }
        })
        .collect()
}

fn dedupe_project_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter_map(|path| normalize_workspace_path(&path).ok())
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn workspace_label(path: &str) -> String {
    FsPath::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(path)
        .to_string()
}

fn channel_create_log(idempotency_key: &str, stage: &str, detail: &str) {
    eprintln!(
        "[slei-daemon][channel-create] idempotency_key={idempotency_key} stage={stage} {detail}"
    );
}

fn channel_error_response(error: ChannelError) -> Response {
    match error {
        ChannelError::MissingChannel | ChannelError::MissingMember => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        ChannelError::InvalidChannel => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        ChannelError::InvalidWorkspacePath => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        ChannelError::DuplicateChannelName
        | ChannelError::DuplicateWorkspacePath
        | ChannelError::IdempotencyConflict => (
            StatusCode::CONFLICT,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        ChannelError::MissingIdempotencyKey => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
        ChannelError::Io(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

fn error_response(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({ "error": error }))).into_response()
}
