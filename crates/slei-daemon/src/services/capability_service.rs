use std::sync::Arc;

use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapabilitySource {
    WorkspaceClaude,
    GlobalClaude,
    Runtime,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityRecord {
    pub agent_id: String,
    pub name: String,
    pub source: CapabilitySource,
    pub description: String,
    pub available: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct CapabilityService {
    inner: Arc<Mutex<Vec<CapabilityRecord>>>,
}

impl CapabilityService {
    pub fn for_tests(capabilities: Vec<CapabilityRecord>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(capabilities)),
        }
    }

    pub async fn list_for_agent(&self, agent_id: &str) -> Vec<CapabilityRecord> {
        let mut capabilities = self
            .inner
            .lock()
            .await
            .iter()
            .filter(|capability| capability.agent_id == agent_id)
            .cloned()
            .collect::<Vec<_>>();
        capabilities.sort_by(|left, right| left.name.cmp(&right.name));
        capabilities
    }

    pub async fn record_scan_error(&self, agent_id: &str, error: &str) {
        self.inner.lock().await.push(CapabilityRecord {
            agent_id: agent_id.to_string(),
            name: "workspace scan".to_string(),
            source: CapabilitySource::WorkspaceClaude,
            description: "Workspace capability scan failed".to_string(),
            available: false,
            error: Some(error.to_string()),
        });
    }
}

#[derive(Clone, Debug, Default)]
pub struct CapabilityApiPolicy;

impl CapabilityApiPolicy {
    pub fn read_only() -> Self {
        Self
    }

    pub fn supported_actions(&self) -> Vec<&'static str> {
        vec!["list"]
    }
}
