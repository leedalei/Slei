use slei_daemon::services::card_service::{
    CardAction, CardDecision, CardProposal, CardService, CardState,
};

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
