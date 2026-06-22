use serde::Serialize;

#[derive(Clone, Debug)]
pub struct DiagnosticsInput {
    pub node_name: String,
    pub runtime: String,
    pub worker: String,
    pub protocol_version: String,
    pub schema_version: String,
    pub recent_failure: Option<String>,
    pub agent_inbox_event_count: u64,
    pub memory_update_event_count: u64,
    pub recent_events: Vec<DiagnosticEvent>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub node: String,
    pub runtime: String,
    pub worker: String,
    pub protocol_version: String,
    pub schema_version: String,
    pub failure_summary: Option<String>,
    pub agent_inbox_event_count: u64,
    pub memory_update_event_count: u64,
    pub recent_events: Vec<DiagnosticEvent>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub sequence: u64,
    pub event_type: String,
    pub entity_id: String,
    pub payload: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Default)]
pub struct DiagnosticsService;

impl DiagnosticsService {
    pub fn for_tests() -> Self {
        Self
    }

    pub async fn snapshot(&self, input: DiagnosticsInput) -> DiagnosticsSnapshot {
        DiagnosticsSnapshot {
            node: input.node_name,
            runtime: input.runtime,
            worker: input.worker,
            protocol_version: input.protocol_version,
            schema_version: input.schema_version,
            failure_summary: input.recent_failure.map(|failure| sanitize(&failure)),
            agent_inbox_event_count: input.agent_inbox_event_count,
            memory_update_event_count: input.memory_update_event_count,
            recent_events: input
                .recent_events
                .into_iter()
                .map(|event| DiagnosticEvent {
                    sequence: event.sequence,
                    event_type: event.event_type,
                    entity_id: event.entity_id,
                    payload: sanitize(&event.payload),
                    created_at: event.created_at,
                })
                .collect(),
        }
    }

    pub async fn export_logs(&self, events: Vec<DiagnosticEvent>) -> String {
        events
            .into_iter()
            .map(|event| {
                format!(
                    "#{} {} {}",
                    event.sequence,
                    event.event_type,
                    sanitize(&event.payload)
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn sanitize(input: &str) -> String {
    let mut output = redact_token(input);
    output = redact_absolute_paths(&output);
    output = redact_key_until_space(&output, "body=", "[redacted-body]");
    output = redact_key_to_end(&output, "output_delta=", "[redacted-output]");
    output
}

fn redact_token(input: &str) -> String {
    let output = redact_key_until_space(input, "token=", "[redacted-token]");
    redact_key_until_space(&output, "Bearer ", "[redacted-token]")
}

fn redact_absolute_paths(input: &str) -> String {
    let mut output = input.to_string();
    while let Some(start) = output.find("/Users/") {
        let end = output[start..]
            .find(char::is_whitespace)
            .map(|offset| start + offset)
            .unwrap_or(output.len());
        output.replace_range(start..end, "[redacted-path]");
    }
    output
}

fn redact_key_until_space(input: &str, key: &str, replacement: &str) -> String {
    let mut output = String::new();
    let mut rest = input;
    while let Some(start) = rest.find(key) {
        output.push_str(&rest[..start + key.len()]);
        output.push_str(replacement);
        let value = &rest[start + key.len()..];
        let value_end = value.find(char::is_whitespace).unwrap_or(value.len());
        rest = &value[value_end..];
    }
    output.push_str(rest);
    output
}

fn redact_key_to_end(input: &str, key: &str, replacement: &str) -> String {
    if let Some(start) = input.find(key) {
        let value_start = start + key.len();
        let mut output = input.to_string();
        output.replace_range(value_start.., replacement);
        output
    } else {
        input.to_string()
    }
}
