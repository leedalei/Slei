use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use tower::ServiceExt;

#[tokio::test]
async fn task_api_creates_roots_and_appends_thread_replies() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/tasks")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "task-api-create")
                .body(Body::from(
                    json!({
                        "channelId": "all",
                        "creatorId": "human:local",
                        "title": "把任务 Thread 做完"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(created.status(), StatusCode::CREATED);
    let body = to_bytes(created.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let task_id = json["task"]["id"].as_str().unwrap();
    assert_eq!(json["task"]["status"], "in_progress");
    assert_eq!(json["task"]["title"], "把任务 Thread 做完");

    let reply = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/tasks/{task_id}/replies"))
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .header("idempotency-key", "task-api-reply")
                .body(Body::from(
                    json!({
                        "senderId": "agent:coda",
                        "body": "我会继续在这个任务 session 里处理"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(reply.status(), StatusCode::CREATED);

    let thread = app
        .oneshot(
            Request::builder()
                .uri(format!("/v1/tasks/{task_id}/thread"))
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(thread.status(), StatusCode::OK);
    let body = to_bytes(thread.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["thread"]["taskId"], task_id);
    assert_eq!(json["thread"]["replyCount"], 1);
    assert!(json["thread"]["context"].as_str().unwrap().contains("任务 session"));
}
