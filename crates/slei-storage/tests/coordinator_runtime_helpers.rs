use slei_storage::db::SleiDb;
use slei_storage::repositories::Repositories;
use uuid::Uuid;

fn sqlite_file_url(name: &str) -> (String, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("slei-{name}-{}.sqlite", Uuid::new_v4()));
    (format!("sqlite://{}", path.display()), path)
}

#[tokio::test]
async fn coordinator_runtime_run_helpers_list_and_cancel_active_runs() {
    let (url, _path) = sqlite_file_url("coordinator-runtime-cancel");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    for (run_id, status) in [
        ("coord_run_pending", "pending"),
        ("coord_run_running", "running"),
        ("coord_run_done", "completed"),
    ] {
        repos
            .insert_coordinator_runtime_run(
                run_id,
                "dev",
                &format!("message_{run_id}"),
                &format!("key_{run_id}"),
                "prompt",
            )
            .await
            .unwrap();
        if status != "pending" {
            repos
                .finish_coordinator_runtime_run(run_id, status, None)
                .await
                .unwrap();
        }
    }

    let active = repos.pending_coordinator_runtime_run_ids().await.unwrap();
    assert_eq!(
        active,
        vec![
            "coord_run_pending".to_string(),
            "coord_run_running".to_string()
        ]
    );

    repos
        .cancel_coordinator_runtime_runs(&active, "development reset")
        .await
        .unwrap();
    assert_eq!(
        repos
            .coordinator_runtime_run("coord_run_pending")
            .await
            .unwrap()
            .unwrap()
            .status,
        "cancelled"
    );
    assert_eq!(
        repos
            .coordinator_runtime_run("coord_run_running")
            .await
            .unwrap()
            .unwrap()
            .status,
        "cancelled"
    );
    assert_eq!(
        repos
            .coordinator_runtime_run("coord_run_done")
            .await
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
}
