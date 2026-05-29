use serde::Serialize;
use std::{
    env,
    process::Command,
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug, Serialize)]
pub struct NodeDto {
    pub id: String,
    pub name: String,
    pub status: String,
    pub daemon_version: &'static str,
    pub device: DeviceMetaDto,
    pub runtimes: Vec<RuntimeReadinessDto>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeReadinessDto {
    pub kind: String,
    pub readiness: String,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DeviceMetaDto {
    pub platform: String,
    pub arch: String,
    pub hostname: String,
}

#[derive(Clone, Debug)]
pub struct NodeService {
    local_node: Arc<Mutex<NodeDto>>,
    guide_agent_created: bool,
    default_channel_created: bool,
}

impl NodeService {
    pub fn for_tests() -> Self {
        Self {
            local_node: Arc::new(Mutex::new(NodeDto {
                id: "local-node".to_string(),
                name: "本机设备".to_string(),
                status: "connected".to_string(),
                daemon_version: env!("CARGO_PKG_VERSION"),
                device: detect_device_meta(),
                runtimes: vec![detect_claude_runtime()],
            })),
            guide_agent_created: false,
            default_channel_created: false,
        }
    }

    pub fn list_nodes(&self) -> Vec<NodeDto> {
        vec![self
            .local_node
            .lock()
            .expect("local node mutex poisoned")
            .clone()]
    }

    pub fn get_node(&self, id: &str) -> Option<NodeDto> {
        let local_node = self.local_node.lock().expect("local node mutex poisoned");
        (local_node.id == id).then(|| local_node.clone())
    }

    pub fn rename_local_node(&self, name: &str) -> Result<NodeDto, NodeRenameError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(NodeRenameError::NameRequired);
        }
        if trimmed.chars().count() > 64 {
            return Err(NodeRenameError::NameTooLong);
        }

        let mut local_node = self.local_node.lock().expect("local node mutex poisoned");
        local_node.name = trimmed.to_string();
        Ok(local_node.clone())
    }

    pub fn set_runtimes_for_tests(&self, runtimes: Vec<RuntimeReadinessDto>) {
        self.local_node
            .lock()
            .expect("local node mutex poisoned")
            .runtimes = runtimes;
    }

    pub fn set_runtime_ready_for_tests(&self, version: &str) {
        self.set_runtimes_for_tests(vec![RuntimeReadinessDto {
            kind: "ClaudeCode".to_string(),
            readiness: "ready".to_string(),
            version: Some(version.to_string()),
        }]);
    }

    pub fn bootstrap_guide_agent(&mut self) -> GuideBootstrap {
        if !self
            .local_node
            .lock()
            .expect("local node mutex poisoned")
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

fn detect_device_meta() -> DeviceMetaDto {
    DeviceMetaDto {
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        hostname: command_output("hostname", &[]).unwrap_or_else(|| "local-device".to_string()),
    }
}

fn detect_claude_runtime() -> RuntimeReadinessDto {
    let version = env::var("SLEI_CLAUDE_VERSION_OVERRIDE")
        .ok()
        .or_else(|| command_output("claude", &["--version"]));

    RuntimeReadinessDto {
        kind: "ClaudeCode".to_string(),
        readiness: if version.is_some() {
            "ready"
        } else {
            "unavailable"
        }
        .to_string(),
        version: version.and_then(|output| parse_claude_version(&output)),
    }
}

fn parse_claude_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|part| part.chars().any(|ch| ch.is_ascii_digit()) && part.contains('.'))
        .map(|part| {
            part.trim_matches(|ch: char| ch == ',' || ch == ';')
                .to_string()
        })
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!stdout.is_empty()).then_some(stdout)
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NodeRenameError {
    NameRequired,
    NameTooLong,
}
