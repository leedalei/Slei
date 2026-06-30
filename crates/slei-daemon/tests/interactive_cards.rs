use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::json;
use slei_daemon::app::build_router;
use slei_daemon::services::card_service::{
    CardAction, CardDecision, CardProposal, CardService, CardState, InteractiveCardTemplate,
};
use slei_daemon::{auth::AuthToken, state::AppState};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn interactive_cards_require_typed_proposal_and_user_confirmation() {
    let service = CardService::for_tests();

    let card = service
        .propose_card(
            CardProposal {
                run_id: "run_1".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::CreateChannel {
                    name: "dev-team".to_string(),
                },
            },
            "card-1",
        )
        .await
        .unwrap();

    assert_eq!(card.state, CardState::Pending);
    assert_eq!(service.executed_actions().await.len(), 0);

    service
        .decide(
            CardDecision {
                card_id: card.id.clone(),
                confirm: true,
                edited_name: Some("dev-team-edited".to_string()),
            },
            "decision-1",
        )
        .await
        .unwrap();

    assert_eq!(
        service.card(&card.id).await.unwrap().state,
        CardState::Confirmed
    );
    assert_eq!(
        service.executed_actions().await,
        vec!["create_channel:dev-team-edited"]
    );
}

#[tokio::test]
async fn interactive_card_proposal_key_does_not_replay_decision_after_reload() {
    let root = temp_data_root();
    let token = AuthToken::from_static("card-namespace-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    let card = state
        .cards()
        .propose_card(
            CardProposal {
                run_id: "run_card_namespace".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::CreateChannel {
                    name: "namespace-card".to_string(),
                },
            },
            "shared-card-key",
        )
        .await
        .unwrap();

    let reloaded = AppState::for_tests_with_agent_root_async(token, root).await;
    reloaded
        .cards()
        .decide(
            CardDecision {
                card_id: card.id.clone(),
                confirm: true,
                edited_name: Some("namespace-card-edited".to_string()),
            },
            "shared-card-key",
        )
        .await
        .unwrap();

    assert_eq!(
        reloaded.cards().card(&card.id).await.unwrap().state,
        CardState::Confirmed
    );
    assert_eq!(
        reloaded.cards().executed_actions().await,
        vec!["create_channel:namespace-card-edited"]
    );
}

#[tokio::test]
async fn interactive_card_complete_rejects_empty_idempotency_key() {
    let service = CardService::for_tests();
    let card = service
        .propose_card(
            CardProposal {
                run_id: "run_empty_complete".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::CreateChannel {
                    name: "empty-complete".to_string(),
                },
            },
            "empty-complete-proposal",
        )
        .await
        .unwrap();

    let error = service.complete(&card.id, " ").await.unwrap_err();
    assert!(error.to_string().contains("idempotency-key"));
}

#[tokio::test]
async fn interactive_card_complete_api_requires_idempotency_key() {
    let token = AuthToken::from_static("card-api-key-token");
    let state = AppState::for_tests(token.clone());
    let card = state
        .cards()
        .propose_card(
            CardProposal {
                run_id: "run_card_api_key".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::CreateChannel {
                    name: "api-key-card".to_string(),
                },
            },
            "card-api-key-proposal",
        )
        .await
        .unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/interactive-cards/{}/complete", card.id))
                .header("authorization", token.authorization_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["error"], "idempotency-key is required");
}

#[tokio::test]
async fn interactive_cards_reject_freeform_workspace_mount_and_privilege_escalation() {
    let service = CardService::for_tests();

    assert!(service
        .propose_from_freeform("create a card")
        .await
        .is_err());
    assert!(service
        .propose_card(
            CardProposal {
                run_id: "run_1".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::MountWorkspace {
                    path: "/workspace".to_string(),
                },
            },
            "card-workspace",
        )
        .await
        .is_err());
    assert!(service
        .propose_card(
            CardProposal {
                run_id: "run_1".to_string(),
                agent_id: "agent_readonly".to_string(),
                action: CardAction::CreateAgent {
                    name: "Power".to_string(),
                    permission: "Controlled".to_string(),
                },
            },
            "card-agent",
        )
        .await
        .is_err());
}

#[tokio::test]
async fn create_agent_card_draft_normalizes_hyphenated_name_for_agent_create_api() {
    let service = CardService::for_tests();

    let card = service
        .propose_card(
            CardProposal {
                run_id: "run_hyphen_agent".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::CreateAgent {
                    name: "Foo-Bar".to_string(),
                    permission: "Controlled".to_string(),
                },
            },
            "card-hyphen-agent",
        )
        .await
        .expect("card is proposed");

    let view = card.to_view();
    assert_eq!(view.draft["name"], "FooBar");
    assert_eq!(view.draft["handle"], "@FooBar");
}

#[tokio::test]
async fn interactive_cards_survive_app_state_reload_without_legacy_json_index() {
    let root = temp_data_root();
    let token = AuthToken::from_static("interactive-card-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;

    let card = state
        .cards()
        .propose_card(
            CardProposal {
                run_id: "run_reload".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::CreateChannel {
                    name: "ops".to_string(),
                },
            },
            "card-reload",
        )
        .await
        .expect("card is proposed");
    state
        .cards()
        .decide(
            CardDecision {
                card_id: card.id.clone(),
                confirm: true,
                edited_name: Some("ops-edited".to_string()),
            },
            "card-decision",
        )
        .await
        .expect("card decision persists");

    let reloaded = AppState::for_tests_with_agent_root_async(token, root.clone()).await;
    let restored = reloaded
        .cards()
        .card(&card.id)
        .await
        .expect("card reloads from persistent storage");

    assert_eq!(restored.state, CardState::Confirmed);
    assert_eq!(restored.action, card.action);
    assert!(!root.join("cards/index.json").exists());
}

#[tokio::test]
async fn interactive_cards_proposal_idempotency_survives_app_state_reload() {
    let root = temp_data_root();
    let token = AuthToken::from_static("card-idempotency-reload-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;

    let card = state
        .cards()
        .propose_card(
            CardProposal {
                run_id: "run_card_idem".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::CreateChannel {
                    name: "ops-idem".to_string(),
                },
            },
            "card-idem",
        )
        .await
        .expect("card is proposed");

    let reloaded = AppState::for_tests_with_agent_root_async(token, root).await;
    let replayed = reloaded
        .cards()
        .propose_card(
            CardProposal {
                run_id: "run_card_idem".to_string(),
                agent_id: "agent_guide".to_string(),
                action: CardAction::CreateChannel {
                    name: "ops-idem".to_string(),
                },
            },
            "card-idem",
        )
        .await
        .expect("card idempotency replays after reload");

    assert_eq!(replayed.id, card.id);
}

#[tokio::test]
async fn product_tool_card_reload_restores_full_payload_and_message_id() {
    let root = temp_data_root();
    let token = AuthToken::from_static("product-card-reload-token");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root.clone()).await;
    let payload = json!({
        "kind": "createAgent",
        "title": "创建智能体",
        "summary": "Coda · ClaudeCode / Sonnet",
        "draft": {
            "name": "Coda",
            "handle": "@coda",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "负责实现任务"
        },
        "actionLabel": "创建",
        "doneLabel": "DONE"
    });

    let view = state
        .cards()
        .propose_product_tool_card(
            "run_product_tool",
            "agent_guide_local_node",
            "conv_guide",
            &payload,
            "product-card-reload",
        )
        .await
        .expect("product card is proposed");
    let message_id = format!("card_message_{}", view.id);
    state
        .cards()
        .attach_message_id(&view.id, &message_id)
        .await
        .expect("message id is attached");
    state
        .cards()
        .complete(&view.id, "complete-product-card")
        .await
        .expect("state is persisted");

    let reloaded = AppState::for_tests_with_agent_root_async(token, root.clone()).await;
    let restored = reloaded
        .cards()
        .card(&view.id)
        .await
        .expect("product card reloads");

    assert_eq!(restored.run_id, "run_product_tool");
    assert_eq!(restored.agent_id, "agent_guide_local_node");
    assert_eq!(restored.conversation_id.as_deref(), Some("conv_guide"));
    assert_eq!(restored.message_id.as_deref(), Some(message_id.as_str()));
    assert_eq!(
        restored.action,
        CardAction::CreateAgent {
            name: "Coda".to_string(),
            permission: "Controlled".to_string(),
        }
    );
    assert_eq!(
        restored.view,
        Some(InteractiveCardTemplate {
            kind: "createAgent".to_string(),
            title: "创建智能体".to_string(),
            summary: "Coda · ClaudeCode / Sonnet".to_string(),
            draft: payload["draft"].clone(),
            action_label: "创建".to_string(),
            done_label: "DONE".to_string(),
        })
    );
    assert_eq!(restored.state, CardState::Done);
    assert!(!root.join("cards/index.json").exists());
}

#[tokio::test]
async fn product_tool_create_agent_card_rejects_name_or_handle_that_create_agent_rejects() {
    let state = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("product-agent-card-validation-token"),
        temp_data_root(),
    )
    .await;

    let hyphen_name = json!({
        "kind": "createAgent",
        "title": "创建智能体",
        "summary": "Foo-Bar · ClaudeCode / Sonnet",
        "draft": {
            "name": "Foo-Bar",
            "handle": "@FooBar",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "负责实现任务"
        },
        "actionLabel": "创建",
        "doneLabel": "DONE"
    });
    let name_error = state
        .cards()
        .propose_product_tool_card(
            "run_product_tool_invalid_name",
            "agent_guide_local_node",
            "conv_guide",
            &hyphen_name,
            "product-card-invalid-name",
        )
        .await
        .expect_err("hyphenated agent name should be rejected");
    assert!(name_error.to_string().contains("name"));

    let hyphen_handle = json!({
        "kind": "createAgent",
        "title": "创建智能体",
        "summary": "FooBar · ClaudeCode / Sonnet",
        "draft": {
            "name": "FooBar",
            "handle": "@Foo-Bar",
            "runtimeKind": "ClaudeCode",
            "model": "Sonnet",
            "nodeId": "local-node",
            "description": "负责实现任务"
        },
        "actionLabel": "创建",
        "doneLabel": "DONE"
    });
    let handle_error = state
        .cards()
        .propose_product_tool_card(
            "run_product_tool_invalid_handle",
            "agent_guide_local_node",
            "conv_guide",
            &hyphen_handle,
            "product-card-invalid-handle",
        )
        .await
        .expect_err("hyphenated agent handle should be rejected");
    assert!(handle_error.to_string().contains("handle"));
}

#[tokio::test]
async fn product_tool_create_channel_card_uses_channel_action_and_payload() {
    let state = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("product-channel-card-token"),
        temp_data_root(),
    )
    .await;
    let payload = json!({
        "kind": "createChannel",
        "title": "创建频道",
        "summary": "#qa",
        "draft": {
            "name": "qa",
            "description": "质量协作频道",
            "projectName": "Slei",
            "projectPaths": ["/workspace/slei"],
            "agentIds": ["agent_coda"]
        },
        "actionLabel": "创建",
        "doneLabel": "DONE"
    });

    let view = state
        .cards()
        .propose_product_tool_card(
            "run_channel_tool",
            "agent_guide_local_node",
            "conv_guide",
            &payload,
            "product-channel-card",
        )
        .await
        .expect("product channel card is proposed");

    assert_eq!(view.kind, "createChannel");
    assert_eq!(view.title, "创建频道");
    assert_eq!(view.draft, payload["draft"]);
    let stored = state
        .cards()
        .card(&view.id)
        .await
        .expect("channel card is stored");
    assert_eq!(
        stored.action,
        CardAction::CreateChannel {
            name: "qa".to_string(),
        }
    );
    assert_eq!(
        stored.view,
        Some(InteractiveCardTemplate {
            kind: "createChannel".to_string(),
            title: "创建频道".to_string(),
            summary: "#qa".to_string(),
            draft: payload["draft"].clone(),
            action_label: "创建".to_string(),
            done_label: "DONE".to_string(),
        })
    );
}

fn temp_data_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("slei-interactive-cards-{}", Uuid::new_v4()))
}
