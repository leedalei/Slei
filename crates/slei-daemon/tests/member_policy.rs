use slei_daemon::services::channel_service::{ChannelDraft, ChannelService, WorkspaceMount};
use slei_daemon::services::member_service::{
    AgentDraft, ChannelMemberDraft, MemberService, PermissionPreset,
};

#[tokio::test]
async fn channel_service_rejects_blank_create_idempotency_keys() {
    let channels = ChannelService::for_tests();

    let error = channels
        .create_channel(
            ChannelDraft {
                name: "AI咨询".to_string(),
                description: None,
                permission: PermissionPreset::ReadOnly,
            },
            " \t",
        )
        .await
        .unwrap_err();

    assert!(error.to_string().contains("idempotency-key is required"));
}

#[tokio::test]
async fn member_policy_channels_workspace_mounts_and_agent_members_are_idempotent() {
    let channels = ChannelService::for_tests();
    let members = MemberService::for_tests();

    let zero_workspace = channels
        .create_channel(
            ChannelDraft {
                name: "AI咨询".to_string(),
                description: None,
                permission: PermissionPreset::ReadOnly,
            },
            "channel-key-1",
        )
        .await
        .unwrap();
    let retry = channels
        .create_channel(
            ChannelDraft {
                name: "ignored".to_string(),
                description: None,
                permission: PermissionPreset::Edit,
            },
            "channel-key-1",
        )
        .await
        .unwrap();
    assert_eq!(zero_workspace.id, retry.id);
    assert!(channels
        .workspaces(&zero_workspace.id)
        .await
        .unwrap()
        .is_empty());

    channels
        .mount_workspace(
            &zero_workspace.id,
            WorkspaceMount {
                path: "/workspace/app".to_string(),
                label: "app".to_string(),
            },
            "mount-1",
        )
        .await
        .unwrap();
    channels
        .mount_workspace(
            &zero_workspace.id,
            WorkspaceMount {
                path: "/workspace/shared".to_string(),
                label: "shared".to_string(),
            },
            "mount-2",
        )
        .await
        .unwrap();
    assert_eq!(
        channels.workspaces(&zero_workspace.id).await.unwrap().len(),
        2
    );

    let agent = members
        .create_agent(
            AgentDraft {
                display_name: "Coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "sonnet".to_string(),
                permission: PermissionPreset::Edit,
            },
            "agent-key-1",
        )
        .await
        .unwrap();
    let assigned = members
        .assign_agent(
            &zero_workspace.id,
            ChannelMemberDraft {
                agent_id: agent.id.clone(),
                permission_override: Some(PermissionPreset::ReadOnly),
            },
            "assign-1",
        )
        .await
        .unwrap();

    assert_eq!(assigned.effective_permission, PermissionPreset::ReadOnly);
    assert_eq!(assigned.runtime_kind, "ClaudeCode");
}

#[tokio::test]
async fn member_policy_primary_agent_is_unique_and_permissions_only_narrow() {
    let members = MemberService::for_tests();
    let alice = members
        .create_agent(
            AgentDraft {
                display_name: "Alice".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "sonnet".to_string(),
                permission: PermissionPreset::Edit,
            },
            "agent-alice",
        )
        .await
        .unwrap();
    let coda = members
        .create_agent(
            AgentDraft {
                display_name: "Coda".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "sonnet".to_string(),
                permission: PermissionPreset::ReadOnly,
            },
            "agent-coda",
        )
        .await
        .unwrap();

    let channel_id = "channel_dev";
    members
        .assign_agent(
            channel_id,
            ChannelMemberDraft {
                agent_id: alice.id.clone(),
                permission_override: Some(PermissionPreset::Controlled),
            },
            "assign-alice",
        )
        .await
        .unwrap();
    let coda_member = members
        .assign_agent(
            channel_id,
            ChannelMemberDraft {
                agent_id: coda.id.clone(),
                permission_override: Some(PermissionPreset::Edit),
            },
            "assign-coda",
        )
        .await
        .unwrap();

    assert_eq!(coda_member.effective_permission, PermissionPreset::ReadOnly);

    members
        .set_primary_agent(channel_id, &alice.id)
        .await
        .unwrap();
    members
        .set_primary_agent(channel_id, &coda.id)
        .await
        .unwrap();

    assert_eq!(members.primary_agent(channel_id).await.unwrap(), coda.id);
}
