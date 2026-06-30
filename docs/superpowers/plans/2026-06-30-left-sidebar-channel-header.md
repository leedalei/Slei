# Left Sidebar Channel Header Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Slei single-sidebar navigation, redesigned channel header member group, and profile image avatar upload.

**Architecture:** Keep daemon/SQLite as the source of truth. Add a daemon-owned profile avatar image upload API, expose it through the Tauri broker and desktop bridge, then refactor desktop UI into focused sidebar/header components that only render daemon DTOs and call existing callbacks. Remove the old channel member side panel and replace it with a header member group using popovers/dialogs.

**Tech Stack:** Rust daemon and Tauri commands, SQLite repositories, React 19, Radix/shadcn UI primitives, Vitest, cargo test.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-06-30-left-sidebar-channel-header-design.md`
- Guardrails: `AGENTS.md`
- Architecture: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Architecture: `docs/architecture/0006-task-source-message-card.md`
- Implementation skills: @superpowers:test-driven-development, @superpowers:subagent-driven-development, @superpowers:verification-before-completion

## File Structure

Backend/profile avatar:

- Modify `crates/slei-daemon/Cargo.toml`: add `image` for image decoding/dimensions and `sha2` for content hash.
- Modify `crates/slei-daemon/src/state.rs`: store and expose daemon `data_root`.
- Modify `crates/slei-daemon/src/services/settings_service.rs`: accept `profile-image:*` avatar refs, add upload validation/storage helpers.
- Modify `crates/slei-daemon/src/api/settings.rs`: add `POST /v1/settings/profile/avatar-image` request/response.
- Modify `crates/slei-daemon/src/app.rs`: route the new endpoint.
- Modify `crates/slei-daemon/tests/settings_identity.rs`: profile avatar API and validation coverage.

Tauri/desktop bridge:

- Modify `apps/desktop/src-tauri/src/daemon_broker.rs`: add `ProfileAvatarUploadRequest`, broker method, and tests.
- Modify `apps/desktop/src-tauri/src/commands.rs`: add `upload_profile_avatar_command`.
- Modify `apps/desktop/src-tauri/src/lib.rs`: register command, register `slei-avatar://` custom protocol, and command/protocol tests.
- Modify `apps/desktop/src/lib/daemon-bridge.ts`: add `uploadProfileAvatar` and avatar image URL helper contract.
- Modify `apps/desktop/src/lib/daemon-bridge.test.ts`: bridge behavior.

Frontend model and components:

- Modify `apps/desktop/src/app/model.ts`: avatar helpers and user presentation handling.
- Modify `apps/desktop/src/app/model.test.ts`: avatar helper tests.
- Modify `apps/desktop/src/components/member-avatar.ts`: support `profile-image:*` identities.
- Modify `apps/desktop/src/components/MemberAvatar.tsx`: render `profile-image:*` avatars as images.
- Create `apps/desktop/src/app/WorkspaceSidebar.tsx`: single left sidebar, channel/DM sections, bottom profile menu.
- Create `apps/desktop/src/features/chat/ChannelMemberGroup.tsx`: header member avatars, info popover, add modal, remove confirmation.
- Modify `apps/desktop/src/app/SleiAppFrame.tsx`: remove primary rail, wire `WorkspaceSidebar`, route footer menu actions.
- Modify `apps/desktop/src/features/chat/ChatPageView.tsx`: redesigned header, remove `ChannelMemberPanel`.
- Modify `apps/desktop/src/features/settings/SettingsPageView.tsx`: add image upload control to account panel.
- Modify `apps/desktop/src/i18n/messages/zh-CN/*.ts`, `apps/desktop/src/i18n/messages/en-US/*.ts`, and `apps/desktop/src/i18n/types.ts`: new labels/errors.
- Modify `apps/desktop/src/app/app.css`: sidebar/header/member group styling.

Frontend tests:

- Modify `apps/desktop/src/app/SleiAppFrame.test.tsx`
- Modify `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- Modify `apps/desktop/src/features/settings/SettingsPageView.test.tsx`
- Modify relevant e2e/static markup tests under `apps/desktop/e2e/` that assert old rail/member panel behavior.

## Task 1: Daemon Profile Image Avatar Contract

**Files:**
- Modify: `crates/slei-daemon/Cargo.toml`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/src/services/settings_service.rs`
- Modify: `crates/slei-daemon/src/api/settings.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Test: `crates/slei-daemon/tests/settings_identity.rs`

- [ ] **Step 1: Write failing API tests**

Add tests to `crates/slei-daemon/tests/settings_identity.rs`:

```rust
#[tokio::test]
async fn settings_profile_avatar_image_upload_persists_reference_and_file() {
    let root = temp_data_root();
    let token = AuthToken::from_static("avatar-token");
    let app = build_router(AppState::for_tests_with_agent_root(token.clone(), root.clone()));

    // Create profile with SettingsService::create_profile before building/reloading the app.
    // Use this 1x1 PNG base64:
    // iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=
    // POST /v1/settings/profile/avatar-image with fileName avatar.png and mimeType image/png.
    // Assert response profile.avatar starts with "profile-image:" and ends with ".png".
    // Assert root/profile/avatars/<hash>.png exists.
    // Reload AppState with same root and assert GET /v1/settings/profile returns the same avatar.
}

#[tokio::test]
async fn settings_profile_avatar_image_upload_rejects_invalid_inputs() {
    // table cases:
    // - mime image/png with .jpg file name
    // - text/plain payload
    // - empty bytesBase64
    // - decoded bytes over 2 MiB
    // - valid image bytes with dimensions over 2048x2048
}
```

- [ ] **Step 2: Run failing daemon tests**

Run:

```bash
cargo test -p slei-daemon --test settings_identity settings_profile_avatar_image -- --nocapture
```

Expected: FAIL because the route and request type do not exist.

- [ ] **Step 3: Add dependencies**

In `crates/slei-daemon/Cargo.toml`, add:

```toml
image = { version = "0.25", default-features = false, features = ["png", "jpeg", "webp"] }
sha2 = "0.10"
```

- [ ] **Step 4: Store daemon data root in AppState**

In `crates/slei-daemon/src/state.rs`, add a `data_root: PathBuf` field to `AppState`, set it in `with_agent_root_and_store`, and expose:

```rust
pub fn data_root(&self) -> &PathBuf {
    &self.data_root
}
```

Expected: existing state constructors still compile and tests still use their temp root.

- [ ] **Step 5: Implement avatar image helpers in settings service**

In `settings_service.rs`, add a bounded upload request model or helper input:

```rust
pub struct AvatarImageUpload {
    pub file_name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub data_root: PathBuf,
}
```

Implement validation:

- decoded bytes length is `1..=2 * 1024 * 1024`
- MIME/ext pairs: `image/png` + `.png`, `image/jpeg` + `.jpg|.jpeg`, `image/webp` + `.webp`
- `image::load_from_memory(&bytes)` succeeds
- width and height are both `1..=2048`
- sha256 hex file name is generated from bytes
- file is written to `data_root/profile/avatars/<hash>.<ext>`
- returned avatar ref is `profile-image:<hash>.<ext>`

Also update `is_supported_avatar`:

```rust
fn is_supported_avatar(avatar: &str) -> bool {
    matches!(avatar, "pixel-sun" | "pixel-moon" | "pixel-cube" | "pixel-spark")
        || is_supported_profile_image_ref(avatar)
}
```

Define `is_supported_profile_image_ref` strictly:

```rust
fn is_supported_profile_image_ref(avatar: &str) -> bool {
    let Some(file_name) = avatar.strip_prefix("profile-image:") else {
        return false;
    };
    let Some((hash, ext)) = file_name.rsplit_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash.chars().all(|character| character.is_ascii_hexdigit())
        && matches!(ext, "png" | "jpg" | "jpeg" | "webp")
}
```

Add tests proving malformed refs such as `profile-image:../x.png`, `profile-image:nothex.png`, and absolute paths are rejected by existing `PATCH /v1/settings/profile`.

- [ ] **Step 6: Add daemon API route**

In `api/settings.rs`, add:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAvatarImageUploadRequest {
    file_name: String,
    mime_type: String,
    bytes_base64: String,
}
```

Add handler:

```rust
pub async fn upload_profile_avatar_image(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ProfileAvatarImageUploadRequest>,
) -> Response
```

The handler must authorize, use `begin_resettable_write`, decode base64, call settings service, and return `{ "profile": UserProfileView }`.

In `app.rs`, add:

```rust
.route("/v1/settings/profile/avatar-image", post(api::settings::upload_profile_avatar_image))
```

- [ ] **Step 7: Run daemon tests**

Run:

```bash
cargo fmt --check
cargo test -p slei-daemon --test settings_identity
```

Expected: PASS.

- [ ] **Step 8: Commit backend avatar API**

```bash
git add crates/slei-daemon/Cargo.toml crates/slei-daemon/src/state.rs crates/slei-daemon/src/services/settings_service.rs crates/slei-daemon/src/api/settings.rs crates/slei-daemon/src/app.rs crates/slei-daemon/tests/settings_identity.rs
git commit -m "feat: add profile avatar image upload api"
```

## Task 2: Tauri Bridge And Desktop Avatar Helpers

**Files:**
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.test.ts`
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/model.test.ts`

- [ ] **Step 1: Write failing bridge tests**

In `apps/desktop/src/lib/daemon-bridge.test.ts`, add tests for upload and avatar URL helper:

```ts
await bridge.uploadProfileAvatar({
  fileName: "avatar.png",
  mimeType: "image/png",
  bytesBase64: "..."
});
```

Expected Tauri invoke command:

```ts
expect(invokeMock).toHaveBeenCalledWith("upload_profile_avatar_command", {
  request: { fileName: "avatar.png", mimeType: "image/png", bytesBase64: "..." },
});
expect(profileAvatarImageUrl("profile-image:" + "a".repeat(64) + ".png"))
  .toBe("slei-avatar:///aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");
```

In `apps/desktop/src/app/model.test.ts`, add tests for:

```ts
expect(isProfileImageAvatar("profile-image:" + "a".repeat(64) + ".png")).toBe(true);
expect(isProfileImageAvatar("profile-image:abc.png")).toBe(false);
expect(isProfileImageAvatar("pixel-sun")).toBe(false);
expect(profileAvatarImageUrl("profile-image:" + "b".repeat(64) + ".webp"))
  .toBe("slei-avatar:///bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp");
```

In `apps/desktop/src-tauri/src/lib.rs` tests, add a protocol resolver test using the exact helper-produced URL shape `slei-avatar:///<64 hex>.png` and invalid traversal-like inputs. The valid case must prove that a file under `<data_root>/profile/avatars/<hash>.png` can be read and returned with `image/png`.

- [ ] **Step 2: Run failing desktop tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts src/app/model.test.ts
```

Expected: FAIL because APIs do not exist.

- [ ] **Step 3: Add Tauri broker request and command**

In `daemon_broker.rs`, add:

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAvatarUploadRequest {
    pub file_name: String,
    pub mime_type: String,
    pub bytes_base64: String,
}
```

Add `DaemonBroker::upload_profile_avatar(&self, request: ProfileAvatarUploadRequest) -> Result<ProfileReceipt, ProfileError>` that sends `POST /v1/settings/profile/avatar-image`.

In `commands.rs`, add:

```rust
#[tauri::command]
pub fn upload_profile_avatar_command(
    state: tauri::State<'_, DaemonBroker>,
    request: ProfileAvatarUploadRequest,
) -> Result<ProfileReceipt, String>
```

In `lib.rs`, register `commands::upload_profile_avatar_command`.

Also register a `slei-avatar:///<file>` custom protocol. The helper-produced URL has an empty host and a single path segment, for example `slei-avatar:///aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png`. The handler must:

- accept only `<64 hex>.(png|jpg|jpeg|webp)` path segments
- reject slashes, `..`, query strings, and unsupported extensions
- read only from `DaemonBroker`/state data root `profile/avatars/<file>`
- return the correct image MIME type
- return 404 for missing files

If the Tauri protocol API needs the handler during builder setup, extract pure helpers such as `profile_avatar_file_from_uri(data_root, uri)` and `profile_avatar_mime(file_name)` so they can be unit-tested without launching a WebView.

- [ ] **Step 4: Add desktop bridge API**

In `daemon-bridge.ts`, add:

```ts
export type ProfileAvatarUploadRequest = {
  fileName: string;
  mimeType: string;
  bytesBase64: string;
};

uploadProfileAvatar(request: ProfileAvatarUploadRequest): Promise<ProfileReceipt>;
```

Wire online bridge to `invoke("upload_profile_avatar_command", { request })`; offline bridge rejects like other profile mutations.

- [ ] **Step 5: Add avatar helper functions**

In `model.ts`, add:

```ts
export function isProfileImageAvatar(avatar: string | undefined): boolean {
  return /^profile-image:[a-fA-F0-9]{64}\.(png|jpg|jpeg|webp)$/.test(avatar ?? "");
}

export function profileAvatarImageUrl(avatar: string): string | undefined {
  if (!isProfileImageAvatar(avatar)) return undefined;
  return `slei-avatar:///${encodeURIComponent(avatar.slice("profile-image:".length))}`;
}
```

Do not use a placeholder URL scheme. The `slei-avatar://` protocol must be registered in Tauri before Task 6 renders it in `<img src>`.

- [ ] **Step 6: Run bridge tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts src/app/model.test.ts
cargo test -p slei --lib profile
```

Expected: PASS.

- [ ] **Step 7: Commit bridge work**

```bash
git add apps/desktop/src-tauri/src/daemon_broker.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/daemon-bridge.ts apps/desktop/src/lib/daemon-bridge.test.ts apps/desktop/src/app/model.ts apps/desktop/src/app/model.test.ts
git commit -m "feat: bridge profile avatar image uploads"
```

## Task 3: Profile Settings Upload UI

**Files:**
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.test.tsx`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/settings.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/settings.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`

- [ ] **Step 1: Write failing SettingsPage tests**

Add tests that mount the account panel and assert:

- upload input exists with localized label
- selecting a valid image calls `onProfileAvatarUpload`
- upload disabled while `pendingProfileField === "avatar"`
- profile unavailable does not render active upload control

Example:

```tsx
const onProfileAvatarUpload = vi.fn().mockResolvedValue(undefined);
const validPngBytes = Uint8Array.from([137, 80, 78, 71]);
const file = new File([validPngBytes], "avatar.png", { type: "image/png" });
await uploadFile(inputByLabel(root, "上传头像图片"), file);
expect(onProfileAvatarUpload).toHaveBeenCalledWith(file);
```

- [ ] **Step 2: Run failing settings test**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/settings/SettingsPageView.test.tsx
```

Expected: FAIL because upload prop/control does not exist.

- [ ] **Step 3: Add SettingsPage upload prop and UI**

Add prop:

```ts
onProfileAvatarUpload?: (file: File) => Promise<void> | void;
```

In account panel, add a file input accepting `.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp` and a button-style label. Keep existing preset buttons.

- [ ] **Step 4: Wire upload in SleiApp**

In `SleiApp.tsx`, add `handleProfileAvatarUpload(file: File)`:

1. Set pending avatar field.
2. Validate obvious frontend cases: non-empty file and supported MIME.
3. Convert `await file.arrayBuffer()` to base64.
4. Call `bridge.uploadProfileAvatar({ fileName: file.name, mimeType: file.type, bytesBase64 })`.
5. Set returned profile.
6. Show success toast or error toast.

Do not store the avatar file in React/localStorage.

Thread this callback through the existing render path:

- Add `onProfileAvatarUpload?: (file: File) => Promise<void> | void` to `SleiAppFrameProps`.
- Pass it from `SleiApp` into `SleiAppFrame`.
- Add it to `renderWorkspace(...)`.
- Add it to `SettingsRoute(...)`.
- Pass it into `SettingsPage`.

Add a focused `SleiAppFrame.test.tsx` assertion that rendering the settings account panel with `onProfileAvatarUpload` lets the upload control call that callback.

- [ ] **Step 5: Run settings tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/settings/SettingsPageView.test.tsx src/app/SleiApp.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit settings upload UI**

```bash
git add apps/desktop/src/features/settings/SettingsPageView.tsx apps/desktop/src/features/settings/SettingsPageView.test.tsx apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/settings.ts apps/desktop/src/i18n/messages/en-US/settings.ts apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/SleiAppFrame.test.tsx
git commit -m "feat: add profile avatar upload controls"
```

## Task 4: Single Workspace Sidebar

**Files:**
- Create: `apps/desktop/src/app/WorkspaceSidebar.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`
- Modify: `apps/desktop/e2e/react-shell.spec.tsx`
- Modify: `apps/desktop/e2e/i18n.spec.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/shell.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/shell.ts`

- [ ] **Step 1: Write failing sidebar tests**

In `SleiAppFrame.test.tsx`, add/adjust tests:

```tsx
expect(html).not.toContain("slei-shell-nav");
expect(html).toContain("slei-workspace-sidebar");
expect(html).toContain("搜索");
expect(html).toContain("任务");
expect(html).not.toContain("data-nav-icon=\"members\"");
expect(html).not.toContain("关联项目：");
expect(html).not.toContain("研发频道描述");
```

Add interaction test for bottom settings menu:

```tsx
fireEvent.click(screen.getByLabelText("打开设置菜单"));
fireEvent.click(screen.getByText("运行设备"));
expect(onViewChange).toHaveBeenCalledWith("computers");
```

Add interaction tests for sidebar context menus:

```tsx
fireEvent.contextMenu(screen.getByTestId("workspace-channel-row-dev"));
expect(screen.getByText("编辑频道")).toBeTruthy();
expect(screen.getByText("删除频道")).toBeTruthy();

fireEvent.contextMenu(screen.getByTestId("workspace-channel-row-all"));
expect(screen.queryByText("删除频道")).toBeNull();

fireEvent.keyDown(screen.getByTestId("workspace-channel-row-dev"), { key: "F10", shiftKey: true });
expect(screen.getByText("编辑频道")).toBeTruthy();

fireEvent.click(screen.getByLabelText("频道 dev 更多操作"));
expect(screen.getByText("编辑频道")).toBeTruthy();

fireEvent.contextMenu(screen.getByTestId("workspace-dm-row-agent_coda"));
expect(screen.getByText("打开成员资料")).toBeTruthy();
expect(screen.getByText("打开私聊")).toBeTruthy();
```

- [ ] **Step 2: Run failing sidebar tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx
```

Expected: FAIL because old primary rail still renders.

- [ ] **Step 3: Extract WorkspaceSidebar**

Create `WorkspaceSidebar.tsx` with props:

```ts
type WorkspaceSidebarProps = {
  activeView: AppView;
  activeChannelId?: string;
  activeConversationId?: string;
  activeChatWorkspace?: ChatWorkspaceMode;
  channels: SleiFixtures["channels"];
  conversations: ConversationView[];
  members: SleiMember[];
  messages: DesktopMessages;
  profile: UserProfile | null;
  onViewChange?: (view: AppView) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationSelect?: (conversationId: string) => void;
  onMemberSelect?: (memberId: string) => void;
  onSavedMessagesOpen?: () => void;
  onChannelCreateClick: () => void;
  onChannelDelete?: (channelId: string) => void;
  onChannelEdit?: (channelId: string) => void;
};
```

Move channel/DM sorting logic from `ChannelList` into this component or a local helper. Keep existing localStorage keys.

- [ ] **Step 4: Add right-click and keyboard menus**

Use `DropdownMenu` or Radix context menu pattern. Requirements:

- right-click opens menu
- focused row more button opens same menu
- `Shift+F10` opens same menu
- `all` channel omits delete
- edit action opens existing project/channel edit path
- DM menu contains `打开成员资料` and `打开私聊`
- `打开成员资料` calls `onMemberSelect(memberId)` and `onViewChange("members")`
- `打开私聊` calls `onConversationSelect(conversationId)`

- [ ] **Step 5: Replace primary rail in SleiAppFrame**

Remove `navItems` render from the shell. Change grid columns to:

```ts
gridTemplateColumns: hasWorkspaceSidebar
  ? `var(--app-sidebar-width, 15rem) 3px minmax(0, 1fr)`
  : `minmax(0, 1fr)`
```

For `tasks` and `search`, keep the workspace sidebar visible; the old `hasContextSidebar = input.activeView !== "tasks" && input.activeView !== "search"` behavior should be replaced.

- [ ] **Step 6: Run sidebar tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx
pnpm --filter @slei/desktop test -- e2e/react-shell.spec.tsx e2e/i18n.spec.tsx
```

Expected: PASS after updating stale assertions.

- [ ] **Step 7: Commit sidebar refactor**

```bash
git add apps/desktop/src/app/WorkspaceSidebar.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/SleiAppFrame.test.tsx apps/desktop/e2e/react-shell.spec.tsx apps/desktop/e2e/i18n.spec.tsx apps/desktop/src/app/app.css apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/shell.ts apps/desktop/src/i18n/messages/en-US/shell.ts
git commit -m "feat: replace rail with workspace sidebar"
```

## Task 5: Channel Header Member Group

**Files:**
- Create: `apps/desktop/src/features/chat/ChannelMemberGroup.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- Modify: `apps/desktop/e2e/channel-embedded-views.spec.tsx`
- Modify: `apps/desktop/e2e/real-agents-dm.spec.tsx`
- Modify: `apps/desktop/src/app/app.css`

- [ ] **Step 1: Write failing channel header tests**

In `ChatPageView.test.tsx`, add tests:

```tsx
expect(screen.getByTestId("slei-channel-title")).toHaveTextContent("#dev");
expect(screen.getByTestId("slei-channel-member-count")).toHaveTextContent("4 Agent");
expect(screen.getByTestId("slei-channel-member-group")).toBeTruthy();
expect(screen.queryByTestId("slei-channel-member-panel")).toBeNull();
expect(screen.queryByTestId("slei-channel-members-header-toggle")).toBeNull();
```

Add interaction tests:

- click group `+` opens existing add member modal
- selecting candidates and confirming calls `onChannelMemberAdd`
- hover/focus member avatar opens info card
- remove button opens confirm and calls `onChannelMemberRemove`

- [ ] **Step 2: Run failing chat tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL because old member panel/header toggle still exists.

- [ ] **Step 3: Extract ChannelMemberGroup**

Create `ChannelMemberGroup.tsx` with props:

```ts
type ChannelMemberGroupProps = {
  availableMembers: SleiMember[];
  channelId: string;
  members: SleiMember[];
  messages: DesktopMessages;
  onAdd?: (agentId: string) => Promise<void> | void;
  onRemove?: (agentId: string) => Promise<void> | void;
};
```

Move add-member dialog state and multi-select logic from `ChannelMemberPanel` into this component. Keep the add dialog markup and callbacks.

- [ ] **Step 4: Add member popover card**

For each visible member, render a `Popover`/`Tooltip` compatible avatar button. Card includes:

- avatar
- name
- handle
- description/role
- readiness label
- remove button

Remove uses existing `AlertDialog` confirmation and `onRemove`.

- [ ] **Step 5: Remove ChannelMemberPanel layout**

In `ChatPageView.tsx`:

- remove `channelMembersOpen`
- remove `showChannelMembersPanel`
- remove `renderChannelMemberPanelRegion`
- remove header toggle
- make main region `grid-cols-1`
- render `ChannelMemberGroup` in header actions for channels only
- keep DM header without member group

- [ ] **Step 6: Update channel title styles**

Header left side:

```tsx
<h1 data-testid="slei-channel-title">#{stripChannelHash(activeChannel.name)}</h1>
<Badge data-testid="slei-channel-member-count">{channelMembers.length} Agent</Badge>
<p>{detailSubtitle}</p>
```

Use existing muted tokens and avoid oversized text.

- [ ] **Step 7: Run chat and e2e tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
pnpm --filter @slei/desktop test -- e2e/channel-embedded-views.spec.tsx e2e/real-agents-dm.spec.tsx
```

Expected: PASS after updating assertions that expected the old panel.

- [ ] **Step 8: Commit channel header work**

```bash
git add apps/desktop/src/features/chat/ChannelMemberGroup.tsx apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/features/chat/ChatPageView.test.tsx apps/desktop/e2e/channel-embedded-views.spec.tsx apps/desktop/e2e/real-agents-dm.spec.tsx apps/desktop/src/app/app.css
git commit -m "feat: add channel header member group"
```

## Task 6: Avatar Rendering Integration

**Files:**
- Modify: `apps/desktop/src/components/member-avatar.ts`
- Modify: `apps/desktop/src/components/MemberAvatar.tsx`
- Modify: `apps/desktop/src/components/MemberAvatar.test.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.test.tsx`

- [ ] **Step 1: Write failing avatar rendering tests**

Add tests:

```tsx
const ref = "profile-image:" + "a".repeat(64) + ".png";
render(<MemberAvatar identity={{ id: "human", name: "Lei", handle: "@lei", avatar: ref }} />);
expect(screen.getByRole("img", { hidden: true }))
  .toHaveAttribute("src", "slei-avatar:///aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");
```

If the current avatar component renders background images instead of `<img>`, assert the equivalent DOM attribute/style.

Also keep the Tauri-side protocol resolver test from Task 2. Do not accept a test that only verifies the DOM string; the Tauri test must prove `slei-avatar://...` resolves to bytes from `profile/avatars`.

- [ ] **Step 2: Run failing avatar tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/MemberAvatar.test.tsx src/app/SleiAppFrame.test.tsx src/features/settings/SettingsPageView.test.tsx
```

Expected: FAIL until `profile-image:*` is rendered as an image.

- [ ] **Step 3: Implement centralized avatar rendering**

Update avatar rendering:

- `profile-image:*` renders image URL from `profileAvatarImageUrl`
- `pixel-*` and agent avatar seeds keep DiceBear behavior
- unknown/empty avatar falls back to initials

Do not compute image URLs outside the helper.

- [ ] **Step 4: Run avatar tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/MemberAvatar.test.tsx src/app/model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit avatar rendering**

```bash
git add apps/desktop/src/components/member-avatar.ts apps/desktop/src/components/MemberAvatar.tsx apps/desktop/src/components/MemberAvatar.test.tsx apps/desktop/src/app/SleiAppFrame.test.tsx apps/desktop/src/features/settings/SettingsPageView.test.tsx
git commit -m "feat: render profile image avatars"
```

## Task 7: Final Verification And Cleanup

**Files:**
- Review all modified files.
- Update any stale tests under `apps/desktop/e2e/`.
- No production docs update required unless implementation changes the accepted design.

- [ ] **Step 1: Run formatting and focused Rust tests**

Run:

```bash
cargo fmt --check
cargo test -p slei-daemon --test settings_identity
cargo test -p slei --lib
```

Expected: PASS.

- [ ] **Step 2: Run focused desktop tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx src/features/chat/ChatPageView.test.tsx src/features/settings/SettingsPageView.test.tsx src/lib/daemon-bridge.test.ts src/app/model.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full desktop validation**

Run:

```bash
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop lint
```

Expected: PASS.

- [ ] **Step 4: Run architecture guardrails**

Run:

```bash
pnpm test:guardrails
```

Expected: PASS.

- [ ] **Step 5: Manual UI smoke test**

Run:

```bash
pnpm --filter @slei/desktop dev
```

Check:

- left rail is gone
- left sidebar top has only search/tasks
- channel/DM list rows show only names
- channel `+`, channel sort, DM sort work
- right-click and keyboard menu work
- bottom profile menu routes to members/computers/profile/saved/settings
- channel header shows title, member count pill, subtitle, member group
- member hover/focus card opens
- add member modal works
- remove member confirm works
- image avatar upload updates bottom profile, settings profile, and local user message avatar

- [ ] **Step 6: Final git status**

Run:

```bash
git status --short
```

Expected: clean or only intentional uncommitted work.

## Implementation Notes

- Do not revert unrelated user changes.
- Keep React components presentation-oriented; daemon DTOs remain source of truth.
- Do not reintroduce local mock data for empty channels, DMs, members, or profile.
- Existing localStorage sort keys are UI preferences and may remain.
- If image resource URL serving requires Tauri-specific asset conversion, isolate it in `profileAvatarImageUrl` or one bridge helper.
- If this branch is implemented in parallel, split workers by task boundaries: backend avatar API, Tauri bridge/settings upload, workspace sidebar, channel member group.
