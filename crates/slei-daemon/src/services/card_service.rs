use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum CardAction {
    CreateChannel { name: String },
    CreateAgent { name: String, permission: String },
    MountWorkspace { path: String },
}

#[derive(Clone, Debug)]
pub struct CardProposal {
    pub run_id: String,
    pub agent_id: String,
    pub action: CardAction,
}

#[derive(Clone, Debug)]
pub struct CardDecision {
    pub card_id: String,
    pub confirm: bool,
    pub edited_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CardState {
    Pending,
    Confirmed,
    Done,
    Dismissed,
    Rejected,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveCard {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    pub conversation_id: Option<String>,
    pub message_id: Option<String>,
    pub action: CardAction,
    pub state: CardState,
}

#[derive(Clone, Debug, Default)]
pub struct CardService {
    root: Arc<PathBuf>,
    inner: Arc<Mutex<CardStateStore>>,
}

#[derive(Debug, Default)]
struct CardStateStore {
    cards: HashMap<String, InteractiveCard>,
    proposal_idempotency: HashMap<String, String>,
    decision_idempotency: HashMap<String, CardState>,
    executed_actions: Vec<String>,
}

impl CardService {
    pub fn new(root: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(CardStateStore {
                cards: load_cards(&root),
                ..CardStateStore::default()
            })),
            root: Arc::new(root),
        }
    }

    pub fn for_tests() -> Self {
        Self::new(std::env::temp_dir().join(format!("slei-cards-{}", Uuid::new_v4())))
    }

    pub async fn propose_card(
        &self,
        proposal: CardProposal,
        idempotency_key: &str,
    ) -> Result<InteractiveCard, CardError> {
        validate_action(&proposal)?;
        let mut state = self.inner.lock().expect("card state lock");
        if let Some(card_id) = state.proposal_idempotency.get(idempotency_key) {
            return state
                .cards
                .get(card_id)
                .cloned()
                .ok_or(CardError::CardNotFound);
        }

        let card = InteractiveCard {
            id: format!("card_{}", Uuid::new_v4().simple()),
            run_id: proposal.run_id,
            agent_id: proposal.agent_id,
            conversation_id: None,
            message_id: None,
            action: proposal.action,
            state: CardState::Pending,
        };
        state
            .proposal_idempotency
            .insert(idempotency_key.to_string(), card.id.clone());
        state.cards.insert(card.id.clone(), card.clone());
        persist_cards(&self.root, &state.cards)?;
        Ok(card)
    }

    pub async fn propose_from_freeform(&self, _text: &str) -> Result<InteractiveCard, CardError> {
        Err(CardError::FreeformRejected)
    }

    pub async fn decide(
        &self,
        decision: CardDecision,
        idempotency_key: &str,
    ) -> Result<(), CardError> {
        let mut state = self.inner.lock().expect("card state lock");
        if state.decision_idempotency.contains_key(idempotency_key) {
            return Ok(());
        }

        let (next_state, executed) = {
            let card = state
                .cards
                .get_mut(&decision.card_id)
                .ok_or(CardError::CardNotFound)?;
            if decision.confirm {
                card.state = CardState::Confirmed;
                (
                    card.state.clone(),
                    Some(execute_action(
                        &card.action,
                        decision.edited_name.as_deref(),
                    )),
                )
            } else {
                card.state = CardState::Dismissed;
                (card.state.clone(), None)
            }
        };
        if let Some(executed) = executed {
            state.executed_actions.push(executed);
        }
        state
            .decision_idempotency
            .insert(idempotency_key.to_string(), next_state);
        persist_cards(&self.root, &state.cards)?;
        Ok(())
    }

    pub async fn propose_guide_card(
        &self,
        conversation_id: &str,
        message_id: &str,
        text: &str,
        idempotency_key: &str,
    ) -> Result<Option<InteractiveCardView>, CardError> {
        let Some(action) = guide_action_from_text(text) else {
            return Ok(None);
        };

        let mut state = self.inner.lock().expect("card state lock");
        if let Some(card_id) = state.proposal_idempotency.get(idempotency_key) {
            let card = state
                .cards
                .get(card_id)
                .cloned()
                .ok_or(CardError::CardNotFound)?;
            return Ok(Some(card.to_view()));
        }

        let card = InteractiveCard {
            id: format!("card_{}", Uuid::new_v4().simple()),
            run_id: format!("guide_{message_id}"),
            agent_id: "agent_guide_local_node".to_string(),
            conversation_id: Some(conversation_id.to_string()),
            message_id: Some(message_id.to_string()),
            action,
            state: CardState::Pending,
        };
        state
            .proposal_idempotency
            .insert(idempotency_key.to_string(), card.id.clone());
        state.cards.insert(card.id.clone(), card.clone());
        persist_cards(&self.root, &state.cards)?;
        Ok(Some(card.to_view()))
    }

    pub async fn complete(&self, card_id: &str, idempotency_key: &str) -> Result<InteractiveCardView, CardError> {
        let mut state = self.inner.lock().expect("card state lock");
        if let Some(existing_state) = state.decision_idempotency.get(idempotency_key) {
            let card = state
                .cards
                .get(card_id)
                .cloned()
                .ok_or(CardError::CardNotFound)?;
            if *existing_state == card.state || card.state == CardState::Done {
                return Ok(card.to_view());
            }
        }
        let card = state
            .cards
            .get_mut(card_id)
            .ok_or(CardError::CardNotFound)?;
        card.state = CardState::Done;
        let view = card.to_view();
        state
            .decision_idempotency
            .insert(idempotency_key.to_string(), CardState::Done);
        persist_cards(&self.root, &state.cards)?;
        Ok(view)
    }

    pub async fn card(&self, card_id: &str) -> Result<InteractiveCard, CardError> {
        self.inner
            .lock()
            .expect("card state lock")
            .cards
            .get(card_id)
            .cloned()
            .ok_or(CardError::CardNotFound)
    }

    pub async fn executed_actions(&self) -> Vec<String> {
        self.inner
            .lock()
            .expect("card state lock")
            .executed_actions
            .clone()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveCardView {
    pub id: String,
    pub kind: String,
    pub state: String,
    pub title: String,
    pub summary: String,
    pub draft: Value,
    pub action_label: String,
    pub done_label: String,
}

impl InteractiveCard {
    pub fn to_view(&self) -> InteractiveCardView {
        match &self.action {
            CardAction::CreateAgent { name, .. } => InteractiveCardView {
                id: self.id.clone(),
                kind: "createAgent".to_string(),
                state: card_state_label(self.state.clone()),
                title: "创建智能体草案".to_string(),
                summary: format!("{name} · ClaudeCode / Sonnet"),
                draft: json!({
                    "name": name,
                    "handle": format!("@{}", normalize_handle_seed(name)),
                    "runtimeKind": "ClaudeCode",
                    "model": "Sonnet",
                    "nodeId": "local-node",
                    "description": agent_description(name),
                }),
                action_label: "创建".to_string(),
                done_label: "DONE".to_string(),
            },
            CardAction::CreateChannel { name } => InteractiveCardView {
                id: self.id.clone(),
                kind: "createChannel".to_string(),
                state: card_state_label(self.state.clone()),
                title: "创建频道草案".to_string(),
                summary: format!("#{name}"),
                draft: json!({
                    "name": name.trim_start_matches('#'),
                    "description": "团队会话频道",
                    "projectName": Value::Null,
                }),
                action_label: "创建".to_string(),
                done_label: "DONE".to_string(),
            },
            CardAction::MountWorkspace { path } => InteractiveCardView {
                id: self.id.clone(),
                kind: "mountWorkspace".to_string(),
                state: card_state_label(self.state.clone()),
                title: "挂载工作区".to_string(),
                summary: path.clone(),
                draft: json!({ "path": path }),
                action_label: "创建".to_string(),
                done_label: "DONE".to_string(),
            },
        }
    }
}

fn card_state_label(state: CardState) -> String {
    match state {
        CardState::Pending => "pending",
        CardState::Confirmed | CardState::Done => "done",
        CardState::Dismissed => "dismissed",
        CardState::Rejected => "rejected",
    }
    .to_string()
}

fn guide_action_from_text(text: &str) -> Option<CardAction> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return None;
    }
    let lower = normalized.to_lowercase();
    if (normalized.contains("创建") || lower.contains("create") || normalized.contains("新增"))
        && (lower.contains("agent") || normalized.contains("成员"))
    {
        let name = extract_named_value(normalized).unwrap_or_else(|| {
            if lower.contains("qa") || normalized.contains("测试") || normalized.contains("质保") {
                "Nancy".to_string()
            } else {
                "Coda".to_string()
            }
        });
        return Some(CardAction::CreateAgent {
            name,
            permission: "Controlled".to_string(),
        });
    }
    if (normalized.contains("创建") || lower.contains("create") || normalized.contains("新增"))
        && (lower.contains("channel") || normalized.contains("频道"))
    {
        let name = extract_named_value(normalized)
            .unwrap_or_else(|| "dev-team".to_string())
            .trim_start_matches('#')
            .to_string();
        return Some(CardAction::CreateChannel { name });
    }
    None
}

fn extract_named_value(text: &str) -> Option<String> {
    for marker in ["叫", "名为", "named", "called"] {
        if let Some((_, tail)) = text.split_once(marker) {
            let value = tail
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(|ch: char| ch == '的' || ch == ',' || ch == '，')
                .to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn normalize_handle_seed(name: &str) -> String {
    let seed = name
        .trim()
        .to_lowercase()
        .chars()
        .filter(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || *character == '-')
        .collect::<String>();
    if seed.is_empty() {
        "agent".to_string()
    } else {
        seed
    }
}

fn agent_description(name: &str) -> String {
    if name.to_lowercase().contains("nancy") {
        "QA 质保员，负责审查代码质量、安全漏洞，提出改进意见。".to_string()
    } else {
        "研发团队开发工程师，负责基于任务分解进行实际编码工作。".to_string()
    }
}

fn load_cards(root: &PathBuf) -> HashMap<String, InteractiveCard> {
    fs::read_to_string(root.join("cards/index.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<InteractiveCard>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|card| (card.id.clone(), card))
        .collect()
}

fn persist_cards(
    root: &PathBuf,
    cards: &HashMap<String, InteractiveCard>,
) -> Result<(), CardError> {
    let path = root.join("cards/index.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(CardError::Io)?;
    }
    let mut ordered = cards.values().cloned().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.id.cmp(&right.id));
    let payload = serde_json::to_string_pretty(&ordered).map_err(CardError::Json)?;
    fs::write(path, payload).map_err(CardError::Io)
}

fn validate_action(proposal: &CardProposal) -> Result<(), CardError> {
    match &proposal.action {
        CardAction::MountWorkspace { .. } => Err(CardError::WorkspaceMountRejected),
        CardAction::CreateAgent { permission, .. }
            if proposal.agent_id == "agent_readonly" && permission == "Controlled" =>
        {
            Err(CardError::PrivilegeEscalationRejected)
        }
        _ => Ok(()),
    }
}

fn execute_action(action: &CardAction, edited_name: Option<&str>) -> String {
    match action {
        CardAction::CreateChannel { name } => {
            format!("create_channel:{}", edited_name.unwrap_or(name))
        }
        CardAction::CreateAgent { name, .. } => {
            format!("create_agent:{}", edited_name.unwrap_or(name))
        }
        CardAction::MountWorkspace { path } => format!("mount_workspace:{path}"),
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CardError {
    #[error("card not found")]
    CardNotFound,
    #[error("free-form assistant text cannot create interactive cards")]
    FreeformRejected,
    #[error("workspace mounts are not allowed through interactive cards")]
    WorkspaceMountRejected,
    #[error("interactive card cannot grant privileges above proposing agent")]
    PrivilegeEscalationRejected,
    #[error("interactive card io error: {0}")]
    Io(std::io::Error),
    #[error("interactive card json error: {0}")]
    Json(serde_json::Error),
}
