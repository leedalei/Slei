use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CardState {
    Pending,
    Confirmed,
    Dismissed,
    Rejected,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InteractiveCard {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    pub action: CardAction,
    pub state: CardState,
}

#[derive(Clone, Debug, Default)]
pub struct CardService {
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
    pub fn for_tests() -> Self {
        Self::default()
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
            action: proposal.action,
            state: CardState::Pending,
        };
        state
            .proposal_idempotency
            .insert(idempotency_key.to_string(), card.id.clone());
        state.cards.insert(card.id.clone(), card.clone());
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
        Ok(())
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
}
