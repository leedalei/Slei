use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionPreset {
    ReadOnly,
    Edit,
    Controlled,
}

#[derive(Clone, Debug)]
pub struct ToolRequest {
    pub request_id: String,
    pub run_id: String,
    pub tool_use_id: String,
    pub agent_id: String,
    pub tool_name: String,
    pub path: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Approval {
    pub request_id: String,
    pub run_id: String,
    pub tool_use_id: String,
    pub agent_id: String,
    pub tool_name: String,
}

#[derive(Clone, Debug)]
pub struct ApprovalDecision {
    pub request_id: String,
    pub run_id: String,
    pub tool_use_id: String,
    pub agent_id: String,
    pub allow: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    Deny { reason: String },
    Pending { approval: Approval },
}

#[derive(Clone, Debug)]
pub struct ApprovalService {
    workspace_root: PathBuf,
    pending: Arc<Mutex<HashMap<String, Approval>>>,
    decisions: Arc<Mutex<HashMap<String, PolicyDecision>>>,
}

impl ApprovalService {
    pub fn for_tests(workspace_root: PathBuf) -> Self {
        Self {
            workspace_root: std::fs::canonicalize(&workspace_root).unwrap_or(workspace_root),
            pending: Arc::new(Mutex::new(HashMap::new())),
            decisions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn evaluate_tool_use(
        &self,
        preset: PermissionPreset,
        request: ToolRequest,
    ) -> PolicyDecision {
        if is_mutating_tool(&request.tool_name)
            && !self.is_inside_workspace(request.path.as_deref())
        {
            return PolicyDecision::Deny {
                reason: "outside workspace mutation denied".to_string(),
            };
        }

        match (preset, tool_risk(&request.tool_name)) {
            (_, ToolRisk::Read) => PolicyDecision::Allow,
            (PermissionPreset::ReadOnly, _) => PolicyDecision::Deny {
                reason: "read-only channel denies mutation".to_string(),
            },
            (PermissionPreset::Edit, ToolRisk::Edit) => PolicyDecision::Allow,
            (PermissionPreset::Edit, ToolRisk::High) | (PermissionPreset::Controlled, _) => {
                let approval = Approval {
                    request_id: request.request_id,
                    run_id: request.run_id,
                    tool_use_id: request.tool_use_id,
                    agent_id: request.agent_id,
                    tool_name: request.tool_name,
                };
                self.pending
                    .lock()
                    .await
                    .insert(approval.request_id.clone(), approval.clone());
                PolicyDecision::Pending { approval }
            }
        }
    }

    pub async fn resolve(&self, decision: ApprovalDecision) -> PolicyDecision {
        let mut pending = self.pending.lock().await;
        let Some(approval) = pending.get(&decision.request_id).cloned() else {
            return PolicyDecision::Deny {
                reason: "approval request not found".to_string(),
            };
        };

        if approval.run_id != decision.run_id
            || approval.tool_use_id != decision.tool_use_id
            || approval.agent_id != decision.agent_id
        {
            return PolicyDecision::Deny {
                reason: "approval correlation mismatch".to_string(),
            };
        }

        pending.remove(&decision.request_id);
        if decision.allow {
            PolicyDecision::Allow
        } else {
            PolicyDecision::Deny {
                reason: "denied by user".to_string(),
            }
        }
    }

    pub async fn resolve_idempotent(
        &self,
        decision: ApprovalDecision,
        idempotency_key: &str,
    ) -> PolicyDecision {
        if let Some(existing) = self.decisions.lock().await.get(idempotency_key).cloned() {
            return existing;
        }

        let result = self.resolve(decision).await;
        self.decisions
            .lock()
            .await
            .insert(idempotency_key.to_string(), result.clone());
        result
    }

    pub async fn safe_context(&self, request_id: &str) -> Option<String> {
        self.pending.lock().await.get(request_id).map(|approval| {
            format!(
                "{} requested by {} for run {}",
                approval.tool_name, approval.agent_id, approval.run_id
            )
        })
    }

    fn is_inside_workspace(&self, path: Option<&Path>) -> bool {
        let Some(path) = path else {
            return false;
        };
        canonicalize_for_policy(path).is_some_and(|path| path.starts_with(&self.workspace_root))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToolRisk {
    Read,
    Edit,
    High,
}

fn tool_risk(tool_name: &str) -> ToolRisk {
    match tool_name {
        "Read" | "Grep" | "Glob" => ToolRisk::Read,
        "Write" | "Edit" | "MultiEdit" => ToolRisk::Edit,
        _ => ToolRisk::High,
    }
}

fn is_mutating_tool(tool_name: &str) -> bool {
    !matches!(tool_name, "Read" | "Grep" | "Glob")
}

fn canonicalize_for_policy(path: &Path) -> Option<PathBuf> {
    if let Ok(path) = std::fs::canonicalize(path) {
        return Some(path);
    }

    let parent = path.parent()?;
    let file_name = path.file_name()?;
    std::fs::canonicalize(parent)
        .ok()
        .map(|parent| parent.join(file_name))
}
