use std::fs;
use std::path::PathBuf;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use slei_storage::repositories::{NewChannelMessageRow, Repositories};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn global_search_rejects_empty_query() {
    let token = AuthToken::from_static("search-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let response = get_json(&app, &token, "/v1/search/global?query=%20").await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn global_search_requires_authorization() {
    let token = AuthToken::from_static("search-token");
    let app = build_router(AppState::for_tests(token));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/search/global?query=needle")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn global_search_conflicts_during_reset() {
    let token = AuthToken::from_static("search-token");
    let state = AppState::for_tests(token.clone());
    let reset_guard = state.reset().runtime().begin_reset().await.unwrap();
    let app = build_router(state);

    let response = get_json(&app, &token, "/v1/search/global?query=needle").await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = response_json(response).await;
    assert_eq!(
        body["error"],
        "reset in progress; runtime launches are temporarily disabled"
    );
    reset_guard.finish().await;
}

#[tokio::test]
async fn global_search_returns_agents_channels_and_messages() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-all");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state);

    let coda_id = create_agent(&app, &token, "Coda", "@coda", "needle runtime engineer").await;
    let channel_id = create_channel(
        &app,
        &token,
        "dev-team",
        Some("needle engineering channel"),
        "create-dev-team",
    )
    .await;
    let channel_message_id = send_channel_message(
        &app,
        &token,
        &channel_id,
        &coda_id,
        "channel body with needle inside",
        "send-channel-needle",
    )
    .await;
    let conversation_id = create_dm(&app, &token, &coda_id, "dm-coda").await;
    let dm_message_id = send_dm_message(
        &app,
        &token,
        &conversation_id,
        &coda_id,
        "dm body with needle inside",
        "send-dm-needle",
    )
    .await;

    let response = get_json(&app, &token, "/v1/search/global?query=needle").await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["query"], "needle");
    assert_eq!(body["agents"][0]["agentId"], coda_id);
    assert_eq!(body["channels"][0]["channelId"], channel_id);
    let messages = body["messages"].as_array().unwrap();
    assert!(messages.iter().any(|message| {
        message["sourceKind"] == "channel"
            && message["messageId"] == channel_message_id
            && message["channelId"] == channel_id
    }));
    assert!(messages.iter().any(|message| {
        message["sourceKind"] == "dm"
            && message["messageId"] == dm_message_id
            && message["conversationId"] == conversation_id
    }));
}

#[tokio::test]
async fn global_search_query_timezone_overrides_saved_preference() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-timezone");
    let database_url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let pool = sqlx::SqlitePool::connect(&database_url).await.unwrap();
    state
        .settings()
        .set_time_zone("Pacific/Kiritimati".to_string())
        .await
        .unwrap();
    let repos = state.orchestration().repos();
    repos
        .upsert_channel("dev-team", "dev-team", None, false, "Controlled")
        .await
        .unwrap();
    let utc_today = Utc::now().date_naive();
    let utc_start = utc_midnight(utc_today);
    let utc_end = utc_start + Duration::days(1) - Duration::seconds(1);
    let preference_start = local_midnight_utc(
        chrono_tz::Pacific::Kiritimati,
        Utc::now()
            .with_timezone(&chrono_tz::Pacific::Kiritimati)
            .date_naive(),
    );
    let preference_end = preference_start + Duration::days(1) - Duration::seconds(1);
    let created_at = if utc_start < preference_start {
        utc_start + Duration::hours(1)
    } else {
        utc_end - Duration::hours(1)
    };
    assert!(
        created_at >= utc_start && created_at <= utc_end,
        "fixture should be inside UTC today"
    );
    assert!(
        created_at < preference_start || created_at > preference_end,
        "fixture should be outside saved preference today"
    );
    insert_channel_message_at(
        &repos,
        &pool,
        "msg_timezone_override",
        "dev-team",
        "needle timezone override",
        created_at,
    )
    .await;
    let app = build_router(state);

    let response = get_json(
        &app,
        &token,
        "/v1/search/global?query=needle&timeRange=today&timeZone=UTC",
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let ids = message_ids(&body);
    assert_eq!(ids, vec!["msg_timezone_override"]);
}

#[tokio::test]
async fn global_search_clamps_result_limits() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-limits");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let repos = state.orchestration().repos();

    for index in 0..25 {
        upsert_agent_for_search(
            &repos,
            &format!("agent_visible_{index:02}"),
            &format!("Needle Agent {index:02}"),
            &format!("@needle-agent-{index:02}"),
            "agent",
            false,
        )
        .await;
        repos
            .upsert_channel(
                &format!("channel_visible_{index:02}"),
                &format!("needle-channel-{index:02}"),
                Some("needle channel"),
                false,
                "Controlled",
            )
            .await
            .unwrap();
    }
    repos
        .upsert_channel(
            "message-limit-channel",
            "message-limit-channel",
            None,
            false,
            "Controlled",
        )
        .await
        .unwrap();
    for index in 0..85 {
        insert_channel_message(
            &repos,
            &format!("msg_limit_{index:03}"),
            "message-limit-channel",
            &format!("needle message {index:03}"),
        )
        .await;
    }
    let app = build_router(state);

    let response = get_json(
        &app,
        &token,
        "/v1/search/global?query=needle&agentLimit=500&channelLimit=500&messageLimit=500",
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["agents"].as_array().unwrap().len(), 20);
    assert_eq!(body["channels"].as_array().unwrap().len(), 20);
    assert_eq!(body["messages"].as_array().unwrap().len(), 80);
}

#[tokio::test]
async fn global_search_message_snippets_are_capped_at_180_chars() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-snippet");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let repos = state.orchestration().repos();
    repos
        .upsert_channel("dev-team", "dev-team", None, false, "Controlled")
        .await
        .unwrap();
    let body = format!("{} needle {}", "a".repeat(220), "b".repeat(220));
    insert_channel_message(&repos, "msg_long_snippet", "dev-team", &body).await;
    let app = build_router(state);

    let response = get_json(&app, &token, "/v1/search/global?query=needle").await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let snippet = body["messages"][0]["snippet"].as_str().unwrap();
    assert!(snippet.contains("needle"));
    assert!(snippet.chars().count() <= 180);
}

#[tokio::test]
async fn global_search_excludes_system_owned_and_internal_agents() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-hidden-agents");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let repos = state.orchestration().repos();
    upsert_agent_for_search(
        &repos,
        "agent_visible",
        "Needle Visible",
        "@needle-visible",
        "agent",
        false,
    )
    .await;
    upsert_agent_for_search(
        &repos,
        "agent_system",
        "Needle System",
        "@needle-system",
        "agent",
        true,
    )
    .await;
    upsert_agent_for_search(
        &repos,
        "agent_internal",
        "Needle Internal",
        "@needle-internal",
        "internal",
        false,
    )
    .await;
    let app = build_router(state);

    let response = get_json(
        &app,
        &token,
        "/v1/search/global?query=needle&includeChannels=false&includeMessages=false",
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let ids = body["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|agent| agent["agentId"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["agent_visible"]);
}

#[tokio::test]
async fn global_search_channel_filter_excludes_dm_messages() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-channel-filter");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state);

    let coda_id = create_agent(&app, &token, "Coda", "@coda", "runtime engineer").await;
    let dev_channel = create_channel(&app, &token, "dev-team", None, "create-dev-filter").await;
    let ops_channel = create_channel(&app, &token, "ops-team", None, "create-ops-filter").await;
    let expected_message_id = send_channel_message(
        &app,
        &token,
        &dev_channel,
        &coda_id,
        "needle in dev team",
        "send-dev-filter",
    )
    .await;
    send_channel_message(
        &app,
        &token,
        &ops_channel,
        &coda_id,
        "needle in ops team",
        "send-ops-filter",
    )
    .await;
    let conversation_id = create_dm(&app, &token, &coda_id, "dm-filter").await;
    send_dm_message(
        &app,
        &token,
        &conversation_id,
        &coda_id,
        "needle in dm",
        "send-dm-filter",
    )
    .await;

    let response = get_json(
        &app,
        &token,
        "/v1/search/global?query=needle&channelId=dev-team",
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["sourceKind"], "channel");
    assert_eq!(messages[0]["channelId"], dev_channel);
    assert_eq!(messages[0]["messageId"], expected_message_id);
    assert!(messages[0]["conversationId"].is_null());
}

#[tokio::test]
async fn global_search_channel_message_result_includes_session_id_for_transition() {
    let token = AuthToken::from_static("search-token");
    let root = make_temp_dir("global-search-session");
    let state = AppState::for_tests_with_agent_root(token.clone(), root);
    let app = build_router(state);

    let coda_id = create_agent(&app, &token, "Coda", "@coda", "runtime engineer").await;
    let channel_id = create_channel(&app, &token, "dev-team", None, "create-session-channel").await;
    let sessions =
        response_json(get_json(&app, &token, &format!("/v1/channels/{channel_id}/sessions")).await)
            .await;
    let session_id = sessions["sessions"][0]["id"].as_str().unwrap().to_string();
    let message_id = send_channel_message(
        &app,
        &token,
        &channel_id,
        &coda_id,
        "needle in active session",
        "send-session-channel",
    )
    .await;

    let response = get_json(&app, &token, "/v1/search/global?query=needle").await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let message = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["messageId"] == message_id)
        .expect("matching channel message should be returned");
    assert_eq!(message["sourceKind"], "channel");
    assert_eq!(message["sessionId"], session_id);
}

async fn create_agent(
    app: &axum::Router,
    token: &AuthToken,
    name: &str,
    handle: &str,
    description: &str,
) -> String {
    let response = post_json(
        app,
        token,
        "/v1/agents",
        Some(&format!("create-agent-{name}")),
        json!({
            "name": name,
            "handle": handle,
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": description,
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["agent"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn create_channel(
    app: &axum::Router,
    token: &AuthToken,
    name: &str,
    description: Option<&str>,
    idempotency_key: &str,
) -> String {
    let response = post_json(
        app,
        token,
        "/v1/channels",
        Some(idempotency_key),
        json!({
            "name": name,
            "description": description,
            "agentIds": [],
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["channel"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn create_dm(
    app: &axum::Router,
    token: &AuthToken,
    agent_id: &str,
    idempotency_key: &str,
) -> String {
    let response = post_json(
        app,
        token,
        "/v1/conversations/dm",
        Some(idempotency_key),
        json!({ "agentId": agent_id }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["conversation"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn send_channel_message(
    app: &axum::Router,
    token: &AuthToken,
    channel_id: &str,
    author_id: &str,
    body: &str,
    idempotency_key: &str,
) -> String {
    let response = post_json(
        app,
        token,
        &format!("/v1/channels/{channel_id}/messages"),
        Some(idempotency_key),
        json!({ "authorId": author_id, "body": body }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    response_json(response).await["outcome"]["messageId"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn send_dm_message(
    app: &axum::Router,
    token: &AuthToken,
    conversation_id: &str,
    author_id: &str,
    body: &str,
    idempotency_key: &str,
) -> String {
    let response = post_json(
        app,
        token,
        &format!("/v1/conversations/{conversation_id}/messages"),
        Some(idempotency_key),
        json!({ "authorId": author_id, "body": body }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["message"]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn upsert_agent_for_search(
    repos: &Repositories,
    id: &str,
    name: &str,
    handle: &str,
    agent_kind: &str,
    system_owned: bool,
) {
    repos
        .upsert_agent(
            id,
            name,
            handle,
            agent_kind,
            system_owned,
            "ClaudeCode",
            "Sonnet",
            "local-node",
            "needle search agent",
            id,
        )
        .await
        .unwrap();
}

async fn insert_channel_message(repos: &Repositories, id: &str, channel_id: &str, body: &str) {
    repos
        .insert_channel_message(NewChannelMessageRow {
            id: id.to_string(),
            channel_id: channel_id.to_string(),
            session_id: Some(format!("session_{channel_id}")),
            author_id: "human:local".to_string(),
            body: Some(body.to_string()),
            as_task: false,
            kind: "human".to_string(),
        })
        .await
        .unwrap();
}

async fn insert_channel_message_at(
    repos: &Repositories,
    pool: &sqlx::SqlitePool,
    id: &str,
    channel_id: &str,
    body: &str,
    created_at: DateTime<Utc>,
) {
    insert_channel_message(repos, id, channel_id, body).await;
    sqlx::query("UPDATE messages SET created_at = ? WHERE id = ?")
        .bind(created_at.format("%Y-%m-%d %H:%M:%S").to_string())
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

fn message_ids(body: &Value) -> Vec<&str> {
    body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["messageId"].as_str().unwrap())
        .collect()
}

fn utc_midnight(date: chrono::NaiveDate) -> DateTime<Utc> {
    date.and_hms_opt(0, 0, 0).unwrap().and_utc()
}

fn local_midnight_utc(tz: Tz, date: chrono::NaiveDate) -> DateTime<Utc> {
    let local: NaiveDateTime = date.and_hms_opt(0, 0, 0).unwrap();
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

async fn get_json(app: &axum::Router, token: &AuthToken, uri: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn post_json(
    app: &axum::Router,
    token: &AuthToken,
    uri: &str,
    idempotency_key: Option<&str>,
    body: Value,
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("authorization", token.authorization_header())
        .header("content-type", "application/json");
    if let Some(idempotency_key) = idempotency_key {
        builder = builder.header("idempotency-key", idempotency_key);
    }

    app.clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn make_temp_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("slei-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}
