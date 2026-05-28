use std::fs;

use slei_daemon::services::artifact_service::{ArtifactInput, ArtifactService};
use uuid::Uuid;

#[tokio::test]
async fn artifacts_validate_metadata_path_hash_and_open_by_daemon_id_only() {
    let workspace_root = std::env::temp_dir().join(format!("slei-artifacts-{}", Uuid::new_v4()));
    let src_dir = workspace_root.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    let artifact_path = src_dir.join("answer.md");
    fs::write(&artifact_path, "safe summary").unwrap();

    let service = ArtifactService::for_tests(workspace_root.clone());
    let artifact = service
        .register(ArtifactInput {
            channel_id: "channel_dev".to_string(),
            task_id: "task_1".to_string(),
            run_id: "run_1".to_string(),
            path: artifact_path.clone(),
            display_name: "answer.md".to_string(),
        })
        .await
        .unwrap();

    assert_eq!(artifact.channel_id, "channel_dev");
    assert_eq!(artifact.task_id, "task_1");
    assert_eq!(artifact.run_id, "run_1");
    assert!(artifact.content_hash.starts_with("hash_"));

    let by_task = service.list_for_task("task_1").await;
    assert_eq!(by_task, vec![artifact.clone()]);

    let token = service.open_token(&artifact.id).await.unwrap();
    assert_eq!(token.artifact_id, artifact.id);
    assert!(!token.token.contains("answer.md"));

    let raw_path_err = service
        .open_token(artifact_path.to_string_lossy().as_ref())
        .await
        .unwrap_err();
    assert!(raw_path_err.to_string().contains("artifact not found"));

    fs::write(&artifact_path, "tampered").unwrap();
    let tampered = service.open_token(&artifact.id).await.unwrap_err();
    assert!(tampered.to_string().contains("hash mismatch"));

    let outside_path = std::env::temp_dir().join(format!("outside-{}.md", Uuid::new_v4()));
    fs::write(&outside_path, "nope").unwrap();
    let outside = service
        .register(ArtifactInput {
            channel_id: "channel_dev".to_string(),
            task_id: "task_1".to_string(),
            run_id: "run_1".to_string(),
            path: outside_path,
            display_name: "outside.md".to_string(),
        })
        .await
        .unwrap_err();
    assert!(outside.to_string().contains("outside workspace"));
}
