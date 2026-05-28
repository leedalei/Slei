use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct NodeDto {
    pub id: String,
    pub name: String,
    pub status: String,
    pub daemon_version: &'static str,
    pub runtimes: Vec<RuntimeReadinessDto>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeReadinessDto {
    pub kind: String,
    pub readiness: String,
}

#[derive(Clone, Debug)]
pub struct NodeService {
    local_node: NodeDto,
    guide_agent_created: bool,
    default_channel_created: bool,
}

impl NodeService {
    pub fn for_tests() -> Self {
        Self {
            local_node: NodeDto {
                id: "local-node".to_string(),
                name: "Local Computer".to_string(),
                status: "connected".to_string(),
                daemon_version: env!("CARGO_PKG_VERSION"),
                runtimes: vec![RuntimeReadinessDto {
                    kind: "ClaudeCode".to_string(),
                    readiness: "unknown".to_string(),
                }],
            },
            guide_agent_created: false,
            default_channel_created: false,
        }
    }

    pub fn list_nodes(&self) -> Vec<NodeDto> {
        vec![self.local_node.clone()]
    }

    pub fn get_node(&self, id: &str) -> Option<NodeDto> {
        (self.local_node.id == id).then(|| self.local_node.clone())
    }

    pub fn set_runtimes_for_tests(&mut self, runtimes: Vec<RuntimeReadinessDto>) {
        self.local_node.runtimes = runtimes;
    }

    pub fn bootstrap_guide_agent(&mut self) -> GuideBootstrap {
        if !self
            .local_node
            .runtimes
            .iter()
            .any(|runtime| runtime.kind == "ClaudeCode" && runtime.readiness == "ready")
        {
            return GuideBootstrap::RuntimeUnavailable;
        }

        if self.guide_agent_created && self.default_channel_created {
            return GuideBootstrap::AlreadyExists {
                agent_id: "agent_guide".to_string(),
                channel_id: "channel_all".to_string(),
            };
        }

        self.guide_agent_created = true;
        self.default_channel_created = true;
        GuideBootstrap::Created {
            agent_id: "agent_guide".to_string(),
            channel_id: "channel_all".to_string(),
        }
    }

    pub fn guide_agent_count(&self) -> usize {
        usize::from(self.guide_agent_created)
    }

    pub fn default_channel_count(&self) -> usize {
        usize::from(self.default_channel_created)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GuideBootstrap {
    RuntimeUnavailable,
    Created {
        agent_id: String,
        channel_id: String,
    },
    AlreadyExists {
        agent_id: String,
        channel_id: String,
    },
}
