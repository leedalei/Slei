use std::fs;
use std::path::{Path, PathBuf};

use crate::services::channel_service::{ChannelError, ChannelMemberReadiness, ChannelService};
use crate::services::member_service::{MemberError, MemberService, ProductAgentRecord};
use crate::services::memory_event_service::MemoryEventService;
use crate::services::message_service::MessageError;

#[derive(Clone, Debug)]
pub struct MemoryMaintainerService {
    members: MemberService,
    channels: ChannelService,
    memory_events: MemoryEventService,
}

impl MemoryMaintainerService {
    pub fn new(
        members: MemberService,
        channels: ChannelService,
        memory_events: MemoryEventService,
    ) -> Self {
        Self {
            members,
            channels,
            memory_events,
        }
    }

    pub async fn run_pending_channel_join_updates(
        &self,
        channel_id: &str,
    ) -> Result<Vec<String>, MemoryMaintainerError> {
        let members = self.channels.channel_members(channel_id).await?;
        let mut completed = Vec::new();
        for member in members
            .iter()
            .filter(|member| member.readiness == ChannelMemberReadiness::Joining)
        {
            self.memory_events
                .start_update(&member.agent_id, channel_id)
                .await;
            self.channels
                .set_member_readiness(
                    channel_id,
                    &member.agent_id,
                    ChannelMemberReadiness::MemorySyncing,
                )
                .await?;
            match self
                .update_agent_channel_notes(&member.agent_id, channel_id)
                .await
            {
                Ok(()) => {
                    self.memory_events
                        .complete_update(&member.agent_id, channel_id)
                        .await;
                    completed.push(member.agent_id.clone());
                }
                Err(error) => {
                    self.memory_events
                        .fail_update(&member.agent_id, channel_id)
                        .await;
                    self.channels
                        .set_member_readiness(
                            channel_id,
                            &member.agent_id,
                            ChannelMemberReadiness::MemoryFailed,
                        )
                        .await?;
                    return Err(error);
                }
            }
        }
        Ok(completed)
    }

    pub async fn sync_added_channel_member(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<(), MemoryMaintainerError> {
        self.memory_events
            .request_channel_join_update(agent_id, channel_id)
            .await;
        self.memory_events.start_update(agent_id, channel_id).await;
        self.channels
            .set_member_readiness(channel_id, agent_id, ChannelMemberReadiness::MemorySyncing)
            .await?;
        match self.update_agent_channel_notes(agent_id, channel_id).await {
            Ok(()) => {
                self.memory_events
                    .complete_update(agent_id, channel_id)
                    .await;
                Ok(())
            }
            Err(error) => {
                self.memory_events.fail_update(agent_id, channel_id).await;
                self.channels
                    .set_member_readiness(
                        channel_id,
                        agent_id,
                        ChannelMemberReadiness::MemoryFailed,
                    )
                    .await?;
                Err(error)
            }
        }
    }

    pub async fn sync_removed_channel_member(
        &self,
        channel_id: &str,
        removed_agent_id: &str,
    ) -> Result<(), MemoryMaintainerError> {
        self.memory_events
            .start_update(removed_agent_id, channel_id)
            .await;
        self.update_agent_channel_notes(removed_agent_id, channel_id)
            .await?;
        self.memory_events
            .complete_update(removed_agent_id, channel_id)
            .await;

        let remaining_members = self.channels.channel_members(channel_id).await?;
        for member in remaining_members {
            self.memory_events
                .start_update(&member.agent_id, channel_id)
                .await;
            self.update_agent_channel_notes(&member.agent_id, channel_id)
                .await?;
            self.memory_events
                .complete_update(&member.agent_id, channel_id)
                .await;
        }
        Ok(())
    }

    async fn update_agent_channel_notes(
        &self,
        agent_id: &str,
        channel_id: &str,
    ) -> Result<(), MemoryMaintainerError> {
        let agent = self.members.get_product_agent(agent_id).await?;
        let workspace = PathBuf::from(&agent.workspace_path);
        let memory_path = PathBuf::from(&agent.memory_path);
        let notes_dir = workspace.join("notes");
        let channels_path = notes_dir.join("channels.md");
        let relationships_path = notes_dir.join("relationships.md");

        if !memory_path.starts_with(&workspace)
            || !channels_path.starts_with(&workspace)
            || !relationships_path.starts_with(&workspace)
        {
            return Err(MemoryMaintainerError::WorkspaceBoundary);
        }

        fs::create_dir_all(&notes_dir).map_err(MemoryMaintainerError::Io)?;
        self.ensure_memory_links(&memory_path)?;
        self.write_channel_notes(&channels_path, channel_id).await?;
        self.write_relationship_notes(&relationships_path, &agent, channel_id)
            .await?;

        self.memory_events
            .record_document_touch(agent_id, channel_id, "MEMORY.md", "Channel Notes")
            .await;
        self.memory_events
            .record_document_touch(agent_id, channel_id, "notes/channels.md", channel_id)
            .await;
        self.memory_events
            .record_document_touch(
                agent_id,
                channel_id,
                "notes/relationships.md",
                "Acceptance Rule",
            )
            .await;
        Ok(())
    }

    fn ensure_memory_links(&self, memory_path: &Path) -> Result<(), MemoryMaintainerError> {
        let mut memory = fs::read_to_string(memory_path).map_err(MemoryMaintainerError::Io)?;
        let mut additions = Vec::new();
        if !memory.contains("notes/channels.md") {
            additions.push("- [Channel notes](notes/channels.md)");
        }
        if !memory.contains("notes/relationships.md") {
            additions.push("- [Relationship notes](notes/relationships.md)");
        }
        if additions.is_empty() {
            return Ok(());
        }

        if !memory.ends_with('\n') {
            memory.push('\n');
        }
        if !memory.contains("## Maintained Notes") {
            memory.push_str("\n## Maintained Notes\n");
        }
        for addition in additions {
            memory.push_str(addition);
            memory.push('\n');
        }
        fs::write(memory_path, memory).map_err(MemoryMaintainerError::Io)
    }

    async fn write_channel_notes(
        &self,
        path: &Path,
        channel_id: &str,
    ) -> Result<(), MemoryMaintainerError> {
        let members = self.channels.channel_members(channel_id).await?;
        let mut roster = Vec::new();
        for member in members {
            match self.members.get_product_agent(&member.agent_id).await {
                Ok(agent) => roster.push(format!(
                    "- {} ({}) — {}",
                    agent.handle, agent.name, agent.description
                )),
                Err(_) => roster.push(format!("- {} — channel member", member.agent_id)),
            }
        }
        roster.sort();

        let content = format!(
            "# Channel Notes\n\n## #{channel_id}\n- Channel id: {channel_id}\n- Roster:\n{}\n",
            roster.join("\n")
        );
        fs::write(path, content).map_err(MemoryMaintainerError::Io)
    }

    async fn write_relationship_notes(
        &self,
        path: &Path,
        agent: &ProductAgentRecord,
        channel_id: &str,
    ) -> Result<(), MemoryMaintainerError> {
        let content = format!(
            "# Relationship Notes\n\n## {name} in #{channel_id}\n- Self: {handle} — {description}\n- User: @lei-lee — 人类用户，项目发起人\n- Relationship hint: use the channel roster in notes/channels.md before assuming responsibility.\n\n## Handoff Rule\nAfter finishing the current stage, decide from the current context and channel roster whether another member should take over. If so, visibly @ that member. If no handoff is needed, @ the current user for acceptance/review.\n\n## Acceptance Rule\nIf this Agent is unsure, has no relevant relationship, or the task appears complete, notify the user for 验收 / acceptance.\n",
            name = agent.name,
            handle = agent.handle,
            description = agent.description,
        );
        fs::write(path, content).map_err(MemoryMaintainerError::Io)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MemoryMaintainerError {
    #[error(transparent)]
    Channel(#[from] ChannelError),
    #[error(transparent)]
    Member(#[from] MemberError),
    #[error("agent memory path is outside workspace")]
    WorkspaceBoundary,
    #[error("memory maintainer io error: {0}")]
    Io(std::io::Error),
    #[error(transparent)]
    Message(#[from] MessageError),
}
