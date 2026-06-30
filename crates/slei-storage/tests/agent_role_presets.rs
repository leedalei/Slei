use slei_storage::db::SleiDb;
use slei_storage::repositories::Repositories;
use uuid::Uuid;

fn sqlite_file_url(name: &str) -> (String, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("slei-{name}-{}.sqlite", Uuid::new_v4()));
    (format!("sqlite://{}", path.display()), path)
}

async fn test_repositories(name: &str) -> Repositories {
    let (url, _path) = sqlite_file_url(name);
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    Repositories::new(db.pool().clone())
}

#[tokio::test]
async fn seed_twice_lists_enabled_agent_role_presets_in_stable_order() {
    let repos = test_repositories("agent-role-presets-seed").await;

    repos.seed_default_agent_role_presets().await.unwrap();
    repos.seed_default_agent_role_presets().await.unwrap();

    let presets = repos.agent_role_presets().await.unwrap();

    assert_eq!(presets.len(), 10);
    assert_eq!(presets[0].id, "xiaohongshu-researcher");
    assert_eq!(presets[0].title, "小红书调研员");
    assert_eq!(presets[0].sort_order, 10);
    assert_eq!(presets[9].id, "operations-planner");
    assert_eq!(presets[9].title, "运营策划员");
    assert_eq!(presets[9].sort_order, 100);
    assert!(presets.iter().all(|preset| preset.enabled));
}

#[tokio::test]
async fn disabled_agent_role_preset_is_omitted_from_listing() {
    let repos = test_repositories("agent-role-presets-disable").await;

    repos.seed_default_agent_role_presets().await.unwrap();
    repos
        .set_agent_role_preset_enabled_for_test("qa-reviewer", false)
        .await
        .unwrap();

    let presets = repos.agent_role_presets().await.unwrap();

    assert_eq!(presets.len(), 9);
    assert!(!presets.iter().any(|preset| preset.id == "qa-reviewer"));
    assert!(presets.iter().all(|preset| preset.enabled));
}
