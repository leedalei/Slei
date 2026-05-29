use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::services::settings_service::SettingsService;

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
    settings: Option<SettingsService>,
}

impl NotificationService {
    pub fn for_tests() -> Self {
        Self::default()
    }

    pub fn for_tests_with_settings(settings: SettingsService) -> Self {
        Self {
            inner: Arc::default(),
            settings: Some(settings),
        }
    }

    pub async fn notify_human_attention(&self, task_id: &str, user_id: &str, summary: &str) {
        if !self.notification_enabled(NotificationKind::Approvals).await {
            return;
        }
        self.push(task_id, user_id, summary).await;
    }

    pub async fn notify_mention(&self, task_id: &str, user_id: &str, summary: &str) {
        if !self.notification_enabled(NotificationKind::Mentions).await {
            return;
        }
        self.push(task_id, user_id, summary).await;
    }

    pub async fn notify_human_reply(&self, task_id: &str, user_id: &str, summary: &str) {
        if !self
            .notification_enabled(NotificationKind::HumanReplies)
            .await
        {
            return;
        }
        self.push(task_id, user_id, summary).await;
    }

    pub async fn list_for_user(&self, user_id: &str) -> Vec<NotificationRecord> {
        self.inner
            .lock()
            .expect("notification state lock")
            .get(user_id)
            .cloned()
            .unwrap_or_default()
    }

    async fn push(&self, task_id: &str, user_id: &str, summary: &str) {
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

    async fn notification_enabled(&self, kind: NotificationKind) -> bool {
        let Some(settings) = &self.settings else {
            return true;
        };
        let preferences = settings.preferences().await.notifications;
        match kind {
            NotificationKind::Mentions => preferences.mentions,
            NotificationKind::HumanReplies => preferences.human_replies,
            NotificationKind::Approvals => preferences.approvals,
        }
    }
}

enum NotificationKind {
    Mentions,
    HumanReplies,
    Approvals,
}
