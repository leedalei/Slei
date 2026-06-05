use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::orchestration_store::OrchestrationStore;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntentKind {
    Consultation,
    TaskCommand,
    StatusUpdate,
    Noise,
    Ambiguous,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CoordinatorAction {
    ArchiveOnly,
    RequestAgentReply,
    CreateTaskAndAssign,
    NeedsManualAssignment,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorInput {
    pub channel_id: String,
    pub message_id: String,
    pub body: String,
    pub explicit_agent_ids: Vec<String>,
    pub ready_agent_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorDecision {
    pub id: String,
    pub channel_id: String,
    pub message_id: String,
    pub intent: IntentKind,
    pub action: CoordinatorAction,
    pub assignee_agent_id: Option<String>,
    pub reason: String,
}

#[derive(Clone, Debug)]
pub struct CoordinatorService {
    store: OrchestrationStore,
    cache: Arc<Mutex<Vec<CoordinatorDecision>>>,
}

impl CoordinatorService {
    pub fn new(store: OrchestrationStore) -> Self {
        Self {
            store,
            cache: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn decide(&self, input: CoordinatorInput) -> CoordinatorDecision {
        let id = Uuid::new_v4();
        let intent = classify_intent(&input.body);
        let ready_reply_agent_ids = input
            .ready_agent_ids
            .iter()
            .filter(|agent_id| !is_channel_coordinator_agent(agent_id))
            .cloned()
            .collect::<Vec<_>>();
        let ready_assignee = ready_reply_agent_ids.first().cloned();
        let action = if !input.explicit_agent_ids.is_empty() {
            CoordinatorAction::RequestAgentReply
        } else if is_broadcast_or_greeting(&input.body) && ready_assignee.is_some() {
            CoordinatorAction::RequestAgentReply
        } else {
            action_for_intent(&intent, ready_assignee.as_deref())
        };
        let assignee_agent_id = assignee_for_action(
            &action,
            &intent,
            &input.explicit_agent_ids,
            &ready_reply_agent_ids,
        );
        let reason = reason_for_decision(&intent, &action, assignee_agent_id.as_deref());

        let decision = CoordinatorDecision {
            id: id.to_string(),
            channel_id: input.channel_id,
            message_id: input.message_id,
            intent,
            action,
            assignee_agent_id,
            reason,
        };

        self.store
            .record_decision(
                id,
                &decision.channel_id,
                &decision.message_id,
                &enum_as_storage_str(&decision.intent),
                &enum_as_storage_str(&decision.action),
                decision.assignee_agent_id.as_deref(),
                &decision.reason,
            )
            .await
            .expect("persist coordinator decision");
        eprintln!(
            "[slei-coordinator] channel_id={} message_id={} intent={} action={} assignee_agent_id={} ready_agents={} explicit_agents={} reason={}",
            decision.channel_id,
            decision.message_id,
            enum_as_storage_str(&decision.intent),
            enum_as_storage_str(&decision.action),
            decision.assignee_agent_id.as_deref().unwrap_or("none"),
            ready_reply_agent_ids.join(","),
            input.explicit_agent_ids.join(","),
            decision.reason
        );
        self.cache.lock().await.push(decision.clone());
        decision
    }

    pub async fn cached_decisions(&self) -> Vec<CoordinatorDecision> {
        self.cache.lock().await.clone()
    }
}

fn classify_intent(body: &str) -> IntentKind {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return IntentKind::Noise;
    }

    if contains_any(
        trimmed,
        &[
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
        ],
    ) {
        return IntentKind::TaskCommand;
    }

    if contains_any(
        trimmed,
        &["?", "？", "怎么看", "为什么", "怎么", "没人说话"],
    ) {
        return IntentKind::Consultation;
    }

    IntentKind::Ambiguous
}

fn is_channel_coordinator_agent(agent_id: &str) -> bool {
    agent_id.starts_with("agent_coordinator_")
}

fn is_broadcast_or_greeting(body: &str) -> bool {
    contains_any(
        body,
        &[
            "大家",
            "所有人",
            "@all",
            "@everyone",
            "hello",
            "hi",
            "嗨",
            "你好",
            "报数",
        ],
    )
}

fn action_for_intent(intent: &IntentKind, ready_assignee: Option<&str>) -> CoordinatorAction {
    match (intent, ready_assignee) {
        (IntentKind::TaskCommand, Some(_)) => CoordinatorAction::CreateTaskAndAssign,
        (IntentKind::TaskCommand, None) => CoordinatorAction::NeedsManualAssignment,
        (IntentKind::Consultation, Some(_)) => CoordinatorAction::RequestAgentReply,
        _ => CoordinatorAction::ArchiveOnly,
    }
}

fn assignee_for_action(
    action: &CoordinatorAction,
    intent: &IntentKind,
    explicit_agent_ids: &[String],
    ready_agent_ids: &[String],
) -> Option<String> {
    match (action, intent) {
        (CoordinatorAction::RequestAgentReply, _) if !explicit_agent_ids.is_empty() => {
            explicit_agent_ids.first().cloned()
        }
        (CoordinatorAction::RequestAgentReply, _)
        | (CoordinatorAction::CreateTaskAndAssign, IntentKind::TaskCommand) => {
            ready_agent_ids.first().cloned()
        }
        _ => None,
    }
}

fn reason_for_decision(
    intent: &IntentKind,
    action: &CoordinatorAction,
    assignee_agent_id: Option<&str>,
) -> String {
    match (intent, action, assignee_agent_id) {
        (_, CoordinatorAction::RequestAgentReply, Some(agent_id)) => {
            format!("requesting reply from {agent_id}")
        }
        (IntentKind::TaskCommand, CoordinatorAction::CreateTaskAndAssign, Some(agent_id)) => {
            format!("task command assigned to ready agent {agent_id}")
        }
        (IntentKind::TaskCommand, CoordinatorAction::NeedsManualAssignment, None) => {
            "task command has no ready assignee".to_string()
        }
        (IntentKind::Noise, CoordinatorAction::ArchiveOnly, None) => {
            "empty message archived".to_string()
        }
        _ => "no coordinator action required".to_string(),
    }
}

fn contains_any(body: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| body.contains(marker))
}

fn enum_as_storage_str<T>(value: &T) -> String
where
    T: Serialize,
{
    serde_json::to_value(value)
        .expect("serialize coordinator enum")
        .as_str()
        .expect("coordinator enum serializes to string")
        .to_string()
}
