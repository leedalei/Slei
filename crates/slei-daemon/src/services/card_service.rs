use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use slei_storage::db::SleiDb;
use slei_storage::repositories::{InteractiveCardRow, Repositories};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::services::idempotency::namespaced_key;

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
    repos: Option<Repositories>,
    inner: Arc<Mutex<CardStateStore>>,
    mutation_gate: Arc<AsyncMutex<()>>,
}

#[derive(Debug, Default)]
struct CardStateStore {
    cards: HashMap<String, InteractiveCard>,
    proposal_idempotency: HashMap<String, String>,
    decision_idempotency: HashMap<String, CardState>,
    executed_actions: Vec<String>,
}

impl CardService {
    pub fn new(repos: Repositories) -> Self {
        Self {
            inner: Arc::new(Mutex::new(CardStateStore {
                ..CardStateStore::default()
            })),
            mutation_gate: Arc::new(AsyncMutex::new(())),
            repos: Some(repos),
        }
    }

    pub fn for_tests() -> Self {
        Self::new(repositories_blocking(
            std::env::temp_dir().join(format!("slei-cards-{}", Uuid::new_v4())),
        ))
    }

    pub fn clear_for_development_reset(&self) {
        *self.inner.lock().expect("card state lock") = CardStateStore::default();
    }

    pub async fn propose_card(
        &self,
        proposal: CardProposal,
        idempotency_key: &str,
    ) -> Result<InteractiveCard, CardError> {
        let _gate = self.mutation_gate.lock().await;
        validate_action(&proposal)?;
        let idempotency_key = namespaced_key("card:propose", idempotency_key)
            .ok_or(CardError::MissingIdempotencyKey)?;
        if let Some(card) = self.card_for_idempotency(&idempotency_key).await? {
            return Ok(card);
        }
        {
            let state = self.inner.lock().expect("card state lock");
            if let Some(card_id) = state.proposal_idempotency.get(&idempotency_key) {
                return state
                    .cards
                    .get(card_id)
                    .cloned()
                    .ok_or(CardError::CardNotFound);
            }
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
        self.persist_card_idempotent(
            &card,
            &idempotency_key,
            &json!({ "cardId": card.id, "operation": "propose" }).to_string(),
        )
        .await?;
        let mut state = self.inner.lock().expect("card state lock");
        state
            .proposal_idempotency
            .insert(idempotency_key, card.id.clone());
        state.cards.insert(card.id.clone(), card.clone());
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
        let _gate = self.mutation_gate.lock().await;
        let idempotency_key = namespaced_key("card:product_tool", idempotency_key)
            .ok_or(CardError::MissingIdempotencyKey)?;
        let template = product_tool_template(payload)?;
        let action = product_tool_action(&template)?;
        let proposal = CardProposal {
            run_id: run_id.to_string(),
            agent_id: agent_id.to_string(),
            action: action.clone(),
        };
        validate_action(&proposal)?;

        if let Some(card) = self.card_for_idempotency(&idempotency_key).await? {
            return Ok(card.to_view());
        }
        {
            let state = self.inner.lock().expect("card state lock");
            if let Some(card_id) = state.proposal_idempotency.get(&idempotency_key) {
                let card = state
                    .cards
                    .get(card_id)
                    .cloned()
                    .ok_or(CardError::CardNotFound)?;
                return Ok(card.to_view());
            }
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
        self.persist_card_idempotent(
            &card,
            &idempotency_key,
            &json!({ "cardId": card.id, "operation": "proposeProductTool" }).to_string(),
        )
        .await?;
        let mut state = self.inner.lock().expect("card state lock");
        state
            .proposal_idempotency
            .insert(idempotency_key, card.id.clone());
        state.cards.insert(card.id.clone(), card.clone());
        Ok(card.to_view())
    }

    pub async fn decide(
        &self,
        decision: CardDecision,
        idempotency_key: &str,
    ) -> Result<(), CardError> {
        let _gate = self.mutation_gate.lock().await;
        let idempotency_key = namespaced_key("card:decide", idempotency_key)
            .ok_or(CardError::MissingIdempotencyKey)?;
        if self
            .idempotent_response_payload(&idempotency_key)
            .await?
            .is_some()
        {
            return Ok(());
        }
        self.ensure_card_cached(&decision.card_id).await?;
        let (card, executed, next_state) = {
            let state = self.inner.lock().expect("card state lock");
            if state.decision_idempotency.contains_key(&idempotency_key) {
                return Ok(());
            }

            let mut card = state
                .cards
                .get(&decision.card_id)
                .cloned()
                .ok_or(CardError::CardNotFound)?;
            if decision.confirm {
                card.state = CardState::Confirmed;
                let executed = execute_action(&card.action, decision.edited_name.as_deref());
                (card, Some(executed), CardState::Confirmed)
            } else {
                card.state = CardState::Dismissed;
                (card, None, CardState::Dismissed)
            }
        };
        self.persist_card_idempotent(
            &card,
            &idempotency_key,
            &json!({
                "cardId": card.id,
                "operation": "decide",
                "state": next_state,
            })
            .to_string(),
        )
        .await?;
        let mut state = self.inner.lock().expect("card state lock");
        state.cards.insert(card.id.clone(), card);
        if let Some(executed) = executed {
            state.executed_actions.push(executed);
        }
        state
            .decision_idempotency
            .insert(idempotency_key, next_state);
        Ok(())
    }

    pub async fn complete(
        &self,
        card_id: &str,
        idempotency_key: &str,
    ) -> Result<InteractiveCardView, CardError> {
        let _gate = self.mutation_gate.lock().await;
        let idempotency_key = namespaced_key("card:complete", idempotency_key)
            .ok_or(CardError::MissingIdempotencyKey)?;
        if let Some(card) = self.card_for_idempotency(&idempotency_key).await? {
            return Ok(card.to_view());
        }
        self.ensure_card_cached(card_id).await?;
        let card = {
            let state = self.inner.lock().expect("card state lock");
            if let Some(existing_state) = state.decision_idempotency.get(&idempotency_key) {
                let card = state
                    .cards
                    .get(card_id)
                    .cloned()
                    .ok_or(CardError::CardNotFound)?;
                if *existing_state == card.state || card.state == CardState::Done {
                    return Ok(card.to_view());
                }
            }
            let mut card = state
                .cards
                .get(card_id)
                .cloned()
                .ok_or(CardError::CardNotFound)?;
            card.state = CardState::Done;
            card
        };
        self.persist_card_idempotent(
            &card,
            &idempotency_key,
            &json!({ "cardId": card.id, "operation": "complete", "state": CardState::Done })
                .to_string(),
        )
        .await?;
        let view = card.to_view();
        let mut state = self.inner.lock().expect("card state lock");
        state.cards.insert(card.id.clone(), card);
        state
            .decision_idempotency
            .insert(idempotency_key, CardState::Done);
        Ok(view)
    }

    pub async fn card(&self, card_id: &str) -> Result<InteractiveCard, CardError> {
        if let Some(card) = self
            .inner
            .lock()
            .expect("card state lock")
            .cards
            .get(card_id)
            .cloned()
        {
            return Ok(card);
        }
        let Some(repos) = &self.repos else {
            return Err(CardError::CardNotFound);
        };
        let row = repos
            .interactive_card(card_id)
            .await
            .map_err(card_storage_error)?
            .ok_or(CardError::CardNotFound)?;
        let card = card_from_row(row)?;
        self.inner
            .lock()
            .expect("card state lock")
            .cards
            .insert(card.id.clone(), card.clone());
        Ok(card)
    }

    pub async fn attach_message_id(
        &self,
        card_id: &str,
        message_id: &str,
    ) -> Result<InteractiveCard, CardError> {
        let _gate = self.mutation_gate.lock().await;
        self.ensure_card_cached(card_id).await?;
        let card = {
            let state = self.inner.lock().expect("card state lock");
            let mut card = state
                .cards
                .get(card_id)
                .cloned()
                .ok_or(CardError::CardNotFound)?;
            card.message_id = Some(message_id.to_string());
            card
        };
        self.persist_card(&card).await?;
        self.inner
            .lock()
            .expect("card state lock")
            .cards
            .insert(card.id.clone(), card.clone());
        Ok(card)
    }

    pub async fn cards_for_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<InteractiveCardView>, CardError> {
        if let Some(repos) = &self.repos {
            let rows = repos
                .interactive_cards()
                .await
                .map_err(card_storage_error)?;
            let mut cards = Vec::new();
            for row in rows {
                if row.message_id.as_deref() != Some(message_id) {
                    continue;
                }
                cards.push(card_from_row(row)?.to_view());
            }
            return Ok(cards);
        }
        Ok(self
            .inner
            .lock()
            .expect("card state lock")
            .cards
            .values()
            .filter(|card| card.message_id.as_deref() == Some(message_id))
            .map(InteractiveCard::to_view)
            .collect())
    }

    pub async fn executed_actions(&self) -> Vec<String> {
        self.inner
            .lock()
            .expect("card state lock")
            .executed_actions
            .clone()
    }

    async fn persist_card(&self, card: &InteractiveCard) -> Result<(), CardError> {
        let Some(repos) = &self.repos else {
            return Ok(());
        };
        repos
            .upsert_interactive_card(card_to_row(card)?)
            .await
            .map_err(card_storage_error)
    }

    async fn persist_card_idempotent(
        &self,
        card: &InteractiveCard,
        idempotency_key: &str,
        response_payload: &str,
    ) -> Result<(), CardError> {
        let Some(repos) = &self.repos else {
            return Ok(());
        };
        repos
            .upsert_interactive_card_idempotent(
                card_to_row(card)?,
                idempotency_key,
                response_payload,
            )
            .await
            .map_err(card_storage_error)
    }

    async fn idempotent_response_payload(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<String>, CardError> {
        let Some(repos) = &self.repos else {
            return Ok(None);
        };
        repos
            .idempotent_response(idempotency_key)
            .await
            .map_err(card_storage_error)
    }

    async fn card_for_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<InteractiveCard>, CardError> {
        let Some(payload) = self.idempotent_response_payload(idempotency_key).await? else {
            return Ok(None);
        };
        let card_id = idempotent_card_id(&payload);
        let card = self.card(&card_id).await?;
        self.inner
            .lock()
            .expect("card state lock")
            .proposal_idempotency
            .insert(idempotency_key.to_string(), card.id.clone());
        Ok(Some(card))
    }

    async fn ensure_card_cached(&self, card_id: &str) -> Result<(), CardError> {
        if self
            .inner
            .lock()
            .expect("card state lock")
            .cards
            .contains_key(card_id)
        {
            return Ok(());
        }
        let _ = self.card(card_id).await?;
        Ok(())
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
            CardAction::CreateAgent { name, .. } => {
                let draft_name = normalize_agent_name_seed(name);
                InteractiveCardView {
                    id: self.id.clone(),
                    kind: "createAgent".to_string(),
                    state: card_state_label(self.state.clone()),
                    title: "创建智能体草案".to_string(),
                    summary: format!("{draft_name} · ClaudeCode / Sonnet"),
                    draft: json!({
                        "name": draft_name,
                        "handle": format!("@{}", normalize_handle_seed(name)),
                        "runtimeKind": "ClaudeCode",
                        "model": "Sonnet",
                        "nodeId": "local-node",
                        "description": agent_description(name),
                    }),
                    action_label: "创建".to_string(),
                    done_label: "DONE".to_string(),
                }
            }
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
    if !matches!(kind, "createAgent" | "createChannel") {
        return Err(CardError::UnsupportedProductToolCardKind(kind.to_string()));
    }

    let draft = payload
        .get("draft")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or(CardError::InvalidProductToolPayload("draft"))?;
    validate_product_tool_draft(kind, &draft)?;

    Ok(InteractiveCardTemplate {
        kind: kind.to_string(),
        title: required_string(payload, "title")?.to_string(),
        summary: required_string(payload, "summary")?.to_string(),
        draft,
        action_label: required_string(payload, "actionLabel")?.to_string(),
        done_label: required_string(payload, "doneLabel")?.to_string(),
    })
}

fn validate_product_tool_draft(kind: &str, draft: &Value) -> Result<(), CardError> {
    match kind {
        "createAgent" => {
            let name = required_string(draft, "name")?;
            if !is_valid_agent_name(name) {
                return Err(CardError::InvalidProductToolPayload("name"));
            }
            let handle = required_string(draft, "handle")?;
            if !is_valid_agent_handle(handle) {
                return Err(CardError::InvalidProductToolPayload("handle"));
            }
            required_string(draft, "runtimeKind")?;
            required_string(draft, "model")?;
            required_string(draft, "nodeId")?;
            required_string(draft, "description")?;
        }
        "createChannel" => {
            required_string(draft, "name")?;
            optional_string(draft, "description")?;
            optional_string(draft, "projectName")?;
            optional_string_array(draft, "projectPaths")?;
            optional_string_array(draft, "agentIds")?;
        }
        _ => return Err(CardError::UnsupportedProductToolCardKind(kind.to_string())),
    }
    Ok(())
}

fn product_tool_action(template: &InteractiveCardTemplate) -> Result<CardAction, CardError> {
    match template.kind.as_str() {
        "createAgent" => Ok(CardAction::CreateAgent {
            name: required_string(&template.draft, "name")?.to_string(),
            permission: "Controlled".to_string(),
        }),
        "createChannel" => {
            let name = required_string(&template.draft, "name")?
                .trim_start_matches('#')
                .trim();
            if name.is_empty() {
                return Err(CardError::InvalidProductToolPayload("name"));
            }
            Ok(CardAction::CreateChannel {
                name: name.to_string(),
            })
        }
        kind => Err(CardError::UnsupportedProductToolCardKind(kind.to_string())),
    }
}

fn required_string<'a>(value: &'a Value, key: &'static str) -> Result<&'a str, CardError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|candidate| !candidate.trim().is_empty())
        .ok_or(CardError::InvalidProductToolPayload(key))
}

fn optional_string(value: &Value, key: &'static str) -> Result<(), CardError> {
    if let Some(candidate) = value.get(key) {
        if !(candidate.is_null() || candidate.as_str().is_some()) {
            return Err(CardError::InvalidProductToolPayload(key));
        }
    }
    Ok(())
}

fn optional_string_array(value: &Value, key: &'static str) -> Result<(), CardError> {
    if let Some(candidate) = value.get(key) {
        let valid = candidate.is_null()
            || candidate
                .as_array()
                .is_some_and(|items| items.iter().all(Value::is_string));
        if !valid {
            return Err(CardError::InvalidProductToolPayload(key));
        }
    }
    Ok(())
}

fn normalize_handle_seed(name: &str) -> String {
    let seed = normalize_agent_name_seed(name)
        .trim()
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '-')
        .take(32)
        .collect::<String>();
    if seed.is_empty() {
        "Agent".to_string()
    } else {
        seed
    }
}

fn normalize_agent_name_seed(name: &str) -> String {
    let seed = name
        .trim()
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '-')
        .collect::<String>();
    if seed.is_empty() {
        "Agent".to_string()
    } else {
        seed
    }
}

fn is_valid_agent_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty() && !trimmed.chars().any(char::is_whitespace) && !trimmed.contains('-')
}

fn is_valid_agent_handle(handle: &str) -> bool {
    let trimmed = handle.trim().trim_start_matches('@');
    !trimmed.is_empty()
        && trimmed.chars().count() <= 32
        && !trimmed.chars().any(char::is_whitespace)
        && !trimmed.contains('-')
}

fn agent_description(name: &str) -> String {
    if name.to_lowercase().contains("nancy") {
        "QA 质保员，负责审查代码质量、安全漏洞，提出改进意见。".to_string()
    } else {
        "研发团队开发工程师，负责基于任务分解进行实际编码工作。".to_string()
    }
}

fn card_to_row(card: &InteractiveCard) -> Result<InteractiveCardRow, CardError> {
    Ok(InteractiveCardRow {
        id: card.id.clone(),
        run_id: card.run_id.clone(),
        agent_id: card.agent_id.clone(),
        conversation_id: card.conversation_id.clone(),
        message_id: card.message_id.clone(),
        action_payload: serde_json::to_string(&card.action).map_err(CardError::Json)?,
        template_payload: card
            .view
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(CardError::Json)?,
        state: serde_json::to_string(&card.state).map_err(CardError::Json)?,
    })
}

fn card_from_row(row: InteractiveCardRow) -> Result<InteractiveCard, CardError> {
    Ok(InteractiveCard {
        id: row.id,
        run_id: row.run_id,
        agent_id: row.agent_id,
        conversation_id: row.conversation_id,
        message_id: row.message_id,
        action: serde_json::from_str(&row.action_payload).map_err(CardError::Json)?,
        view: row
            .template_payload
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(CardError::Json)?,
        state: serde_json::from_str(&row.state).map_err(CardError::Json)?,
    })
}

fn idempotent_card_id(payload: &str) -> String {
    serde_json::from_str::<Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("cardId")
                .and_then(|id| id.as_str())
                .map(ToString::to_string)
                .or_else(|| {
                    value
                        .get("card_id")
                        .and_then(|id| id.as_str())
                        .map(ToString::to_string)
                })
        })
        .unwrap_or_else(|| payload.to_string())
}

fn repositories_blocking(data_root: PathBuf) -> Repositories {
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("create card storage runtime");
        runtime.block_on(async move {
            std::fs::create_dir_all(&data_root).expect("create card data root");
            let database_url = format!("sqlite://{}", data_root.join("slei.sqlite").display());
            let db = SleiDb::connect(&database_url)
                .await
                .expect("connect card db");
            db.migrate().await.expect("migrate card db");
            Repositories::new(db.pool().clone())
        })
    })
    .join()
    .expect("initialize card repositories")
}

fn card_storage_error(error: sqlx::Error) -> CardError {
    CardError::Io(std::io::Error::new(
        std::io::ErrorKind::Other,
        error.to_string(),
    ))
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
    #[error("idempotency-key is required")]
    MissingIdempotencyKey,
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
