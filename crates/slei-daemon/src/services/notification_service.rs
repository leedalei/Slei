use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotificationRecord {
    pub user_id: String,
    pub task_id: String,
    pub payload: String,
    pub read: bool,
}

#[derive(Clone, Debug, Default)]
pub struct NotificationService {
    inner: Arc<Mutex<HashMap<String, Vec<NotificationRecord>>>>,
}

impl NotificationService {
    pub fn for_tests() -> Self {
        Self::default()
    }

    pub async fn notify_human_attention(&self, task_id: &str, user_id: &str, summary: &str) {
        let sanitized = summary.replace("/workspace/secret", "[redacted]");
        self.inner
            .lock()
            .expect("notification state lock")
            .entry(user_id.to_string())
            .or_default()
            .push(NotificationRecord {
                user_id: user_id.to_string(),
                task_id: task_id.to_string(),
                payload: sanitized,
                read: false,
            });
    }

    pub async fn list_for_user(&self, user_id: &str) -> Vec<NotificationRecord> {
        self.inner
            .lock()
            .expect("notification state lock")
            .get(user_id)
            .cloned()
            .unwrap_or_default()
    }
}
