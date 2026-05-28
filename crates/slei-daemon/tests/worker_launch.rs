use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use slei_daemon::config::WorkerLaunchConfig;
use slei_daemon::services::worker_launch::{WorkerLaunchStatus, WorkerLauncher};
use uuid::Uuid;

#[tokio::test]
async fn worker_launch_starts_packaged_artifact_without_developer_node_path() {
    let artifact = executable_worker_fixture(
        "ready",
        r#"printf '{"status":"ready","version":"0.1.0","runtime":"standalone"}\n'"#,
    );
    let launcher = WorkerLauncher::new(WorkerLaunchConfig::standalone(artifact));

    let readiness = launcher
        .probe_with_clean_environment(temp_dir("worker-home"), "")
        .await
        .unwrap();

    assert_eq!(readiness.status, WorkerLaunchStatus::Ready);
    assert_eq!(readiness.version.as_deref(), Some("0.1.0"));
    assert_eq!(readiness.runtime.as_deref(), Some("standalone"));
}

#[tokio::test]
async fn worker_launch_reports_missing_and_sdk_auth_failures_distinctly() {
    let missing = WorkerLauncher::new(WorkerLaunchConfig::standalone(
        temp_dir("missing").join("no-worker"),
    ))
    .probe_with_clean_environment(temp_dir("worker-home"), "")
    .await
    .unwrap();
    assert_eq!(missing.status, WorkerLaunchStatus::MissingWorker);

    let sdk_failed = executable_worker_fixture(
        "sdk-failed",
        r#"printf '{"status":"sdk_failed","message":"SDK failed"}\n'"#,
    );
    let readiness = WorkerLauncher::new(WorkerLaunchConfig::standalone(sdk_failed))
        .probe_with_clean_environment(temp_dir("worker-home"), "")
        .await
        .unwrap();
    assert_eq!(readiness.status, WorkerLaunchStatus::SdkFailed);

    let auth_missing = executable_worker_fixture(
        "auth-missing",
        r#"printf '{"status":"auth_missing","message":"Claude auth missing"}\n'"#,
    );
    let readiness = WorkerLauncher::new(WorkerLaunchConfig::standalone(auth_missing))
        .probe_with_clean_environment(temp_dir("worker-home"), "")
        .await
        .unwrap();
    assert_eq!(readiness.status, WorkerLaunchStatus::AuthMissing);
}

fn executable_worker_fixture(label: &str, body: &str) -> PathBuf {
    let path = temp_dir(label).join("claude-worker-fixture");
    fs::write(&path, format!("#!/bin/sh\n{body}")).unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&path, permissions).unwrap();
    path
}

fn temp_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("slei-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}
