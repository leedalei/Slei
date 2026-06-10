use crate::services::member_service::{MemberError, MemberService};
use crate::services::message_service::{MessageError, MessageRecord, MessageService};

#[derive(Clone, Debug)]
pub struct ChannelJoinReportService {
    members: MemberService,
    messages: MessageService,
}

impl ChannelJoinReportService {
    pub fn new(members: MemberService, messages: MessageService) -> Self {
        Self { members, messages }
    }

    pub async fn create_join_report(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<MessageRecord, ChannelJoinReportError> {
        let agent = self.members.get_product_agent(agent_id).await?;
        let body = format!(
            "我是 {name}（{handle}），负责：{description}。需要我协作时请直接 mention {handle}。",
            name = agent.name,
            handle = agent.handle,
            description = agent.description,
        );
        Ok(self
            .messages
            .create_agent_channel_message(channel_id, agent_id, &body)
            .await?)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelJoinReportError {
    #[error(transparent)]
    Member(#[from] MemberError),
    #[error(transparent)]
    Message(#[from] MessageError),
}
