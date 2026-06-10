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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<InteractiveCardTemplate>,
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

    pub fn clear_for_development_reset(&self) {
        *self.inner.lock().expect("card state lock") = CardStateStore::default();
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
            view: None,
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

    pub async fn propose_product_tool_card(
        &self,
        run_id: &str,
        agent_id: &str,
        conversation_id: &str,
        payload: &Value,
        idempotency_key: &str,
    ) -> Result<InteractiveCardView, CardError> {
        let template = product_tool_template(payload)?;
        let name = required_string(&template.draft, "name")?.to_string();
        let action = CardAction::CreateAgent {
            name,
            permission: "Controlled".to_string(),
        };
        let proposal = CardProposal {
            run_id: run_id.to_string(),
            agent_id: agent_id.to_string(),
            action: action.clone(),
        };
        validate_action(&proposal)?;

        let mut state = self.inner.lock().expect("card state lock");
        if let Some(card_id) = state.proposal_idempotency.get(idempotency_key) {
            let card = state
                .cards
                .get(card_id)
                .cloned()
                .ok_or(CardError::CardNotFound)?;
            return Ok(card.to_view());
        }

        let card = InteractiveCard {
            id: format!("card_{}", Uuid::new_v4().simple()),
            run_id: run_id.to_string(),
            agent_id: agent_id.to_string(),
            conversation_id: Some(conversation_id.to_string()),
            message_id: None,
            action,
            view: Some(template),
            state: CardState::Pending,
        };
        state
            .proposal_idempotency
            .insert(idempotency_key.to_string(), card.id.clone());
        state.cards.insert(card.id.clone(), card.clone());
        persist_cards(&self.root, &state.cards)?;
        Ok(card.to_view())
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

    pub async fn complete(
        &self,
        card_id: &str,
        idempotency_key: &str,
    ) -> Result<InteractiveCardView, CardError> {
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveCardTemplate {
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub draft: Value,
    pub action_label: String,
    pub done_label: String,
}

impl InteractiveCard {
    pub fn to_view(&self) -> InteractiveCardView {
        if let Some(template) = &self.view {
            return InteractiveCardView {
                id: self.id.clone(),
                kind: template.kind.clone(),
                state: card_state_label(self.state.clone()),
                title: template.title.clone(),
                summary: template.summary.clone(),
                draft: template.draft.clone(),
                action_label: template.action_label.clone(),
                done_label: template.done_label.clone(),
            };
        }

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

fn product_tool_template(payload: &Value) -> Result<InteractiveCardTemplate, CardError> {
    let kind = required_string(payload, "kind")?;
    if kind != "createAgent" {
        return Err(CardError::UnsupportedProductToolCardKind(kind.to_string()));
    }

    let draft = payload
        .get("draft")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or(CardError::InvalidProductToolPayload("draft"))?;
    for key in [
        "name",
        "handle",
        "runtimeKind",
        "model",
        "nodeId",
        "description",
    ] {
        required_string(&draft, key)?;
    }

    Ok(InteractiveCardTemplate {
        kind: kind.to_string(),
        title: required_string(payload, "title")?.to_string(),
        summary: required_string(payload, "summary")?.to_string(),
        draft,
        action_label: required_string(payload, "actionLabel")?.to_string(),
        done_label: required_string(payload, "doneLabel")?.to_string(),
    })
}

fn required_string<'a>(value: &'a Value, key: &'static str) -> Result<&'a str, CardError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|candidate| !candidate.trim().is_empty())
        .ok_or(CardError::InvalidProductToolPayload(key))
}

fn normalize_handle_seed(name: &str) -> String {
    let seed = name
        .trim()
        .to_lowercase()
        .chars()
        .filter(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || *character == '-'
        })
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
    #[error("unsupported product tool card kind: {0}")]
    UnsupportedProductToolCardKind(String),
    #[error("invalid product tool card payload: missing or invalid {0}")]
    InvalidProductToolPayload(&'static str),
    #[error("interactive card io error: {0}")]
    Io(std::io::Error),
    #[error("interactive card json error: {0}")]
    Json(serde_json::Error),
}
