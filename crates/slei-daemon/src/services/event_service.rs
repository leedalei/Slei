use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

const REPLAY_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DaemonEvent {
    pub sequence: u64,
    pub event_type: String,
    #[serde(rename = "type")]
    pub event_type_alias: String,
    pub occurred_at_unix_ms: u128,
    pub payload: Value,
}

#[derive(Clone, Debug, Default)]
pub struct EventService {
    inner: Arc<Mutex<EventStore>>,
}

#[derive(Debug, Default)]
struct EventStore {
    next_sequence: u64,
    events: Vec<DaemonEvent>,
}

impl EventService {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn clear_for_development_reset(&self) {
        *self.inner.lock().await = EventStore::default();
    }

    pub async fn append(&self, event_type: &str, payload: Value) -> DaemonEvent {
        self.append_with_time(event_type, payload, SystemTime::now())
            .await
    }

    pub async fn append_for_tests(
        &self,
        event_type: &str,
        payload: Value,
        age_hours: u64,
    ) -> DaemonEvent {
        let occurred_at = SystemTime::now()
            .checked_sub(Duration::from_secs(age_hours * 60 * 60))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        self.append_with_time(event_type, payload, occurred_at)
            .await
    }

    pub async fn replay(&self, after: u64) -> Vec<DaemonEvent> {
        let cutoff = SystemTime::now()
            .checked_sub(REPLAY_WINDOW)
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let cutoff_ms = unix_ms(cutoff);
        let store = self.inner.lock().await;

        store
            .events
            .iter()
            .filter(|event| event.sequence > after)
            .filter(|event| event.occurred_at_unix_ms >= cutoff_ms)
            .cloned()
            .collect()
    }

    async fn append_with_time(
        &self,
        event_type: &str,
        payload: Value,
        occurred_at: SystemTime,
    ) -> DaemonEvent {
        let mut store = self.inner.lock().await;
        store.next_sequence += 1;
        let event = DaemonEvent {
            sequence: store.next_sequence,
            event_type: event_type.to_string(),
            event_type_alias: event_type.to_string(),
            occurred_at_unix_ms: unix_ms(occurred_at),
            payload,
        };
        store.events.push(event.clone());
        event
    }
}

fn unix_ms(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
