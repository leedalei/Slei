# Slei 统一编辑体验 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一设置、成员详情和设备详情的编辑语义：偏好项即时保存，实体字段显式保存，账户资料由 daemon/SQLite 持久化。

**Architecture:** daemon/storage 新增本地用户 profile source of truth，并通过 Tauri broker 和 desktop bridge 暴露给 React。React 将编辑控件拆成实体字段显式保存和偏好即时保存两类，UI 只维护短暂草稿、pending 和 error 状态。所有生产状态仍通过 daemon API/SQLite 保存，失败时回滚或保留草稿。

**Tech Stack:** Rust 2021, Axum/Tokio, sqlx SQLite, Tauri v2 commands, TypeScript, React 19, Vitest, shadcn/ui, lucide-react。

---

## 规格

设计规格：`docs/superpowers/specs/2026-06-17-slei-unified-editing-design.md`

相关约束：

- `AGENTS.md`
- `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- `docs/architecture/0006-task-source-message-card.md`

实现原则：

- 先写失败测试，再写最小实现。
- 每个任务完成后提交一次。
- 不新增 production JSON profile/preferences 写入路径。
- UI shell 不承载生产业务规则；持久化、校验和 source of truth 在 daemon/storage。
- 涉及 UI 的测试必须断言 DOM 节点、aria 状态和关键交互。

## 文件结构

### Storage And Daemon Profile

- Create: `crates/slei-storage/migrations/0005_user_profile.sql`  
  新增 `user_profiles` 表，`profile_id = 'local'` 单行记录，字段包含 `display_name`、`handle`、`avatar`、`updated_at`。
- Modify: `crates/slei-storage/src/migrations.rs`  
  静态注册 migration 5 到 `MIGRATIONS`。
- Modify: `crates/slei-storage/src/lib.rs`  
  migration 版本测试更新到 `1..=5`，新增 profile 表存在性与 reset 行为测试。
- Modify: `crates/slei-storage/src/repositories/mod.rs`  
  新增 `UserProfileRow`、`upsert_user_profile`、`user_profile`，并把 `user_profiles` 纳入 mutable reset table。
- Modify: `crates/slei-daemon/src/services/settings_service.rs`  
  让 profile 从 repository 读取/写入；新增 `profile()`、`update_profile()`；保留 handle immutable。
- Modify: `crates/slei-daemon/src/api/settings.rs`  
  新增 profile DTO、`get_profile`、`update_profile`。
- Modify: `crates/slei-daemon/src/app.rs`  
  注册 `/v1/settings/profile` GET/PATCH。
- Modify: `crates/slei-daemon/tests/settings_identity.rs`  
  覆盖 profile API 鉴权、round trip、partial PATCH、handle mutation rejection、SQLite reload。

### Tauri Broker And Desktop Bridge

- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`  
  新增 profile DTO、local cache、daemon fetch/update、offline failure 行为。
- Modify: `apps/desktop/src-tauri/src/commands.rs`  
  新增 `list_profile`、`update_profile` 和对应 Tauri commands。
- Modify: `apps/desktop/src-tauri/src/lib.rs`  
  注册 commands 并补 round-trip/offline tests。
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`  
  新增 `UserProfileView`、`ProfileReceipt`、`ProfileUpdateRequest`、`listProfile()`、`updateProfile()`。
- Modify: `apps/desktop/src/test/daemon-bridge-mock.ts`  
  mock profile 持久化，失败测试可按需注入。

### React Editing Components

- Modify: `apps/desktop/src/components/EditableDetailField.tsx`  
  升级为实体字段标准组件：async save、saving disabled、error、allowEmpty、Esc 取消。
- Modify: `apps/desktop/src/components/index.ts`  
  如需重命名或新增导出，保持旧导出兼容。
- Create/Modify: `apps/desktop/src/components/EditableDetailField.test.tsx`  
  覆盖只读、编辑、保存中、失败保留草稿、取消恢复确认值。

### Settings UI And App State

- Modify: `apps/desktop/src/app/model.ts`  
  将 `UserProfile` 与 daemon bridge profile DTO 对齐；生产路径允许 profile 缺失并渲染不可用/空状态，不使用本地默认资料伪装已保存状态。
- Modify: `apps/desktop/src/app/SleiApp.tsx`  
  初始化加载 profile；新增 `handleProfileChange`/`handleAvatarChange`；偏好保存失败回滚并 toast。
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`  
  将 profile 保存函数、avatar 保存函数和错误回调传入 settings route；必要时让 computer rename 返回 Promise。
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx`  
  账户显示名使用实体字段显式保存；handle 只读；头像 preset 即时保存；偏好控件 pending/error。
- Modify: `apps/desktop/src/i18n/types.ts`  
  增加保存失败、保存中、只读 handle 等文案 key。
- Modify: `apps/desktop/src/i18n/messages/zh-CN/settings.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/settings.ts`
- Modify: `apps/desktop/e2e/settings-preferences.spec.tsx`  
  补账户字段、handle 只读、头像、偏好失败回滚 DOM 测试。
- Modify: `apps/desktop/e2e/detail-editing.spec.tsx`  
  补实体字段 async 保存、失败、保存中 DOM 测试。
- Modify: `apps/desktop/e2e/i18n.spec.tsx`  
  补语言保存失败时全局文案回滚测试。

## Task 1: Storage Repository Persists Local Profile

**Files:**
- Create: `crates/slei-storage/migrations/0005_user_profile.sql`
- Modify: `crates/slei-storage/src/migrations.rs`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: 写失败测试：migration 版本包含 5**

在 `crates/slei-storage/src/lib.rs` 的 `migration_records_every_known_version` 中改为：

```rust
assert_eq!(versions, vec![1, 2, 3, 4, 5]);
```

同时把 `migration_records_broadcast_claim_version` 中的版本断言也更新为：

```rust
assert_eq!(versions, vec![1, 2, 3, 4, 5]);
```

- [ ] **Step 2: 写失败测试：profile 表存在**

在 `migration_creates_core_tables_and_indexes` 的 table 列表加入：

```rust
"user_profiles",
```

- [ ] **Step 3: 写失败测试：repository round trip**

在 `crates/slei-storage/src/lib.rs` 增加：

```rust
#[tokio::test]
async fn user_profile_round_trips_single_local_profile() {
    let (url, _path) = sqlite_file_url("user-profile");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .upsert_user_profile(UserProfileRow {
            display_name: "Lei".to_string(),
            handle: "lei".to_string(),
            avatar: "pixel-sun".to_string(),
        })
        .await
        .unwrap();
    repos
        .upsert_user_profile(UserProfileRow {
            display_name: "Lei Lee".to_string(),
            handle: "lei".to_string(),
            avatar: "pixel-moon".to_string(),
        })
        .await
        .unwrap();

    let profile = repos.user_profile().await.unwrap().unwrap();
    assert_eq!(profile.display_name, "Lei Lee");
    assert_eq!(profile.handle, "lei");
    assert_eq!(profile.avatar, "pixel-moon");
}
```

Import `UserProfileRow` in the test module import list.

- [ ] **Step 4: 运行测试确认失败**

```bash
cargo test -p slei-storage
```

Expected: FAIL，缺少 migration/table/type/repository methods。

- [ ] **Step 5: 创建 migration**

Create `crates/slei-storage/migrations/0005_user_profile.sql`:

```sql
CREATE TABLE IF NOT EXISTS user_profiles (
    profile_id TEXT PRIMARY KEY DEFAULT 'local',
    display_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    avatar TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (5);
```

- [ ] **Step 6: 注册 migration**

在 `crates/slei-storage/src/migrations.rs` 尾部加入：

```rust
pub const MIGRATION_0005: &str = include_str!("../migrations/0005_user_profile.sql");
```

并更新 `MIGRATIONS`：

```rust
pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, MIGRATION_0001),
    (2, MIGRATION_0002),
    (3, MIGRATION_0003),
    (4, MIGRATION_0004),
    (5, MIGRATION_0005),
];
```

- [ ] **Step 7: 实现 repository row 和方法**

在 `crates/slei-storage/src/repositories/mod.rs` 增加：

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserProfileRow {
    pub display_name: String,
    pub handle: String,
    pub avatar: String,
}
```

在 `impl Repositories` 中增加：

```rust
pub async fn upsert_user_profile(&self, row: UserProfileRow) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO user_profiles(profile_id, display_name, handle, avatar)
         VALUES ('local', ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET
            display_name = excluded.display_name,
            handle = excluded.handle,
            avatar = excluded.avatar,
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(row.display_name)
    .bind(row.handle)
    .bind(row.avatar)
    .execute(&self.pool)
    .await?;
    Ok(())
}

pub async fn user_profile(&self) -> Result<Option<UserProfileRow>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT display_name, handle, avatar
         FROM user_profiles
         WHERE profile_id = 'local'",
    )
    .fetch_optional(&self.pool)
    .await?;

    row.map(user_profile_row_from_sql).transpose()
}
```

Add helper:

```rust
fn user_profile_row_from_sql(row: sqlx::sqlite::SqliteRow) -> Result<UserProfileRow, sqlx::Error> {
    Ok(UserProfileRow {
        display_name: row.try_get("display_name")?,
        handle: row.try_get("handle")?,
        avatar: row.try_get("avatar")?,
    })
}
```

- [ ] **Step 8: 把 profile 纳入 reset mutable tables**

在 `RESET_MUTABLE_TABLES` 加入：

```rust
"user_profiles",
```

- [ ] **Step 9: 运行 storage 测试**

```bash
cargo test -p slei-storage
```

Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add crates/slei-storage/migrations/0005_user_profile.sql crates/slei-storage/src/migrations.rs crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs
git commit -m "feat: persist local user profile"
```

## Task 2: Daemon Settings Profile API

**Files:**
- Modify: `crates/slei-daemon/src/services/settings_service.rs`
- Modify: `crates/slei-daemon/src/api/settings.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `crates/slei-daemon/tests/settings_identity.rs`

- [ ] **Step 1: 写 service 失败测试：profile SQLite reload**

在 `crates/slei-daemon/tests/settings_identity.rs` 增加：

```rust
#[tokio::test]
async fn settings_profile_create_survives_app_state_reload_without_update() {
    let root = std::env::temp_dir().join(format!(
        "slei-profile-reload-test-{}",
        uuid::Uuid::new_v4()
    ));
    let state = AppState::for_tests_with_root(root.clone());

    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();

    let reloaded = AppState::for_tests_with_root(root.clone());
    let profile = reloaded.settings().profile().await.unwrap();
    assert_eq!(profile.nickname, "Lei");
    assert_eq!(profile.handle, "lei");
    assert_eq!(profile.avatar_url.as_deref(), Some("pixel-sun"));

    let _ = std::fs::remove_dir_all(root);
}
```

If `AppState::for_tests_with_root` does not exist, inspect nearby settings persistence tests and use the same existing helper. The important behavior is: `create_profile` itself persists; a later reload without `update_profile` still returns the profile.

- [ ] **Step 2: 写 API 失败测试**

在同一文件增加：

```rust
#[tokio::test]
async fn settings_profile_api_requires_auth_round_trips_and_rejects_handle_patch() {
    let token = AuthToken::from_static("settings-profile-token");
    let state = AppState::for_tests(token.clone());
    state
        .settings()
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();
    let app = build_router(state);

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/settings/profile")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let updated = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"displayName":"Lei Lee","avatar":"pixel-moon"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);

    let body = to_bytes(updated.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["profile"]["displayName"], "Lei Lee");
    assert_eq!(json["profile"]["avatar"], "pixel-moon");
    assert_eq!(json["profile"]["handle"], "lei");

    let handle_patch = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/settings/profile")
                .header("authorization", token.authorization_header())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"handle":"other"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(handle_patch.status(), StatusCode::BAD_REQUEST);
}
```

Also add a separate API test for the missing-profile case: `GET /v1/settings/profile` should return `{ "profile": null }`, and `PATCH /v1/settings/profile` should return `404` or `400` with a clear `"profile unavailable"` error. Do not lazily create a fake profile from PATCH.

Add field-specific validation tests:

```rust
#[tokio::test]
async fn settings_profile_rejects_invalid_display_name_and_avatar_field_errors() {
    let service = SettingsService::for_tests();
    service
        .create_profile(ProfileDraft {
            nickname: "Lei".to_string(),
            handle: "lei".to_string(),
            bio: None,
            avatar_url: Some("pixel-sun".to_string()),
        })
        .await
        .unwrap();

    let display_name_error = service
        .update_profile(Some("   ".to_string()), None)
        .await
        .unwrap_err();
    assert!(display_name_error.to_string().contains("displayName"));

    let avatar_error = service
        .update_profile(None, Some("not-a-preset".to_string()))
        .await
        .unwrap_err();
    assert!(avatar_error.to_string().contains("avatar"));
}
```

- [ ] **Step 3: 运行 daemon tests 确认失败**

```bash
cargo test -p slei-daemon settings_profile
```

Expected: FAIL，缺少 API/service methods/routes。

- [ ] **Step 4: 实现 service profile read/write**

在 `settings_service.rs`：

```rust
pub async fn profile(&self) -> Option<UserProfile> {
    if let Some(repos) = &self.repos {
        if let Ok(Some(row)) = repos.user_profile().await {
            let profile = profile_from_row(row);
            self.inner.lock().await.profile = Some(profile.clone());
            return Some(profile);
        }
    }
    self.inner.lock().await.profile.clone()
}

pub async fn update_profile(
    &self,
    nickname: Option<String>,
    avatar: Option<String>,
) -> Result<UserProfile, SettingsError> {
    let _gate = self.mutation_gate.lock().await;
    let mut profile = self.profile_for_update().await?;
    if let Some(nickname) = nickname {
        let trimmed = nickname.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 80 {
            return Err(SettingsError::InvalidProfileField("displayName"));
        }
        profile.nickname = trimmed.to_string();
    }
    if let Some(avatar) = avatar {
        let trimmed = avatar.trim();
        if !is_supported_avatar(trimmed) {
            return Err(SettingsError::InvalidProfileField("avatar"));
        }
        profile.avatar_url = Some(trimmed.to_string());
    }
    self.persist_profile(&profile).await?;
    self.inner.lock().await.profile = Some(profile.clone());
    Ok(profile)
}
```

Add `profile_for_update`, `persist_profile`, `profile_to_row`, `profile_from_row`, `is_supported_avatar`, and field-specific errors:

```rust
#[error("invalid profile field: {0}")]
InvalidProfileField(&'static str),
#[error("profile unavailable")]
ProfileUnavailable,
```

Use existing `UserProfile.nickname`, `handle`, `avatar_url`; map `avatar_url` as preset id for now. `is_supported_avatar` must accept exactly `pixel-sun`, `pixel-moon`, `pixel-cube`, and `pixel-spark`.

Important: update `create_profile` to call `persist_profile(&profile).await?` before updating in-memory state when repositories are available. `profile_for_update` must return `SettingsError::ProfileUnavailable` if no profile exists; it must not create a default profile.

- [ ] **Step 5: 实现 API DTO**

在 `api/settings.rs`：

```rust
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserProfileView {
    display_name: String,
    handle: String,
    avatar: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdateRequest {
    display_name: Option<String>,
    avatar: Option<String>,
    handle: Option<String>,
}
```

Add handlers:

```rust
pub async fn get_profile(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let profile = state.settings().profile().await;
    let Some(profile) = profile else {
        return Json(json!({ "profile": null })).into_response();
    };
    Json(json!({ "profile": UserProfileView::from(profile) })).into_response()
}

pub async fn update_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ProfileUpdateRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if payload.handle.is_some() {
        return error_response(StatusCode::BAD_REQUEST, "handle is immutable");
    }
    let _activity_guard = match crate::api::begin_resettable_write(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };
    match state.settings().update_profile(payload.display_name, payload.avatar).await {
        Ok(profile) => Json(json!({ "profile": UserProfileView::from(profile) })).into_response(),
        Err(SettingsError::ProfileUnavailable) => error_response(StatusCode::NOT_FOUND, "profile unavailable"),
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    }
}
```

- [ ] **Step 6: 注册 route**

在 `crates/slei-daemon/src/app.rs` 加：

```rust
.route(
    "/v1/settings/profile",
    get(api::settings::get_profile).patch(api::settings::update_profile),
)
```

- [ ] **Step 7: 运行 daemon tests**

```bash
cargo test -p slei-daemon settings_identity
cargo test -p slei-daemon settings_profile
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add crates/slei-daemon/src/services/settings_service.rs crates/slei-daemon/src/api/settings.rs crates/slei-daemon/src/app.rs crates/slei-daemon/tests/settings_identity.rs
git commit -m "feat: expose daemon profile settings"
```

## Task 3: Desktop Tauri Profile Bridge

**Files:**
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/test/daemon-bridge-mock.ts`
- Modify: `apps/desktop/e2e/settings-preferences.spec.tsx`

- [ ] **Step 1: 写 TypeScript bridge mock 失败测试**

在 `apps/desktop/e2e/settings-preferences.spec.tsx` 增加：

```ts
it("bridge mock persists profile like the native bridge contract", async () => {
  const bridge = createDaemonBridgeMock({
    connected: true,
    profile: { displayName: "Lei", handle: "lei", avatar: "pixel-sun" },
  });

  expect((await bridge.listProfile()).profile?.displayName).toBe("Lei");
  expect((await bridge.listProfile()).profile?.handle).toBe("lei");
  await bridge.updateProfile({ displayName: "Lei Lee", avatar: "pixel-moon" });

  const receipt = await bridge.listProfile();
  expect(receipt.profile?.displayName).toBe("Lei Lee");
  expect(receipt.profile?.handle).toBe("lei");
  expect(receipt.profile?.avatar).toBe("pixel-moon");
  await expect(bridge.updateProfile({ handle: "other" })).rejects.toThrow("handle is immutable");
});
```

- [ ] **Step 2: 写 Rust command 失败测试**

在 `apps/desktop/src-tauri/src/lib.rs` 的 tests 里增加。不要依赖 broker 本地默认 profile；使用和现有 daemon request tests 相同的 `TcpListener` fake daemon，依次响应 `GET /v1/settings/profile`、`PATCH /v1/settings/profile`、`PATCH /v1/settings/profile` with handle mutation：

```rust
#[test]
fn profile_commands_round_trip_without_handle_mutation() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        let responses = [
            (
                "200 OK",
                r#"{"profile":{"displayName":"Lei","handle":"lei","avatar":"pixel-sun"}}"#,
            ),
            (
                "200 OK",
                r#"{"profile":{"displayName":"Lei Lee","handle":"lei","avatar":"pixel-moon"}}"#,
            ),
            ("400 Bad Request", r#"{"error":"handle is immutable"}"#),
        ];
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 512];
            loop {
                let count = std::io::Read::read(&mut stream, &mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                if String::from_utf8_lossy(&bytes).contains("\r\n\r\n") {
                    break;
                }
            }
            std::io::Write::write_all(
                &mut stream,
                format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .as_bytes(),
            )
            .unwrap();
        }
    });
    let broker = DaemonBroker::for_tests(RuntimeDescriptor {
        endpoint: format!("http://127.0.0.1:{port}"),
        event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
        token: "secret-token".to_string(),
        daemon_version: "0.1.0".to_string(),
        protocol_version: "v1".to_string(),
    });

    let profile = list_profile(&broker).profile.unwrap();
    assert_eq!(profile.handle, "lei");

    let updated = update_profile(
        &broker,
        ProfileUpdateRequest {
            display_name: Some("Lei Lee".to_string()),
            avatar: Some("pixel-moon".to_string()),
            handle: None,
        },
    )
    .unwrap();
    let updated_profile = updated.profile.unwrap();
    assert_eq!(updated_profile.display_name, "Lei Lee");
    assert_eq!(updated_profile.avatar, "pixel-moon");
    assert!(update_profile(
        &broker,
        ProfileUpdateRequest {
            display_name: None,
            avatar: None,
            handle: Some("other".to_string()),
        },
    )
    .is_err());
    handle.join().unwrap();
}
```

- [ ] **Step 3: 运行失败测试**

```bash
pnpm --filter @slei/desktop test -- settings-preferences.spec.tsx
cargo test -p slei-desktop profile_commands_round_trip_without_handle_mutation
```

Expected: FAIL，缺少 bridge/commands。

- [ ] **Step 4: 扩展 desktop daemon bridge types**

在 `apps/desktop/src/lib/daemon-bridge.ts` 增加：

```ts
export type UserProfileView = {
  displayName: string;
  handle: string;
  avatar: string;
};

export type ProfileReceipt = {
  profile: UserProfileView | null;
};

export type ProfileUpdateRequest = {
  displayName?: string;
  avatar?: string;
  handle?: string;
};
```

在 `DaemonBridge` interface 加：

```ts
listProfile(): Promise<ProfileReceipt>;
updateProfile(request: ProfileUpdateRequest): Promise<ProfileReceipt>;
```

在 Tauri bridge 加：

```ts
listProfile: () => invoke<ProfileReceipt>("list_profile_command"),
updateProfile: (request: ProfileUpdateRequest) => invoke<ProfileReceipt>("update_profile_command", { request }),
```

Offline bridge: `listProfile` 返回 `{ profile: null }`，`updateProfile` 用 `rejectDaemonOffline`。这表示 daemon profile 不可用，不是已保存的本地默认资料。

- [ ] **Step 5: 扩展 bridge mock**

在 `daemon-bridge-mock.ts` 的 `createDaemonBridgeMock` input type 增加：

```ts
profile?: UserProfileView | null;
```

然后加 profile state：

```ts
let profile: UserProfileView | null = input.profile ?? null;
```

实现：

```ts
async listProfile() {
  return { profile };
},
async updateProfile(request) {
  if (!profile) {
    throw new Error("profile unavailable");
  }
  if (request.handle && request.handle !== profile.handle) {
    throw new Error("handle is immutable");
  }
  if (request.displayName !== undefined && !request.displayName.trim()) {
    throw new Error("display name is required");
  }
  profile = {
    ...profile,
    displayName: request.displayName?.trim() ?? profile.displayName,
    avatar: request.avatar ?? profile.avatar,
  };
  return { profile };
},
```

- [ ] **Step 6: 扩展 Rust broker DTO 和 commands**

在 `daemon_broker.rs` 加 serde DTO，字段用 Rust snake_case + serde camelCase：

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileView {
    pub display_name: String,
    pub handle: String,
    pub avatar: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileReceipt {
    pub profile: Option<UserProfileView>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdateRequest {
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub handle: Option<String>,
}
```

Add `profile: Mutex<Option<UserProfileView>>` to `DaemonBroker`, default `None`. This cache mirrors daemon state; `None` means profile unavailable/unset and must render as empty/unavailable UI.

Implement `list_profile`, `update_profile`, `fetch_profile_from_daemon`, `update_profile_in_daemon`, `replace_local_profile`. Offline empty fallback should return `{ profile: None }` for list and reject update like preferences.

- [ ] **Step 7: 加 commands 并注册**

`commands.rs`:

```rust
pub fn list_profile(broker: &DaemonBroker) -> ProfileReceipt {
    broker.list_profile()
}

pub fn update_profile(
    broker: &DaemonBroker,
    request: ProfileUpdateRequest,
) -> Result<ProfileReceipt, ProfileError> {
    broker.update_profile(request)
}

#[tauri::command]
pub fn list_profile_command(state: tauri::State<'_, DaemonBroker>) -> ProfileReceipt {
    list_profile(state.inner())
}

#[tauri::command]
pub fn update_profile_command(
    state: tauri::State<'_, DaemonBroker>,
    request: ProfileUpdateRequest,
) -> Result<ProfileReceipt, String> {
    update_profile(state.inner(), request).map_err(|error| error.to_string())
}
```

`lib.rs` command invoke handler 加 `list_profile_command`、`update_profile_command`，test imports 加对应 functions/types。

- [ ] **Step 8: 运行 bridge tests**

```bash
pnpm --filter @slei/desktop test -- settings-preferences.spec.tsx
cargo test -p slei-desktop profile_commands_round_trip_without_handle_mutation
cargo test -p slei-desktop preferences_commands_round_trip_locale_and_notifications_without_secrets
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add apps/desktop/src-tauri/src/daemon_broker.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/daemon-bridge.ts apps/desktop/src/test/daemon-bridge-mock.ts apps/desktop/e2e/settings-preferences.spec.tsx
git commit -m "feat: add desktop profile bridge"
```

## Task 4: Entity Field Component Supports Async Save

**Files:**
- Modify: `apps/desktop/src/components/EditableDetailField.tsx`
- Create: `apps/desktop/src/components/EditableDetailField.test.tsx`
- Modify: `apps/desktop/e2e/detail-editing.spec.tsx`

- [ ] **Step 1: 写组件失败测试**

Create `apps/desktop/src/components/EditableDetailField.test.tsx` with pure helper tests only. Do not import `@testing-library/react`; the desktop package currently uses node Vitest plus SSR tests.

```ts
import { describe, expect, it } from "vitest";

import { prepareEditableDetailSave } from "./EditableDetailField";

describe("EditableDetailField", () => {
  it("trims non-empty drafts before saving", () => {
    expect(prepareEditableDetailSave("  Lei Lee  ", false)).toEqual({
      ok: true,
      value: "Lei Lee",
    });
  });

  it("rejects empty drafts unless allowEmpty is true", () => {
    expect(prepareEditableDetailSave("   ", false)).toEqual({ ok: false });
    expect(prepareEditableDetailSave("   ", true)).toEqual({ ok: true, value: "" });
  });

  it("normalizes thrown save errors to display text", () => {
    expect(prepareEditableDetailSave.errorMessage(new Error("保存失败"))).toBe("保存失败");
    expect(prepareEditableDetailSave.errorMessage("bad")).toBe("bad");
  });
});
```

- [ ] **Step 2: 写 SSR DOM 测试补只读、编辑、saving/error hooks**

In `apps/desktop/e2e/detail-editing.spec.tsx`, keep the existing read/edit-mode tests and add a render test for:

```tsx
<EditableDetailField
  ariaLabel="编辑显示名称"
  error="保存失败"
  initialEditing
  label="显示名称"
  saving
  onSave={() => undefined}
  value="Lei"
/>
```

Assert:

```ts
expect(html).toContain('aria-disabled="true"');
expect(html).toContain('role="alert"');
expect(html).toContain("保存失败");
expect(html).toContain('data-editable-saving="true"');
```

Add another SSR render for `allowEmpty`:

```tsx
<EditableDetailField
  allowEmpty
  ariaLabel="编辑描述"
  initialEditing
  label="描述"
  onSave={() => undefined}
  value=""
/>
```

Assert the textarea/input renders and no validation error appears in SSR output.

- [ ] **Step 3: 运行失败测试**

```bash
pnpm --filter @slei/desktop test -- detail-editing.spec.tsx EditableDetailField.test.tsx
```

Expected: FAIL，缺少 props 或行为。

- [ ] **Step 4: 实现 async save/error/saving/allowEmpty**

Update component props:

```ts
onSave?: (value: string) => Promise<void> | void;
allowEmpty?: boolean;
saving?: boolean;
error?: string;
```

Add exported pure helper at bottom of the same file:

```ts
export const prepareEditableDetailSave = Object.assign(
  (draft: string, allowEmpty = false) => {
  const value = draft.trim();
  if (!allowEmpty && !value) return { ok: false as const };
  return { ok: true as const, value };
  },
  {
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  },
);
```

Implementation rules:

- Internal `saving` state is used when caller does not pass `saving`.
- `save()` awaits `input.onSave?.(nextValue)`.
- Empty values are blocked only when `allowEmpty !== true`, using `prepareEditableDetailSave`.
- On thrown error, keep editing, keep draft, show error message via `prepareEditableDetailSave.errorMessage`.
- On success, clear local error and exit editing.
- Cancel resets draft to current `input.value` and clears local error.
- Add `onKeyDown` to input/textarea: Escape calls cancel; Enter saves only for single-line input.
- Inputs and buttons disabled when effective saving is true.

Error DOM:

```tsx
{errorMessage ? (
  <p className="text-sm text-destructive" role="alert">
    {errorMessage}
  </p>
) : null}
```

Root hook:

```tsx
data-editable-saving={isSaving ? "true" : undefined}
```

- [ ] **Step 5: 运行组件/detail tests**

```bash
pnpm --filter @slei/desktop test -- detail-editing.spec.tsx EditableDetailField.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/components/EditableDetailField.tsx apps/desktop/src/components/EditableDetailField.test.tsx apps/desktop/e2e/detail-editing.spec.tsx
git commit -m "feat: support async entity field editing"
```

## Task 5: Settings Page Uses Profile Contract And Unified Controls

**Files:**
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/settings.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/settings.ts`
- Modify: `apps/desktop/e2e/settings-preferences.spec.tsx`

- [ ] **Step 1: 写账户 DOM 失败测试**

In `settings-preferences.spec.tsx`, add:

```ts
it("renders account profile as explicit display-name edit, read-only handle, and instant avatar choices", () => {
  const html = renderToStaticMarkup(
    <SleiAppFrame
      activeView="settings"
      data={data}
      initialSettingsPanel="account"
      locale="zh-CN"
      profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
      runtimeSetup={readyRuntime}
    />,
  );

  expect(html).toContain('aria-label="编辑显示名称"');
  expect(html).toContain("Lei");
  expect(html).toContain("@lei");
  expect(html).not.toContain('aria-label="编辑@"');
  expect(html).toContain('data-settings-avatar-option="pixel-sun"');
  expect(html).toContain('aria-pressed="true"');
});
```

- [ ] **Step 2: 写偏好 pending/error DOM 失败测试**

Add SSR test:

```tsx
<SettingsPage
  activePanel="language-region"
  appearance={{ theme: "light", fontSize: "md" }}
  locale="zh-CN"
  messages={createDesktopMessages("zh-CN")}
  notifications={{ mentions: true, humanReplies: true, approvals: true }}
  nodes={[]}
  pendingPreference="locale"
  preferenceError="保存失败"
  profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
  timeZone="Asia/Shanghai"
/>
```

Assert:

```ts
expect(html).toContain('data-preference-pending="locale"');
expect(html).toContain('role="alert"');
expect(html).toContain("保存失败");
```

- [ ] **Step 3: 运行失败测试**

```bash
pnpm --filter @slei/desktop test -- settings-preferences.spec.tsx
```

Expected: FAIL，当前账户输入是即时 onChange，handle 可编辑，缺少 pending/error props。

- [ ] **Step 4: 对齐 profile model**

In `apps/desktop/src/app/model.ts`, keep:

```ts
export type UserProfile = {
  displayName: string;
  handle: string;
  avatar: string;
};
```

Production App state should be nullable:

```ts
const [profile, setProfile] = useState<UserProfile | null>(null);
```

Remove production dependence on `defaultProfile` for settings/account data. Tests may still pass an explicit profile prop.

For chat/task/message rendering only, define an explicit presentation fallback that is not saved and is not passed to settings:

```ts
export function localHumanPresentation(profile: UserProfile | null, messages: DesktopMessages): UserProfile {
  return profile ?? {
    displayName: messages.common.you,
    handle: "local",
    avatar: messages.common.you.slice(0, 2),
  };
}
```

Update these functions to accept `UserProfile | null` and call `localHumanPresentation` internally:

- `conversationMessageToSleiMessage`
- `channelMessageToSleiMessage`
- `taskThreadMessageToReply`
- `loadSleiConversationMessages`
- `loadSleiChannelMessages`
- `createLocalChatMessage` callers

`SleiAppFrame` and `ChatPage` may receive the presentation profile for chat rendering, but `SettingsPage` must receive `UserProfile | null` unchanged.

- [ ] **Step 4a: 写 nullable profile 失败测试**

In `apps/desktop/src/app/SleiApp.test.ts`, add tests for the presentation fallback:

```ts
it("renders local human messages with a presentation fallback when profile is unavailable", () => {
  const messages = createDesktopMessages("zh-CN");
  const message = conversationMessageToSleiMessage(
    {
      id: "msg_1",
      conversationId: "dm:agent_1",
      authorId: "human:local",
      body: "hello",
      createdAt: "2026-06-17T00:00:00Z",
    },
    [],
    null,
    messages,
  );

  expect(message.author).toBe(messages.common.you);
  expect(message.handle).toBe("@local");
});
```

Also add a settings render test in `settings-preferences.spec.tsx`:

```tsx
<SleiAppFrame
  activeView="settings"
  data={data}
  initialSettingsPanel="account"
  locale="zh-CN"
  profile={null}
  runtimeSetup={readyRuntime}
/>
```

Assert it contains `账户资料暂不可用` and does not contain `data-settings-avatar-option`.

- [ ] **Step 5: 加 settings messages**

Add keys to `DesktopMessages["settings"]`:

```ts
saveFailed: string;
saving: string;
handleReadOnly: string;
profileUnavailable: string;
```

Chinese:

```ts
saveFailed: "保存失败",
saving: "保存中",
handleReadOnly: "创建后不可修改",
profileUnavailable: "账户资料暂不可用",
```

English:

```ts
saveFailed: "Save failed",
saving: "Saving",
handleReadOnly: "Cannot be changed after setup",
profileUnavailable: "Profile is unavailable",
```

- [ ] **Step 6: 修改 SettingsPage props**

In `SettingsPageView.tsx`, replace `onProfileChange?: (profile: UserProfile) => void` with:

```ts
profile: UserProfile | null;
onProfileChange?: (patch: Partial<Pick<UserProfile, "displayName" | "avatar">>) => Promise<void> | void;
pendingPreference?: "locale" | "timeZone" | "appearance" | "notifications";
preferenceError?: string;
pendingProfileField?: "displayName" | "avatar";
profileErrors?: Partial<Record<"displayName" | "avatar", string>>;
```

- [ ] **Step 7: profile 缺失时渲染不可用状态**

At the top of account panel content:

```tsx
if (!input.profile) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.profile}</CardTitle>
        <CardDescription>{labels.profileUnavailable}</CardDescription>
      </CardHeader>
    </Card>
  );
}
```

Do not render display name, handle, or avatar controls when profile is null.

- [ ] **Step 8: 账户显示名使用 EditableDetailField**

Replace account display name `Input` with:

```tsx
<EditableDetailField
  ariaLabel={`${input.messages.common.edit}${labels.displayName}`}
  error={input.profileErrors?.displayName}
  label={labels.displayName}
  messages={input.messages}
  onSave={(value) => input.onProfileChange?.({ displayName: value })}
  saving={input.pendingProfileField === "displayName"}
  value={input.profile.displayName}
/>
```

Render handle as read-only info row:

```tsx
<div className="grid gap-1 rounded-lg border p-3" data-settings-profile-field="handle">
  <Label>{labels.handle}</Label>
  <p className="text-sm font-medium">@{input.profile.handle}</p>
  <p className="text-xs text-muted-foreground">{labels.handleReadOnly}</p>
</div>
```

- [ ] **Step 9: 头像 preset 即时保存**

Avatar buttons:

```tsx
<Button
  aria-pressed={input.profile.avatar === preset.id ? "true" : "false"}
  data-settings-avatar-option={preset.id}
  disabled={input.pendingProfileField === "avatar"}
  onClick={() => input.onProfileChange?.({ avatar: preset.id })}
  type="button"
  variant={input.profile.avatar === preset.id ? "secondary" : "outline"}
>
```

Show `input.profileErrors?.avatar` near the avatar section with `role="alert"`.

- [ ] **Step 10: 偏好控件加 pending/error hooks**

For each preference group container:

```tsx
<div data-preference-pending={input.pendingPreference === "locale" ? "locale" : undefined}>
```

Disable current control when matching pending. Render:

```tsx
{input.preferenceError ? (
  <p className="text-sm text-destructive" role="alert">{input.preferenceError}</p>
) : null}
```

Keep no save/cancel buttons for preferences.

- [ ] **Step 11: SleiApp 初始化加载 profile**

Where App currently loads runtime/preferences/saved messages, include:

```ts
const [next, preferencesReceipt, profileReceipt, savedReceipt] = await Promise.all([
  refreshRuntime(bridge),
  bridge.listPreferences(),
  bridge.listProfile(),
  bridge.listSavedMessages(),
]);
setProfile(profileReceipt.profile);
```

Repeat in any refresh/bootstrap path that currently reloads preferences.

- [ ] **Step 12: SleiApp profile handlers**

Add:

```ts
const [pendingProfileField, setPendingProfileField] = useState<"displayName" | "avatar" | undefined>();
const [profileErrors, setProfileErrors] = useState<Partial<Record<"displayName" | "avatar", string>>>({});

async function handleProfileChange(patch: Partial<Pick<UserProfile, "displayName" | "avatar">>) {
  const field = patch.displayName !== undefined ? "displayName" : "avatar";
  if (!profile) {
    const message = messages.settings.profileUnavailable;
    setProfileErrors({ [field]: message });
    showAppToast(message, "error");
    throw new Error(message);
  }
  const previous = profile;
  setPendingProfileField(field);
  setProfileErrors((current) => ({ ...current, [field]: undefined }));
  setProfile({ ...profile, ...patch });
  try {
    const receipt = await bridge.updateProfile(patch);
    setProfile(receipt.profile);
  } catch (error) {
    setProfile(previous);
    const message = formatAppErrorToast(messages.common.operationFailed, error);
    setProfileErrors((current) => ({ ...current, [field]: message }));
    showAppToast(message, "error");
    throw error;
  } finally {
    setPendingProfileField(undefined);
  }
}
```

Pass `onProfileChange={handleProfileChange}` plus pending/error props through `SleiAppFrame`.

- [ ] **Step 13: 运行 settings tests**

```bash
pnpm --filter @slei/desktop test -- settings-preferences.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Expected: PASS。

- [ ] **Step 14: 提交**

```bash
git add apps/desktop/src/app/model.ts apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/features/settings/SettingsPageView.tsx apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/settings.ts apps/desktop/src/i18n/messages/en-US/settings.ts apps/desktop/e2e/settings-preferences.spec.tsx
git commit -m "feat: unify settings profile editing"
```

## Task 6: Preference Failure Rollback

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx`
- Modify: `apps/desktop/e2e/i18n.spec.tsx`
- Modify: `apps/desktop/e2e/settings-preferences.spec.tsx`

- [ ] **Step 1: 写 locale rollback 失败测试**

Prefer a unit-level exported helper for preference mutation because full React interaction tests are limited. In `SleiApp.tsx`, plan to extract:

```ts
export async function applyPreferenceMutation<TPreferences>(input: {
  current: TPreferences;
  optimistic: TPreferences;
  applyOptimistic: (value: TPreferences) => void;
  persist: () => Promise<TPreferences>;
  applyConfirmed: (value: TPreferences) => void;
  onError: (error: unknown) => void;
}) { ... }
```

Then add `apps/desktop/src/app/SleiApp.test.ts` test:

```ts
it("rolls back optimistic preference changes when persistence fails", async () => {
  const applied: string[] = [];
  await expect(
    applyPreferenceMutation({
      current: "zh-CN",
      optimistic: "en-US",
      applyOptimistic: (value) => applied.push(value),
      persist: async () => {
        throw new Error("daemon offline");
      },
      applyConfirmed: (value) => applied.push(`confirmed:${value}`),
      onError: () => applied.push("error"),
    }),
  ).rejects.toThrow("daemon offline");

  expect(applied).toEqual(["en-US", "zh-CN", "error"]);
});
```

- [ ] **Step 2: 写 settings preference DOM 测试**

In `settings-preferences.spec.tsx`, render settings with `pendingPreference="notifications"` and `preferenceError="保存失败"`; assert notification switch disabled/pending hooks and role alert.

- [ ] **Step 3: 运行失败测试**

```bash
pnpm --filter @slei/desktop test -- SleiApp.test.ts settings-preferences.spec.tsx i18n.spec.tsx
```

Expected: FAIL，helper/pending rollback 未实现。

- [ ] **Step 4: 实现 shared preference receipt applier**

In `SleiApp.tsx`, create:

```ts
function applyPreferencesReceipt(receipt: PreferencesReceipt) {
  setLocale(receipt.preferences.locale);
  setTimeZone(receipt.preferences.timeZone);
  setAppearance(normalizeAppearance(receipt.preferences.appearance));
  setNotifications(receipt.preferences.notifications);
}
```

Use this in load paths and preference handlers to reduce drift.

- [ ] **Step 5: 实现 rollback helper**

Export a generic helper or keep local function plus unit-testable pure helper. Required behavior:

- capture previous confirmed values before optimistic update
- apply optimistic UI immediately
- set pending preference key
- on success apply daemon receipt
- on failure restore previous values, set preference error, show toast, rethrow so field-level callers can keep errors
- clear pending in finally

Handlers should look like:

```ts
async function handleLocaleChange(nextLocale: AppLocale) {
  const previous = { locale, timeZone, appearance, notifications };
  setPendingPreference("locale");
  setPreferenceError("");
  setLocale(nextLocale);
  try {
    applyPreferencesReceipt(await bridge.updatePreferences({ locale: nextLocale }));
  } catch (error) {
    restorePreferences(previous);
    const message = formatAppErrorToast(messages.common.operationFailed, error);
    setPreferenceError(message);
    showAppToast(message, "error");
    throw error;
  } finally {
    setPendingPreference(undefined);
  }
}
```

Repeat for timeZone, appearance, notifications.

- [ ] **Step 6: 传 pending/error props**

Add to `SleiAppFrame` input and `renderWorkspace`, then to `SettingsRoute`:

```ts
pendingPreference?: "locale" | "timeZone" | "appearance" | "notifications";
preferenceError?: string;
```

- [ ] **Step 7: 运行 tests**

```bash
pnpm --filter @slei/desktop test -- SleiApp.test.ts settings-preferences.spec.tsx i18n.spec.tsx
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/features/settings/SettingsPageView.tsx apps/desktop/src/app/SleiApp.test.ts apps/desktop/e2e/i18n.spec.tsx apps/desktop/e2e/settings-preferences.spec.tsx
git commit -m "feat: rollback failed preference saves"
```

## Task 7: Members And Computers Adopt Async Entity Contract

**Files:**
- Modify: `apps/desktop/src/features/members/MembersPageView.tsx`
- Modify: `apps/desktop/src/features/computers/ComputersPageView.tsx`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/e2e/detail-editing.spec.tsx`

- [ ] **Step 1: 写失败测试：member save failure DOM**

Extend `detail-editing.spec.tsx` with a controlled error render. Add optional props to the planned component API: `memberFieldErrors?: Record<string, string>` and `savingMemberField?: string`. The test should render `SleiAppFrame` or `MembersPage` with `memberFieldErrors={{ name: "保存失败" }}` and `savingMemberField="name"`, then assert:

```ts
expect(membersHtml).toContain("slei-editable-field");
expect(membersHtml).toContain('aria-label="编辑显示名称"');
expect(membersHtml).toContain('role="alert"');
expect(membersHtml).toContain("保存失败");
expect(membersHtml).toContain('data-editable-saving="true"');
```

- [ ] **Step 2: 写失败测试：computer rename pending/error DOM**

Extend `detail-editing.spec.tsx` with optional `computerRenameError?: string` and `renamingComputerId?: string` props. Render `ComputersPage` with selected node id, `computerRenameError="保存失败"`, and `renamingComputerId` equal to the selected node id, then assert:

```ts
expect(computersHtml).toContain('aria-label="编辑设备名称"');
expect(computersHtml).toContain('role="alert"');
expect(computersHtml).toContain("保存失败");
expect(computersHtml).toContain('data-editable-saving="true"');
```

- [ ] **Step 3: 运行失败测试**

```bash
pnpm --filter @slei/desktop test -- detail-editing.spec.tsx
```

Expected: FAIL，`MembersPage`/`ComputersPage` 尚不接受受控 saving/error props，也未传给 `EditableDetailField`。

- [ ] **Step 4: make member update errors surface through fields**

In `MembersPageView.tsx`, introduce local state:

```ts
const [savingField, setSavingField] = useState<string | undefined>();
const [fieldError, setFieldError] = useState<Record<string, string>>({});
```

Change `updateMemberDetail` to await `input.onAgentUpdate`, set saving, clear field error, catch error, set `fieldError[field]`, and rethrow so `EditableDetailField` keeps draft.

Pass:

```tsx
saving={savingField === "name"}
error={fieldError.name}
```

Do the same for description/runtime/model. For description, pass `allowEmpty`.

Also accept optional controlled props for SSR tests:

```ts
memberFieldErrors?: Record<string, string>;
savingMemberField?: string;
```

Effective field error is controlled prop first, then local state:

```tsx
error={input.memberFieldErrors?.name ?? fieldError.name}
saving={(input.savingMemberField ?? savingField) === "name"}
```

- [ ] **Step 5: make computer rename async**

Change `ComputersPage` prop:

```ts
onComputerRename?: (nodeId: string, name: string) => Promise<void> | void;
computerRenameError?: string;
renamingComputerId?: string;
```

In `SleiApp.tsx`, make `handleRenameComputer` call `bridge.renameLocalNode(name)` when renaming the local node rather than only local state. Use receipt node to update `data.nodes` and `runtimeSetup.nodes`. If the app still supports draft computers, guard by node id.

Pass async handler through `SleiAppFrame`.

In `ComputersPage`, pass controlled/local state to `EditableDetailField`:

```tsx
error={input.computerRenameError ?? renameError}
saving={(input.renamingComputerId ?? renamingNodeId) === selectedNode.id}
```

- [ ] **Step 6: run relevant tests**

```bash
pnpm --filter @slei/desktop test -- detail-editing.spec.tsx computers-management.spec.tsx members.spec.ts
pnpm --filter @slei/desktop typecheck
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/features/members/MembersPageView.tsx apps/desktop/src/features/computers/ComputersPageView.tsx apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/e2e/detail-editing.spec.tsx
git commit -m "feat: apply entity editing contract to details"
```

## Task 8: Final Verification And Architecture Guardrails

**Files:**
- Modify as needed from previous tasks only.

- [ ] **Step 1: 运行 focused Rust tests**

```bash
cargo test -p slei-storage
cargo test -p slei-daemon settings_identity
cargo test -p slei-daemon settings_profile
cargo test -p slei-desktop preferences_commands
cargo test -p slei-desktop profile_commands
cargo test -p slei-desktop broker_does_not_persist_product_state_json_when_daemon_unavailable
```

Expected: PASS。

- [ ] **Step 2: 运行 focused desktop tests**

```bash
pnpm --filter @slei/desktop test -- settings-preferences.spec.tsx detail-editing.spec.tsx i18n.spec.tsx SleiApp.test.ts
pnpm --filter @slei/desktop typecheck
```

Expected: PASS。

- [ ] **Step 3: 运行 architecture guardrails**

```bash
pnpm test:guardrails
```

Expected: PASS，尤其不能新增 production JSON persistence。

- [ ] **Step 4: 运行 full local test suite if time allows**

```bash
pnpm test
cargo test
```

Expected: PASS。

- [ ] **Step 5: 检查工作区和提交**

```bash
git status --short
git log --oneline -8
```

Expected: only intentional commits from this plan; no unrelated files.

- [ ] **Step 6: 任务完成后询问合并目标**

按 `AGENTS.md` 要求，完成实现后主动询问是否合并到 `master` 或其他分支。
