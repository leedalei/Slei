//! Domain entities and state transitions for Slei.

pub mod entities;
pub mod mentions;
pub mod permissions;
pub mod run;
pub mod task;

#[cfg(test)]
mod tests {
    use super::entities::{Message, MessageBody, MessageKind};
    use super::mentions::{parse_mentions, MentionTarget};
    use super::permissions::{effective_permission, PermissionPreset};
    use super::run::{transition_run, RunStatus};
    use super::task::{transition_task, TaskStatus};

    #[test]
    fn task_status_allows_delivery_and_cancellation_paths() {
        assert_eq!(
            transition_task(TaskStatus::Todo, TaskStatus::InProgress).unwrap(),
            TaskStatus::InProgress
        );
        assert_eq!(
            transition_task(TaskStatus::InProgress, TaskStatus::InReview).unwrap(),
            TaskStatus::InReview
        );
        assert_eq!(
            transition_task(TaskStatus::InReview, TaskStatus::Done).unwrap(),
            TaskStatus::Done
        );
        assert_eq!(
            transition_task(TaskStatus::Done, TaskStatus::Closed).unwrap(),
            TaskStatus::Closed
        );
        assert!(transition_task(TaskStatus::Done, TaskStatus::Todo).is_err());
    }

    #[test]
    fn run_status_models_approval_and_terminal_states() {
        assert_eq!(
            transition_run(RunStatus::Queued, RunStatus::Running).unwrap(),
            RunStatus::Running
        );
        assert_eq!(
            transition_run(RunStatus::Running, RunStatus::WaitingApproval).unwrap(),
            RunStatus::WaitingApproval
        );
        assert_eq!(
            transition_run(RunStatus::WaitingApproval, RunStatus::Rejected).unwrap(),
            RunStatus::Rejected
        );
        assert!(transition_run(RunStatus::Completed, RunStatus::Running).is_err());
    }

    #[test]
    fn deleting_human_message_removes_recoverable_body() {
        let message = Message::human_text("hello secret");
        let deleted = message.delete_to_tombstone().unwrap();
        assert!(deleted.deleted);
        assert_eq!(deleted.body, MessageBody::Tombstone);
        assert_eq!(deleted.kind, MessageKind::Tombstone);
        assert!(!format!("{deleted:?}").contains("hello secret"));
    }

    #[test]
    fn agent_permission_override_can_only_narrow_channel_access() {
        assert_eq!(
            effective_permission(PermissionPreset::Controlled, Some(PermissionPreset::ReadOnly)),
            PermissionPreset::ReadOnly
        );
        assert_eq!(
            effective_permission(PermissionPreset::ReadOnly, Some(PermissionPreset::Controlled)),
            PermissionPreset::ReadOnly
        );
        assert_eq!(
            effective_permission(PermissionPreset::Edit, None),
            PermissionPreset::Edit
        );
    }

    #[test]
    fn mention_parser_resolves_agents_and_humans_by_stable_handles() {
        let mentions = parse_mentions("please ask @alice and @coda-win", |handle| match handle {
            "alice" => Some(MentionTarget::Human),
            "coda-win" => Some(MentionTarget::Agent),
            _ => None,
        });

        assert_eq!(mentions.len(), 2);
        assert_eq!(mentions[0].handle, "alice");
        assert_eq!(mentions[0].target, MentionTarget::Human);
        assert_eq!(mentions[1].handle, "coda-win");
        assert_eq!(mentions[1].target, MentionTarget::Agent);
    }
}
