use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum PermissionPreset {
    ReadOnly,
    Edit,
    Controlled,
}

pub fn effective_permission(
    channel_permission: PermissionPreset,
    agent_override: Option<PermissionPreset>,
) -> PermissionPreset {
    match agent_override {
        Some(override_permission) => channel_permission.min(override_permission),
        None => channel_permission,
    }
}
