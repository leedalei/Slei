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
        }
    }

    pub fn list_nodes(&self) -> Vec<NodeDto> {
        vec![self.local_node.clone()]
    }

    pub fn get_node(&self, id: &str) -> Option<NodeDto> {
        (self.local_node.id == id).then(|| self.local_node.clone())
    }
}
