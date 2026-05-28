//! Provider-neutral runtime integration contracts for Slei.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuntimeKind {
    ClaudeCode,
    OpenCode,
    Codex,
    Custom(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeCapabilities {
    pub streaming: bool,
    pub resumable_session: bool,
    pub approvals: bool,
    pub human_questions: bool,
    pub workspace_restrictions: bool,
    pub structured_output: bool,
    pub artifacts: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtectedOpaqueToken(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeSession {
    pub id: Uuid,
    pub runtime_kind: RuntimeKind,
    pub runtime_token: Option<ProtectedOpaqueToken>,
    pub channel_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub agent_id: Uuid,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionPreset {
    ReadOnly,
    Edit,
    Controlled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunInput {
    pub agent_id: Uuid,
    pub prompt: String,
    pub system_prompt: Option<String>,
    pub model: String,
    pub workspaces: Vec<PathBuf>,
    pub preset: PermissionPreset,
    pub run_id: Uuid,
    pub session: RuntimeSession,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SleiProductTool {
    ProposeInteractiveCard,
    RequestVisibleDelegation,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum RunEvent {
    Started,
    OutputDelta {
        text: String,
    },
    ToolCallStarted {
        name: String,
        input: serde_json::Value,
    },
    ToolCallCompleted {
        result: serde_json::Value,
    },
    PermissionRequest {
        request_id: Uuid,
        run_id: Uuid,
        tool_use_id: String,
        agent_id: Uuid,
        action: String,
        description: String,
        risk_level: RiskLevel,
    },
    HumanQuestionRequested {
        request_id: Uuid,
        run_id: Uuid,
        agent_id: Uuid,
        question: String,
    },
    ProductToolRequested {
        request_id: Uuid,
        run_id: Uuid,
        agent_id: Uuid,
        tool: SleiProductTool,
        payload: serde_json::Value,
    },
    Completed {
        exit_summary: Option<String>,
    },
    Failed {
        code: String,
        detail: String,
    },
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionDecision {
    Allow,
    Block { reason: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_contract_types_round_trip_through_json() {
        let kinds = vec![RuntimeKind::ClaudeCode, RuntimeKind::OpenCode, RuntimeKind::Codex];
        let json = serde_json::to_string(&kinds).expect("runtime kinds serialize");
        let decoded: Vec<RuntimeKind> = serde_json::from_str(&json).expect("runtime kinds deserialize");
        assert_eq!(decoded, kinds);

        let capabilities = RuntimeCapabilities {
            streaming: true,
            resumable_session: false,
            approvals: true,
            human_questions: true,
            workspace_restrictions: true,
            structured_output: true,
            artifacts: false,
        };
        let json = serde_json::to_string(&capabilities).expect("capabilities serialize");
        let decoded: RuntimeCapabilities =
            serde_json::from_str(&json).expect("capabilities deserialize");
        assert_eq!(decoded, capabilities);

        let session = RuntimeSession {
            id: uuid::Uuid::new_v4(),
            runtime_kind: RuntimeKind::ClaudeCode,
            runtime_token: None,
            channel_id: Some(uuid::Uuid::new_v4()),
            task_id: None,
            agent_id: uuid::Uuid::new_v4(),
        };
        let json = serde_json::to_string(&session).expect("session serializes");
        let decoded: RuntimeSession = serde_json::from_str(&json).expect("session deserializes");
        assert_eq!(decoded, session);

        let event = RunEvent::PermissionRequest {
            request_id: uuid::Uuid::new_v4(),
            run_id: uuid::Uuid::new_v4(),
            tool_use_id: "toolu_123".to_string(),
            agent_id: uuid::Uuid::new_v4(),
            action: "Bash".to_string(),
            description: "run shell command".to_string(),
            risk_level: RiskLevel::High,
        };
        let json = serde_json::to_string(&event).expect("permission event serializes");
        let decoded: RunEvent = serde_json::from_str(&json).expect("permission event deserializes");
        assert_eq!(decoded, event);

        let decision = PermissionDecision::Block {
            reason: "outside workspace".to_string(),
        };
        let json = serde_json::to_string(&decision).expect("decision serializes");
        let decoded: PermissionDecision =
            serde_json::from_str(&json).expect("decision deserializes");
        assert_eq!(decoded, decision);
    }
}
