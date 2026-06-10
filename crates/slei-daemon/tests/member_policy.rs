use slei_daemon::services::channel_service::{ChannelDraft, ChannelService, WorkspaceMount};
use slei_daemon::services::member_service::{
    AgentDraft, ChannelMemberDraft, MemberService, PermissionPreset,
};
use slei_storage::db::SleiDb;
use slei_storage::repositories::Repositories;
use uuid::Uuid;

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
async fn channel_service_rejects_duplicate_channel_names() {
    let channels = ChannelService::for_tests();

    channels
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

    let error = channels
        .create_channel(
            ChannelDraft {
                name: "#ai咨询".to_string(),
                description: None,
                permission: PermissionPreset::ReadOnly,
            },
            "channel-key-2",
        )
        .await
        .unwrap_err();

    assert!(error.to_string().contains("channel name already exists"));
}

#[tokio::test]
async fn channel_service_rejects_duplicate_workspace_paths() {
    let channels = ChannelService::for_tests();
    let first = channels
        .create_channel(
            ChannelDraft {
                name: "first".to_string(),
                description: None,
                permission: PermissionPreset::ReadOnly,
            },
            "channel-first",
        )
        .await
        .unwrap();
    let second = channels
        .create_channel(
            ChannelDraft {
                name: "second".to_string(),
                description: None,
                permission: PermissionPreset::ReadOnly,
            },
            "channel-second",
        )
        .await
        .unwrap();

    channels
        .mount_workspace(
            &first.id,
            WorkspaceMount {
                path: "/workspace/app".to_string(),
                label: "app".to_string(),
            },
            "mount-first-app",
        )
        .await
        .unwrap();

    let error = channels
        .mount_workspace(
            &second.id,
            WorkspaceMount {
                path: "/workspace/app/".to_string(),
                label: "app".to_string(),
            },
            "mount-second-app",
        )
        .await
        .unwrap_err();

    assert!(error.to_string().contains("workspace path already mounted"));
    assert!(channels.workspaces(&second.id).await.unwrap().is_empty());
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
    assert!(
        channels
            .workspaces(&zero_workspace.id)
            .await
            .unwrap()
            .is_empty()
    );

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
async fn concurrent_channel_member_add_reports_created_once() {
    let channels = ChannelService::for_tests();

    for index in 0..25 {
        let channel = channels
            .create_channel(
                ChannelDraft {
                    name: format!("member-race-{index}"),
                    description: None,
                    permission: PermissionPreset::Controlled,
                },
                &format!("member-race-channel-{index}"),
            )
            .await
            .unwrap();

        let left = channels.clone();
        let right = channels.clone();
        let channel_id = channel.id.clone();
        let (first, second) = tokio::join!(
            left.add_agent_to_channel_with_outcome(&channel.id, "agent_race"),
            right.add_agent_to_channel_with_outcome(&channel_id, "agent_race")
        );
        let first = first.unwrap();
        let second = second.unwrap();

        assert_eq!(first.member.channel_id, second.member.channel_id);
        assert_eq!(first.member.agent_id, second.member.agent_id);
        assert_eq!(
            [first.created, second.created]
                .into_iter()
                .filter(|created| *created)
                .count(),
            1
        );
        assert_eq!(
            channels.channel_members(&channel.id).await.unwrap().len(),
            1
        );
    }
}

#[tokio::test]
async fn channel_service_persists_workspace_mounts() {
    let root = std::env::temp_dir().join(format!("slei-channel-workspaces-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let database_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let db = SleiDb::connect(&database_url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());
    let channels = ChannelService::new(repos.clone());
    let channel = channels
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "channel-dev",
        )
        .await
        .unwrap();
    channels
        .mount_workspace(
            &channel.id,
            WorkspaceMount {
                path: "/workspace/api".to_string(),
                label: "api".to_string(),
            },
            "mount-api",
        )
        .await
        .unwrap();

    let reloaded = ChannelService::new(repos);
    let workspaces = reloaded.workspaces(&channel.id).await.unwrap();
    assert_eq!(
        workspaces,
        vec![WorkspaceMount {
            path: "/workspace/api".to_string(),
            label: "api".to_string(),
        }]
    );
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
