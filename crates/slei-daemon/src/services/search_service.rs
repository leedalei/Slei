use std::collections::HashMap;

use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::Serialize;
use slei_storage::repositories::{
    AgentRow, AgentSearchRow, ChannelMessageRow, ChannelRow, ChannelSearchRow,
    ConversationMessageSearchRow, Repositories,
};
use thiserror::Error;

const DEFAULT_AGENT_LIMIT: i64 = 20;
const DEFAULT_CHANNEL_LIMIT: i64 = 20;
const DEFAULT_MESSAGE_LIMIT: i64 = 80;
const MAX_AGENT_LIMIT: i64 = 20;
const MAX_CHANNEL_LIMIT: i64 = 20;
const MAX_MESSAGE_LIMIT: i64 = 80;
const SNIPPET_MAX_CHARS: usize = 180;
const DEFAULT_TIME_ZONE: &str = "Asia/Shanghai";

#[derive(Clone, Debug)]
pub struct SearchService {
    repos: Repositories,
}

#[derive(Debug, Clone)]
pub struct GlobalSearchInput {
    pub query: String,
    pub from_id: Option<String>,
    pub channel_id: Option<String>,
    pub time_range: TimeRange,
    pub time_zone: Option<String>,
    pub include_agents: bool,
    pub include_channels: bool,
    pub include_messages: bool,
    pub agent_limit: i64,
    pub channel_limit: i64,
    pub message_limit: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeRange {
    Any,
    Today,
    Last7Days,
    Last30Days,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchResponse {
    pub query: String,
    pub totals: GlobalSearchTotals,
    pub agents: Vec<GlobalAgentSearchResult>,
    pub channels: Vec<GlobalChannelSearchResult>,
    pub messages: Vec<GlobalMessageSearchResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchTotals {
    pub agents: usize,
    pub channels: usize,
    pub messages: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalAgentSearchResult {
    pub kind: String,
    pub agent_id: String,
    pub title: String,
    pub subtitle: String,
    pub avatar_seed: String,
    pub matched_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalChannelSearchResult {
    pub kind: String,
    pub channel_id: String,
    pub title: String,
    pub subtitle: String,
    pub matched_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMessageSearchResult {
    pub kind: String,
    pub source_kind: String,
    pub message_id: String,
    pub channel_id: Option<String>,
    pub conversation_id: Option<String>,
    pub session_id: Option<String>,
    pub author_id: String,
    pub author_name: String,
    pub author_handle: String,
    pub title: String,
    pub source_label: String,
    pub author_label: String,
    pub snippet: String,
    pub created_at: String,
    pub matched_fields: Vec<String>,
}

#[derive(Debug, Error)]
pub enum SearchError {
    #[error("query is required")]
    EmptyQuery,
    #[error("storage error: {0}")]
    Storage(#[from] sqlx::Error),
}

#[derive(Clone, Debug)]
struct AuthorLabel {
    name: String,
    handle: String,
}

impl SearchService {
    pub fn new(repos: Repositories) -> Self {
        Self { repos }
    }

    pub async fn global_search(
        &self,
        input: GlobalSearchInput,
    ) -> Result<GlobalSearchResponse, SearchError> {
        let query = input.query.trim().to_string();
        if query.is_empty() {
            return Err(SearchError::EmptyQuery);
        }

        let from_id = trim_optional(input.from_id);
        let channel_id = trim_optional(input.channel_id);
        let agent_limit = normalize_limit(input.agent_limit, DEFAULT_AGENT_LIMIT, MAX_AGENT_LIMIT);
        let channel_limit = normalize_limit(
            input.channel_limit,
            DEFAULT_CHANNEL_LIMIT,
            MAX_CHANNEL_LIMIT,
        );
        let message_limit = normalize_limit(
            input.message_limit,
            DEFAULT_MESSAGE_LIMIT,
            MAX_MESSAGE_LIMIT,
        );
        let (start_at, end_at) = time_bounds(input.time_range, input.time_zone.as_deref());

        let visible_agents = self.repos.agents().await?;
        let author_labels = author_labels(&visible_agents);
        let agent_rows = self.repos.search_agents(&query, MAX_AGENT_LIMIT).await?;

        let agents = if input.include_agents {
            agent_rows
                .iter()
                .take(agent_limit as usize)
                .map(|row| agent_result(row, &query))
                .collect()
        } else {
            Vec::new()
        };

        let channel_rows = self
            .repos
            .search_channels(&query, MAX_CHANNEL_LIMIT)
            .await?;
        let all_channels = self.repos.channels().await?;
        let channel_titles = channel_titles(&all_channels);
        let channels = if input.include_channels {
            channel_rows
                .iter()
                .take(channel_limit as usize)
                .map(|row| channel_result(row, &query))
                .collect()
        } else {
            Vec::new()
        };

        let mut messages = Vec::new();
        if input.include_messages {
            let channel_messages = self
                .repos
                .search_channel_messages_for_global_search(
                    &query,
                    from_id.as_deref(),
                    channel_id.as_deref(),
                    start_at.as_deref(),
                    end_at.as_deref(),
                    message_limit,
                )
                .await?;
            messages.extend(
                channel_messages.into_iter().map(|row| {
                    channel_message_result(row, &query, &author_labels, &channel_titles)
                }),
            );

            if channel_id.is_none() {
                let dm_messages = self
                    .repos
                    .search_conversation_messages_for_global_search(
                        &query,
                        from_id.as_deref(),
                        start_at.as_deref(),
                        end_at.as_deref(),
                        message_limit,
                    )
                    .await?;
                messages.extend(
                    dm_messages
                        .into_iter()
                        .map(|row| dm_message_result(row, &query, &author_labels)),
                );
            }
            messages.sort_by(|left, right| {
                created_at_epoch(&right.created_at).cmp(&created_at_epoch(&left.created_at))
            });
            messages.truncate(message_limit as usize);
        }

        Ok(GlobalSearchResponse {
            query,
            totals: GlobalSearchTotals {
                agents: agents.len(),
                channels: channels.len(),
                messages: messages.len(),
            },
            agents,
            channels,
            messages,
        })
    }
}

fn agent_result(row: &AgentSearchRow, query: &str) -> GlobalAgentSearchResult {
    GlobalAgentSearchResult {
        kind: "agent".to_string(),
        agent_id: row.id.clone(),
        title: row.name.clone(),
        subtitle: row.handle.clone(),
        avatar_seed: row.avatar_seed.clone(),
        matched_fields: matched_fields(
            query,
            [
                ("name", row.name.as_str()),
                ("handle", row.handle.as_str()),
                ("description", row.description.as_str()),
            ],
        ),
    }
}

fn channel_result(row: &ChannelSearchRow, query: &str) -> GlobalChannelSearchResult {
    GlobalChannelSearchResult {
        kind: "channel".to_string(),
        channel_id: row.id.clone(),
        title: format!("#{}", row.name),
        subtitle: "Channel".to_string(),
        matched_fields: matched_fields(
            query,
            [
                ("name", row.name.as_str()),
                (
                    "description",
                    row.description.as_deref().unwrap_or_default(),
                ),
            ],
        ),
    }
}

fn channel_message_result(
    row: ChannelMessageRow,
    query: &str,
    author_labels: &HashMap<String, AuthorLabel>,
    channel_titles: &HashMap<String, String>,
) -> GlobalMessageSearchResult {
    let body = row.body.unwrap_or_default();
    let author = author_label(author_labels, &row.author_id);
    let source_label = channel_titles
        .get(&row.channel_id)
        .cloned()
        .unwrap_or_else(|| format!("#{}", row.channel_id));
    GlobalMessageSearchResult {
        kind: "message".to_string(),
        source_kind: "channel".to_string(),
        message_id: row.id,
        channel_id: Some(row.channel_id.clone()),
        conversation_id: None,
        session_id: row.session_id,
        author_id: row.author_id,
        author_name: author.name.clone(),
        author_handle: author.handle.clone(),
        title: source_label.clone(),
        source_label,
        author_label: author_display_label(&author),
        snippet: snippet(&body, query),
        created_at: row.created_at,
        matched_fields: vec!["body".to_string()],
    }
}

fn dm_message_result(
    row: ConversationMessageSearchRow,
    query: &str,
    author_labels: &HashMap<String, AuthorLabel>,
) -> GlobalMessageSearchResult {
    let author = author_label(author_labels, &row.author_id);
    let title = row
        .conversation_id
        .strip_prefix("dm:")
        .and_then(|agent_id| author_labels.get(agent_id))
        .map(|label| label.name.clone())
        .unwrap_or_else(|| row.conversation_id.clone());
    let source_label = title.clone();
    GlobalMessageSearchResult {
        kind: "message".to_string(),
        source_kind: "dm".to_string(),
        message_id: row.id,
        channel_id: None,
        conversation_id: Some(row.conversation_id),
        session_id: row.session_id,
        author_id: row.author_id,
        author_name: author.name.clone(),
        author_handle: author.handle.clone(),
        title,
        source_label,
        author_label: author_display_label(&author),
        snippet: snippet(&row.body, query),
        created_at: row.created_at,
        matched_fields: vec!["body".to_string()],
    }
}

fn author_labels(agent_rows: &[AgentRow]) -> HashMap<String, AuthorLabel> {
    let mut labels = HashMap::from([(
        "human:local".to_string(),
        AuthorLabel {
            name: "Me".to_string(),
            handle: "@me".to_string(),
        },
    )]);
    for row in agent_rows {
        if row.system_owned || row.agent_kind == "internal" {
            continue;
        }
        labels.insert(
            row.id.clone(),
            AuthorLabel {
                name: row.name.clone(),
                handle: row.handle.clone(),
            },
        );
    }
    labels
}

fn author_label(author_labels: &HashMap<String, AuthorLabel>, author_id: &str) -> AuthorLabel {
    author_labels
        .get(author_id)
        .cloned()
        .unwrap_or_else(|| AuthorLabel {
            name: author_id.to_string(),
            handle: String::new(),
        })
}

fn author_display_label(author: &AuthorLabel) -> String {
    if author.handle.trim().is_empty() {
        author.name.clone()
    } else {
        format!("{} {}", author.name, author.handle)
    }
}

fn channel_titles(channel_rows: &[ChannelRow]) -> HashMap<String, String> {
    channel_rows
        .iter()
        .map(|row| (row.id.clone(), format!("#{}", row.name)))
        .collect()
}

fn matched_fields<'a>(
    query: &str,
    fields: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Vec<String> {
    fields
        .into_iter()
        .filter(|(_, value)| contains_case_insensitive(value, query))
        .map(|(name, _)| name.to_string())
        .collect()
}

fn snippet(body: &str, query: &str) -> String {
    let total_chars = body.chars().count();
    if total_chars <= SNIPPET_MAX_CHARS {
        return body.to_string();
    }

    let match_pos = find_case_insensitive_char_pos(body, query).unwrap_or(0);
    let start = if total_chars <= SNIPPET_MAX_CHARS {
        0
    } else {
        match_pos
            .saturating_sub(60)
            .min(total_chars - SNIPPET_MAX_CHARS)
    };
    body.chars().skip(start).take(SNIPPET_MAX_CHARS).collect()
}

fn find_case_insensitive_char_pos(body: &str, query: &str) -> Option<usize> {
    let query = query.to_lowercase();
    body.char_indices().find_map(|(byte_index, _)| {
        body[byte_index..]
            .to_lowercase()
            .starts_with(&query)
            .then(|| body[..byte_index].chars().count())
    })
}

fn contains_case_insensitive(value: &str, query: &str) -> bool {
    value.to_lowercase().contains(&query.to_lowercase())
}

fn normalize_limit(value: i64, default: i64, max: i64) -> i64 {
    if value <= 0 {
        default
    } else {
        value.min(max)
    }
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn time_bounds(range: TimeRange, time_zone: Option<&str>) -> (Option<String>, Option<String>) {
    if range == TimeRange::Any {
        return (None, None);
    }
    let tz = time_zone
        .and_then(|value| value.parse::<Tz>().ok())
        .unwrap_or(chrono_tz::Asia::Shanghai);
    let today = Utc::now().with_timezone(&tz).date_naive();
    let start_date = match range {
        TimeRange::Any => today,
        TimeRange::Today => today,
        TimeRange::Last7Days => today - Duration::days(6),
        TimeRange::Last30Days => today - Duration::days(29),
    };
    let end_date = today + Duration::days(1);
    let start = local_midnight_utc(tz, start_date.and_hms_opt(0, 0, 0).unwrap());
    let end = local_midnight_utc(tz, end_date.and_hms_opt(0, 0, 0).unwrap()) - Duration::seconds(1);
    (
        Some(start.timestamp().to_string()),
        Some(end.timestamp().to_string()),
    )
}

fn local_midnight_utc(tz: Tz, local: NaiveDateTime) -> DateTime<Utc> {
    match tz.from_local_datetime(&local) {
        LocalResult::Single(value) => value.with_timezone(&Utc),
        LocalResult::Ambiguous(earliest, _) => earliest.with_timezone(&Utc),
        LocalResult::None => tz
            .from_local_datetime(&(local + Duration::hours(1)))
            .earliest()
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
    }
}

fn created_at_epoch(value: &str) -> i64 {
    if let Ok(epoch) = value.parse::<i64>() {
        return epoch;
    }
    if let Ok(datetime) = DateTime::parse_from_rfc3339(value) {
        return datetime.timestamp();
    }
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map(|datetime| datetime.and_utc().timestamp())
        .unwrap_or_default()
}

pub fn default_time_zone() -> &'static str {
    DEFAULT_TIME_ZONE
}

#[cfg(test)]
mod tests {
    use super::*;
    use slei_storage::db::SleiDb;
    use slei_storage::repositories::NewChannelMessageRow;
    use uuid::Uuid;

    #[tokio::test]
    async fn today_search_excludes_message_at_next_day_midnight() {
        let (url, _path) = sqlite_file_url("search-service-today-boundary");
        let db = SleiDb::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        repos
            .upsert_channel("dev-team", "dev-team", None, false, "Controlled")
            .await
            .unwrap();

        for (id, body) in [
            ("msg_inside_today", "needle inside today"),
            ("msg_next_midnight", "needle next midnight"),
        ] {
            repos
                .insert_channel_message(NewChannelMessageRow {
                    id: id.to_string(),
                    channel_id: "dev-team".to_string(),
                    session_id: Some("session_dev_today".to_string()),
                    author_id: "human:local".to_string(),
                    body: Some(body.to_string()),
                    as_task: false,
                    kind: "human".to_string(),
                })
                .await
                .unwrap();
        }

        let today = Utc::now().date_naive();
        let inside_today = today
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let next_midnight = (today + Duration::days(1))
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        sqlx::query("UPDATE messages SET created_at = ? WHERE id = ?")
            .bind(inside_today)
            .bind("msg_inside_today")
            .execute(db.pool())
            .await
            .unwrap();
        sqlx::query("UPDATE messages SET created_at = ? WHERE id = ?")
            .bind(next_midnight)
            .bind("msg_next_midnight")
            .execute(db.pool())
            .await
            .unwrap();

        let result = SearchService::new(repos)
            .global_search(GlobalSearchInput {
                query: "needle".to_string(),
                from_id: None,
                channel_id: Some("dev-team".to_string()),
                time_range: TimeRange::Today,
                time_zone: Some("UTC".to_string()),
                include_agents: false,
                include_channels: false,
                include_messages: true,
                agent_limit: 20,
                channel_limit: 20,
                message_limit: 80,
            })
            .await
            .unwrap();

        let message_ids = result
            .messages
            .iter()
            .map(|message| message.message_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(message_ids, vec!["msg_inside_today"]);
    }

    fn sqlite_file_url(name: &str) -> (String, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("slei-{name}-{}.sqlite", Uuid::new_v4()));
        (format!("sqlite://{}", path.display()), path)
    }
}
