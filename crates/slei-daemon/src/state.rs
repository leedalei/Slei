use crate::auth::AuthToken;
use crate::services::event_service::EventService;
use crate::services::node_service::NodeService;
use crate::services::workspace_service::WorkspaceService;

#[derive(Clone, Debug)]
pub struct AppState {
    pub auth_token: AuthToken,
    pub daemon_version: &'static str,
    pub protocol_version: &'static str,
    node_service: NodeService,
    workspace_service: WorkspaceService,
    event_service: EventService,
}

impl AppState {
    pub fn for_tests(auth_token: AuthToken) -> Self {
        let event_service = EventService::new();
        Self {
            auth_token,
            daemon_version: env!("CARGO_PKG_VERSION"),
            protocol_version: slei_protocol::PROTOCOL_VERSION,
            node_service: NodeService::for_tests(),
            workspace_service: WorkspaceService::new(event_service.clone()),
            event_service,
        }
    }

    pub fn nodes(&self) -> &NodeService {
        &self.node_service
    }

    pub fn workspaces(&self) -> &WorkspaceService {
        &self.workspace_service
    }

    pub fn events(&self) -> &EventService {
        &self.event_service
    }
}
