# Slei Global Search Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daemon-backed global search entry in the left navigation that searches agents, channels, channel messages, and DM messages with real filters, categorized results, keyword highlighting, and result navigation.

**Architecture:** Add a daemon `/v1/search/global` read API backed by SQLite repositories, expose it through the Tauri broker and desktop bridge, then replace the current frontend-only search page with a daemon DTO-driven global search UI. The React layer owns only input/filter state, loading/error/empty rendering, safe highlight rendering, and navigation to daemon-backed targets.

**Tech Stack:** Rust, axum, sqlx/SQLite, Tauri commands, TypeScript, React, Vitest/Testing Library, existing Slei i18n and shadcn-style UI components.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-06-17-slei-global-search-design.md`
- Guardrails: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Guardrails: `docs/architecture/0006-task-source-message-card.md`

## File Structure

Create:

- `crates/slei-daemon/src/services/search_service.rs` - daemon search service, request normalization, time range boundaries, DTO assembly, snippet generation.
- `crates/slei-daemon/src/api/search.rs` - `/v1/search/global` handler and query parsing.
- `crates/slei-daemon/tests/global_search_api.rs` - daemon API contract tests.
- `apps/desktop/src/features/search/types.ts` - frontend search DTO and filter types.
- `apps/desktop/src/features/search/highlight.tsx` - safe keyword highlighting helper.
- `apps/desktop/src/features/search/highlight.test.tsx` - highlight helper tests.
- `docs/superpowers/plans/2026-06-17-slei-global-search.md` - this plan.

Modify:

- `crates/slei-storage/src/repositories/mod.rs` - add repository search methods for agents, channels, channel messages, and conversation messages.
- `crates/slei-storage/src/lib.rs` - add repository unit tests.
- `crates/slei-daemon/src/state.rs` - add `SearchService` to `AppState`.
- `crates/slei-daemon/src/app.rs` - register `/v1/search/global`.
- `crates/slei-daemon/src/api/mod.rs` - add `pub mod search`.
- `Cargo.toml` / `crates/slei-daemon/Cargo.toml` - add `chrono` and `chrono-tz` for IANA day-boundary calculation.
- `apps/desktop/src-tauri/src/daemon_broker.rs` - add broker DTOs and `global_search`.
- `apps/desktop/src-tauri/src/commands.rs` - add `global_search_command`.
- `apps/desktop/src-tauri/src/lib.rs` - register command if command list is explicit.
- `apps/desktop/src/lib/daemon-bridge.ts` - add TS DTOs and `globalSearch`.
- `apps/desktop/src/test/daemon-bridge-mock.ts` - add mock bridge handler if it implements the full bridge.
- `apps/desktop/src/i18n/messages/zh-CN/search.ts` - add Chinese global search strings.
- `apps/desktop/src/i18n/messages/en-US/search.ts` - add English global search strings.
- `apps/desktop/src/i18n/messages/zh-CN/shell.ts` - add/confirm left-nav search label if shell nav typing needs it.
- `apps/desktop/src/i18n/messages/en-US/shell.ts` - add/confirm left-nav search label if shell nav typing needs it.
- `apps/desktop/src/i18n/types.ts` - update search and shell nav message types.
- `apps/desktop/src/features/search/SearchPageView.tsx` - replace frontend fixture filtering with daemon-backed global search UI.
- `apps/desktop/src/app/SleiApp.tsx` - wire global search call and result selection navigation.
- `apps/desktop/src/app/SleiAppFrame.tsx` - add left nav search button, remove/downgrade old conversation-list search entry, pass search props.
- `apps/desktop/src/features/chat/ChatPageView.tsx` - add blink border class behavior for focused messages.
- `apps/desktop/src/app/app.css` - add blink border keyframes/class.
- `apps/desktop/src/app/SleiApp.test.ts` - add routing/helper tests if logic lives in app model.
- `apps/desktop/src/features/search/SearchPageView.test.tsx` - create component tests.
- `apps/desktop/e2e/global-search.spec.tsx` - cover DOM and navigation interactions.

Do not:

- Reintroduce frontend fixture search for production.
- Add JSON production persistence.
- Add FTS or ranking in this iteration.
- Add a separate conversation-list search experience.

---

### Task 1: Storage Repository Search

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: Add failing repository tests for categorized search primitives**

Add focused tests in `crates/slei-storage/src/lib.rs` near existing repository tests. Cover:

```rust
#[tokio::test]
async fn global_search_channel_messages_excludes_deleted_and_clamps_limit() {
    let (url, _path) = sqlite_file_url("global-search-channel-messages");
    let db = SleiDb::connect(&url).await.unwrap();
    let repos = Repositories::new(db.pool().clone());
    // Insert >80 matching channel messages plus deleted/tombstone rows.
    // Assert search_channel_messages_for_global_search("needle", None, None, None, None, 500).len() == 80.
    // Assert deleted/tombstone ids are absent.
}

#[tokio::test]
async fn global_search_conversation_messages_supports_from_and_time_filters() {
    let (url, _path) = sqlite_file_url("global-search-dm-messages");
    let db = SleiDb::connect(&url).await.unwrap();
    let repos = Repositories::new(db.pool().clone());
    // Insert conversation messages from human:local and agent_coda at two dates.
    // Assert body-only query matches, from_id filters authors, and start/end filters created_at.
}
```

Also add tests for agent/channel limits:

```rust
#[tokio::test]
async fn global_search_agents_and_channels_clamp_to_twenty() {
    // Insert >20 matching agents/channels.
    // Assert repository methods return exactly 20 and hide system-owned/internal agents.
}
```

- [ ] **Step 2: Run storage tests to verify they fail**

Run:

```sh
cargo test -p slei-storage global_search -- --nocapture
```

Expected: FAIL because repository methods do not exist.

- [ ] **Step 3: Add repository row types and query methods**

In `crates/slei-storage/src/repositories/mod.rs`, add small result structs:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSearchRow {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub description: String,
    pub avatar_seed: String,
    pub system_owned: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelSearchRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationMessageSearchRow {
    pub id: String,
    pub conversation_id: String,
    pub session_id: Option<String>,
    pub author_id: String,
    pub body: String,
    pub created_at: String,
}
```

Add methods on `Repositories`:

```rust
pub async fn search_agents(&self, query: &str, limit: i64) -> Result<Vec<AgentSearchRow>, sqlx::Error>;
pub async fn search_channels(&self, query: &str, limit: i64) -> Result<Vec<ChannelSearchRow>, sqlx::Error>;
pub async fn search_channel_messages_for_global_search(
    &self,
    query: &str,
    from_id: Option<&str>,
    channel_id: Option<&str>,
    start_at: Option<&str>,
    end_at: Option<&str>,
    limit: i64,
) -> Result<Vec<ChannelMessageRow>, sqlx::Error>;
pub async fn search_conversation_messages_for_global_search(
    &self,
    query: &str,
    from_id: Option<&str>,
    start_at: Option<&str>,
    end_at: Option<&str>,
    limit: i64,
) -> Result<Vec<ConversationMessageSearchRow>, sqlx::Error>;
```

Implementation requirements:

- Use existing `escape_like_pattern(query)`.
- Clamp agents/channels to 20 and messages to 80.
- Message keyword matches body/content only.
- `from_id` filters `author_id`.
- `channel_id` applies only to channel messages.
- Exclude channel `deleted = 1`, `kind = 'tombstone'`, and task control kinds.
- Order messages by newest first.

- [ ] **Step 4: Run storage tests**

Run:

```sh
cargo test -p slei-storage global_search -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit storage layer**

```sh
git add crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs
git commit -m "feat: add global search repositories"
```

---

### Task 2: Daemon Search Service and API

**Files:**
- Create: `crates/slei-daemon/src/services/search_service.rs`
- Create: `crates/slei-daemon/src/api/search.rs`
- Create: `crates/slei-daemon/tests/global_search_api.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `crates/slei-daemon/src/api/mod.rs`
- Modify: `crates/slei-daemon/Cargo.toml`
- Modify: `Cargo.lock`

- [ ] **Step 1: Write failing API tests**

Create `crates/slei-daemon/tests/global_search_api.rs` using the helper style from `agent_workspace.rs`.

Tests:

```rust
#[tokio::test]
async fn global_search_rejects_empty_query() {
    let token = AuthToken::from_static("search-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let response = get_json(&app, &token, "/v1/search/global?query=%20").await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn global_search_returns_agents_channels_and_messages() {
    // Create Coda, create #dev-team, send channel and DM messages containing "needle".
    // GET /v1/search/global?query=needle
    // Assert body["agents"][0]["agentId"], body["channels"][0]["channelId"],
    // body["messages"] include sourceKind/messageId/channelId or conversationId.
}

#[tokio::test]
async fn global_search_channel_filter_excludes_dm_messages() {
    // Create a real channel, e.g. dev-team.
    // Insert one matching message in dev-team, one matching message in another channel,
    // and one matching DM message.
    // GET /v1/search/global?query=needle&channelId=dev-team
    // Assert messages only contain sourceKind == "channel" and channelId == "dev-team".
}

#[tokio::test]
async fn global_search_channel_message_result_includes_session_id_for_transition() {
    // Create a channel session, insert/search a matching message in that session.
    // Assert returned channel message result includes sessionId.
    // This is an internal compatibility field while the desktop still stores channel messages by active session.
}
```

- [ ] **Step 2: Run daemon search tests to verify they fail**

Run:

```sh
cargo test -p slei-daemon --test global_search_api -- --nocapture
```

Expected: FAIL because route/service do not exist.

- [ ] **Step 3: Implement `SearchService` DTOs and query normalization**

Create `crates/slei-daemon/src/services/search_service.rs`.

Include:

```rust
#[derive(Clone, Debug)]
pub struct SearchService {
    repos: Repositories,
}

#[derive(Debug, Clone)]
pub struct GlobalSearchInput {
    pub query: String,
    pub from_id: Option<String>,
    pub channel_id: Option<String>,
    pub time_range: TimeRange,
    pub time_zone: Option<String>,
    pub include_agents: bool,
    pub include_channels: bool,
    pub include_messages: bool,
    pub agent_limit: i64,
    pub channel_limit: i64,
    pub message_limit: i64,
}
```

Add serializable response DTOs with camelCase:

```rust
pub struct GlobalSearchResponse {
    pub query: String,
    pub totals: GlobalSearchTotals,
    pub agents: Vec<GlobalAgentSearchResult>,
    pub channels: Vec<GlobalChannelSearchResult>,
    pub messages: Vec<GlobalMessageSearchResult>,
}
```

Requirements:

- Trim query; empty query returns a service error mapped to 400.
- Normalize limits to spec maxima.
- Time boundaries:
  - Today: local start of day to next day.
  - Last 7/30 Days: local start of today minus 6/29 days through next day.
  - Add `chrono = "0.4"` and `chrono-tz = "0.10"` to `crates/slei-daemon/Cargo.toml`.
  - Use `chrono_tz::Tz` to parse the effective IANA timezone passed by the API handler.
  - `SearchService` receives an already-resolved timezone string; it does not read user preferences directly.
- Generate snippets in daemon:
  - Around first case-insensitive match.
  - Maximum 180 chars.
  - If no body match, use body prefix.
- Agents/channels can use title/subtitle without snippet.
- Channel message results must include `sessionId` while the current desktop code still loads channel messages through active sessions. This field is internal transition compatibility, not a user-facing search requirement.
- Agent results exclude user-invisible system-owned/internal agents consistently with member list rules.

- [ ] **Step 4: Wire service into `AppState`**

Modify `crates/slei-daemon/src/state.rs`:

- Add `use crate::services::search_service::SearchService;`.
- Add `search_service: SearchService` field.
- Instantiate in `with_agent_root_and_store`.
- Add getter:

```rust
pub fn search(&self) -> &SearchService {
    &self.search_service
}
```

Also add `pub mod search_service;` in `crates/slei-daemon/src/services/mod.rs` if that module list exists.

- [ ] **Step 5: Implement API handler and route**

Create `crates/slei-daemon/src/api/search.rs`.

Handler outline:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchQuery {
    query: String,
    from_id: Option<String>,
    channel_id: Option<String>,
    time_range: Option<String>,
    time_zone: Option<String>,
    include_agents: Option<bool>,
    include_channels: Option<bool>,
    include_messages: Option<bool>,
    agent_limit: Option<i64>,
    channel_limit: Option<i64>,
    message_limit: Option<i64>,
}

pub async fn global(State(state): State<AppState>, Query(query): Query<GlobalSearchQuery>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };
    // Resolve effective timezone:
    // 1. query.time_zone if it parses as chrono_tz::Tz
    // 2. state.settings().preferences().await.time_zone if it parses
    // 3. "Asia/Shanghai"
    // Convert query, call state.search().global_search(input_with_effective_timezone).await.
}
```

Modify:

- `crates/slei-daemon/src/api/mod.rs`: `pub mod search;`
- `crates/slei-daemon/src/app.rs`: `.route("/v1/search/global", get(api::search::global))`

- [ ] **Step 6: Run daemon tests**

Run:

```sh
cargo test -p slei-daemon --test global_search_api -- --nocapture
```

Expected: PASS.

- [ ] **Step 7: Run relevant existing daemon tests**

Run:

```sh
cargo test -p slei-daemon --test agent_workspace -- --nocapture
cargo test -p slei-daemon --test broadcast_claim_api -- --nocapture
```

Expected: PASS.

- [ ] **Step 8: Commit daemon API**

```sh
git add crates/slei-daemon/src/services/search_service.rs crates/slei-daemon/src/api/search.rs crates/slei-daemon/src/state.rs crates/slei-daemon/src/app.rs crates/slei-daemon/src/api/mod.rs crates/slei-daemon/tests/global_search_api.rs crates/slei-daemon/Cargo.toml Cargo.lock
git commit -m "feat: add daemon global search api"
```

---

### Task 3: Tauri Broker, Commands, and Desktop Bridge

**Files:**
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/test/daemon-bridge-mock.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.test.ts`

- [ ] **Step 1: Write failing bridge tests**

In `apps/desktop/src/lib/daemon-bridge.test.ts`, add tests for request shape and error behavior.

Example:

```ts
it("exposes daemon-backed global search on the bridge", async () => {
  const bridge = createDaemonBridge({ invoke: async (command, payload) => {
    expect(command).toBe("global_search_command");
    expect(payload).toMatchObject({ request: { query: "dev", messageLimit: 80 } });
    return { query: "dev", totals: { agents: 0, channels: 0, messages: 0 }, agents: [], channels: [], messages: [] };
  } } as never);

  await expect(bridge.globalSearch({ query: "dev", messageLimit: 80 })).resolves.toMatchObject({ query: "dev" });
});

it("does not fabricate global search results when daemon search fails", async () => {
  const bridge = createDaemonBridge({ invoke: async () => {
    throw new Error("daemon offline");
  } } as never);

  await expect(bridge.globalSearch({ query: "dev" })).rejects.toThrow("daemon offline");
});
```

- [ ] **Step 2: Run bridge test to verify it fails**

Run:

```sh
pnpm --filter @slei/desktop test -- daemon-bridge
```

Expected: FAIL because `globalSearch` is missing.

- [ ] **Step 3: Add Rust broker DTOs and method**

In `apps/desktop/src-tauri/src/daemon_broker.rs`, add request/response structs matching daemon camelCase DTOs:

```rust
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchRequest {
    pub query: String,
    pub from_id: Option<String>,
    pub channel_id: Option<String>,
    pub time_range: Option<String>,
    pub time_zone: Option<String>,
    pub include_agents: Option<bool>,
    pub include_channels: Option<bool>,
    pub include_messages: Option<bool>,
    pub agent_limit: Option<i64>,
    pub channel_limit: Option<i64>,
    pub message_limit: Option<i64>,
}
```

Add `GlobalSearchReceipt`, `GlobalSearchTotals`, and result structs. `GlobalMessageSearchResult` must include `session_id: Option<String>` with camelCase `sessionId` for current desktop channel-session compatibility.

Implement:

```rust
pub fn global_search(&self, request: GlobalSearchRequest) -> Result<GlobalSearchReceipt, BrokerError> {
    // Online path: GET /v1/search/global with query parameters.
    // Offline/unavailable daemon: return BrokerError so UI can show the i18n error state.
}
```

Use the broker's existing HTTP helper style. If there is no generic query builder, build query parameters with URL encoding via existing helper or minimal safe helper.

- [ ] **Step 4: Add Tauri command**

In `apps/desktop/src-tauri/src/commands.rs`:

```rust
pub fn global_search(broker: &DaemonBroker, request: GlobalSearchRequest) -> Result<GlobalSearchReceipt, String> {
    broker.global_search(request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn global_search_command(
    state: tauri::State<'_, DaemonBroker>,
    request: GlobalSearchRequest,
) -> Result<GlobalSearchReceipt, String> {
    global_search(state.inner(), request)
}
```

Register in `apps/desktop/src-tauri/src/lib.rs` if the command list is explicit.

- [ ] **Step 5: Add TypeScript bridge DTOs**

In `apps/desktop/src/lib/daemon-bridge.ts`, add:

```ts
export type GlobalSearchTimeRange = "any" | "today" | "last7Days" | "last30Days";

export type GlobalSearchRequest = {
  query: string;
  fromId?: string;
  channelId?: string;
  timeRange?: GlobalSearchTimeRange;
  timeZone?: string;
  includeAgents?: boolean;
  includeChannels?: boolean;
  includeMessages?: boolean;
  agentLimit?: number;
  channelLimit?: number;
  messageLimit?: number;
};

export type GlobalSearchReceipt = {
  query: string;
  totals: { agents: number; channels: number; messages: number };
  agents: GlobalAgentSearchResult[];
  channels: GlobalChannelSearchResult[];
  messages: GlobalMessageSearchResult[];
};
```

`GlobalMessageSearchResult` must include `sessionId?: string | null` in addition to `sourceKind`, `messageId`, `channelId`, and `conversationId`.

Add `globalSearch(request: GlobalSearchRequest): Promise<GlobalSearchReceipt>` to `DaemonBridge` and implementation:

```ts
globalSearch: (request) => invoke<GlobalSearchReceipt>("global_search_command", { request }),
```

Do not add a production offline fallback that returns empty categorized results. Daemon failures must reject so `SearchPage` can render the i18n error state. Test-only mock bridges may return explicit test receipts when a test configures them.

- [ ] **Step 6: Run bridge and Tauri compile checks**

Run:

```sh
pnpm --filter @slei/desktop test -- daemon-bridge
cargo check -p slei-desktop
```

Expected: PASS. If the Tauri crate package name differs, use the package name from `apps/desktop/src-tauri/Cargo.toml`.

- [ ] **Step 7: Commit bridge wiring**

```sh
git add apps/desktop/src-tauri/src/daemon_broker.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/daemon-bridge.ts apps/desktop/src/test/daemon-bridge-mock.ts apps/desktop/src/lib/daemon-bridge.test.ts
git commit -m "feat: expose global search to desktop"
```

---

### Task 4: Search Types, i18n, Highlighting, and Filter Helpers

**Files:**
- Create: `apps/desktop/src/features/search/types.ts`
- Create: `apps/desktop/src/features/search/highlight.tsx`
- Create: `apps/desktop/src/features/search/highlight.test.tsx`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/search.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/search.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/shell.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/shell.ts`
- Modify: `apps/desktop/src/i18n/types.ts`

- [ ] **Step 1: Write failing highlight tests**

Create `apps/desktop/src/features/search/highlight.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HighlightedText } from "./highlight";

describe("HighlightedText", () => {
  it("highlights matching text without innerHTML", () => {
    render(<HighlightedText query="dev" text="进入 dev mode" />);
    expect(screen.getByText("dev")).toHaveAttribute("data-search-highlight", "true");
  });

  it("renders plain text when query is empty", () => {
    render(<HighlightedText query="" text="<b>dev</b>" />);
    expect(screen.getByText("<b>dev</b>")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```sh
pnpm --filter @slei/desktop test -- highlight
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement frontend search types**

Create `apps/desktop/src/features/search/types.ts` that re-exports or aliases bridge DTOs plus UI filter state:

```ts
import type { GlobalSearchReceipt, GlobalSearchRequest, GlobalSearchTimeRange } from "../../lib/daemon-bridge";

export type SearchFilterState = {
  query: string;
  fromId?: string;
  channelId?: string;
  timeRange: GlobalSearchTimeRange;
};

export type GlobalSearchResultSelection =
  | { kind: "agent"; agentId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "message"; sourceKind: "channel" | "dm"; messageId: string; channelId?: string | null; conversationId?: string | null; sessionId?: string | null };
```

- [ ] **Step 4: Implement safe highlighter**

Create `apps/desktop/src/features/search/highlight.tsx`:

```tsx
export function HighlightedText({ query, text }: { query: string; text: string }) {
  const parts = splitHighlightParts(text, query);
  return (
    <>
      {parts.map((part, index) =>
        part.highlight ? (
          <mark className="rounded-sm bg-yellow-300 px-0.5 text-foreground" data-search-highlight="true" key={index}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function splitHighlightParts(text: string, query: string): Array<{ text: string; highlight: boolean }> {
  // Case-insensitive string split; escape regex metacharacters.
}
```

Do not use `dangerouslySetInnerHTML`.

- [ ] **Step 5: Add i18n keys**

Update `zh-CN/search.ts` and `en-US/search.ts` with keys for:

- title
- placeholder
- emptyInputTitle / emptyInputDescription
- loading
- errorTitle / errorDescription / retry
- noResultTitle / noResultDescription
- totalResults
- filterFrom / filterChannel / filterTime
- fromTitle / channelTitle / timeTitle
- me
- anyTime / today / last7Days / last30Days
- agentsSection / channelsSection / messagesSection
- openAgent / openChannel / openMessage

Update `apps/desktop/src/i18n/types.ts` for the new search message keys and shell nav `search` label.

Also update shell nav i18n if the main nav now includes `search` in `messages.shell.nav`.

- [ ] **Step 6: Run frontend helper/i18n tests**

Run:

```sh
pnpm --filter @slei/desktop test -- highlight
pnpm --filter @slei/desktop test -- i18n
```

Expected: PASS.

- [ ] **Step 7: Commit helpers and i18n**

```sh
git add apps/desktop/src/features/search/types.ts apps/desktop/src/features/search/highlight.tsx apps/desktop/src/features/search/highlight.test.tsx apps/desktop/src/i18n/messages/zh-CN/search.ts apps/desktop/src/i18n/messages/en-US/search.ts apps/desktop/src/i18n/messages/zh-CN/shell.ts apps/desktop/src/i18n/messages/en-US/shell.ts apps/desktop/src/i18n/types.ts
git commit -m "feat: add global search frontend primitives"
```

---

### Task 5: Global Search Page UI and Left Navigation Entry

**Files:**
- Modify: `apps/desktop/src/features/search/SearchPageView.tsx`
- Create: `apps/desktop/src/features/search/SearchPageView.test.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/features/shell/PrimaryNav.ts`
- Modify: `apps/desktop/src/app/routes/SearchRoute.tsx`
- Modify: `apps/desktop/src/app/SleiApp.tsx`

- [ ] **Step 1: Write failing SearchPage component tests**

Create or update `apps/desktop/src/features/search/SearchPageView.test.tsx`.

Test cases:

```tsx
it("shows the empty input state and does not search before input", () => {
  const onSearch = vi.fn();
  render(<SearchPage messages={messages} data={data} profile={profile} timeZone="Asia/Shanghai" onSearch={onSearch} onResultSelect={vi.fn()} />);
  expect(screen.getByText(messages.search.emptyInputTitle)).toBeInTheDocument();
  expect(onSearch).not.toHaveBeenCalled();
});

it("debounces globalSearch after typing", async () => {
  vi.useFakeTimers();
  const onSearch = vi.fn().mockResolvedValue(emptyReceipt("dev"));
  render(<SearchPage messages={messages} data={data} profile={profile} timeZone="Asia/Shanghai" onSearch={onSearch} onResultSelect={vi.fn()} />);
  await userEvent.type(screen.getByRole("searchbox"), "dev");
  vi.advanceTimersByTime(300);
  await waitFor(() => expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "dev", messageLimit: 80 })));
});

it("renders categorized results with highlighted query", async () => {
  // Provide receipt with agents/channels/messages and assert section headings and mark[data-search-highlight].
});
```

Also test From/Channel/Time dropdown selections call `onSearch` with `fromId`, `channelId`, and `timeRange`.
Add a result-selection test for a channel message result with `sessionId`, asserting `onResultSelect` receives that `sessionId` along with `channelId` and `messageId`.

- [ ] **Step 2: Run SearchPage tests to verify they fail**

Run:

```sh
pnpm --filter @slei/desktop test -- SearchPageView
```

Expected: FAIL because props/UI are not implemented.

- [ ] **Step 3: Replace frontend fixture filtering with daemon-backed props**

Change `SearchPage` props to:

```ts
export function SearchPage({
  data,
  messages,
  onSearch,
  onResultSelect,
  profile,
  timeZone,
}: {
  data: SleiFixtures;
  messages: DesktopMessages;
  onSearch: (request: GlobalSearchRequest) => Promise<GlobalSearchReceipt>;
  onResultSelect: (selection: GlobalSearchResultSelection) => void;
  profile: UserProfile;
  timeZone: string;
})
```

State:

- `query`
- `fromId`
- `channelId`
- `timeRange`
- `receipt`
- `loading`
- `error`
- per-dropdown open/search state

Behavior:

- Trim query.
- If empty: clear receipt/error/loading and render empty input state.
- Debounce 250ms.
- Call `onSearch({ query, fromId, channelId, timeRange, timeZone, agentLimit: 20, channelLimit: 20, messageLimit: 80 })`.
- Ignore stale responses using request sequence ref.
- Render categorized results.

- [ ] **Step 4: Build screenshot-inspired filter dropdowns using existing components**

Implement compact dropdowns inside `SearchPageView.tsx` or small local subcomponents in the same file:

- `FromFilter`
- `ChannelFilter`
- `TimeFilter`

Use existing `Button`, `Input`, `ScrollArea`, `MemberAvatar`, and lucide icons. Keep the UI production-focused:

- no nested cards
- stable dimensions
- no hardcoded English text
- real data from `data.members` and `data.channels`
- `FromFilter` must prepend a `Me` option with `fromId = "human:local"` using `messages.search.me` and the local `profile` avatar/name, then list visible Agent members from daemon data.

- [ ] **Step 5: Add left nav global search button**

Modify `apps/desktop/src/app/SleiAppFrame.tsx`:

- Include `search` in main nav as a standalone icon button near the top.
- Keep `search` active when `input.activeView === "search"`.
- Remove the old search trigger from `ChannelList`. If a compile-time reference requires keeping a button temporarily, it must only call `onViewChange("search")` and must not render local search UI.
- Ensure nav labels come from i18n. If `shell.nav` typing currently excludes `search`, update `apps/desktop/src/i18n/types.ts`, `apps/desktop/src/i18n/messages/zh-CN/shell.ts`, and `apps/desktop/src/i18n/messages/en-US/shell.ts`.

- [ ] **Step 6: Wire SearchRoute and SleiApp**

Modify:

- `apps/desktop/src/app/routes/SearchRoute.tsx`
- `apps/desktop/src/app/SleiAppFrame.tsx`
- `apps/desktop/src/app/SleiApp.tsx`

Wire:

```tsx
<SearchRoute
  data={data}
  messages={messages}
  onSearch={bridge.globalSearch}
  onResultSelect={handleGlobalSearchResultSelect}
  profile={localHumanPresentation(profile, messages)}
  timeZone={timeZone}
/>
```

Remove `filterConversationMessages` usage from `SearchPageView.tsx`.

- [ ] **Step 7: Run SearchPage tests**

Run:

```sh
pnpm --filter @slei/desktop test -- SearchPageView
```

Expected: PASS.

- [ ] **Step 8: Commit global search UI**

```sh
git add apps/desktop/src/features/search/SearchPageView.tsx apps/desktop/src/features/search/SearchPageView.test.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/features/shell/PrimaryNav.ts apps/desktop/src/app/routes/SearchRoute.tsx apps/desktop/src/app/SleiApp.tsx
git commit -m "feat: build global search page"
```

---

### Task 6: Result Navigation and Blink Border Focus

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Modify: `apps/desktop/src/app/SleiApp.test.ts`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- Create or Modify: `apps/desktop/e2e/global-search.spec.tsx`

- [ ] **Step 1: Write failing navigation tests**

In `apps/desktop/src/app/SleiApp.test.ts`, add tests around an exported pure helper. Extract this helper from the result-selection logic even if the final async handler remains inside `SleiApp`:

```ts
export function globalSearchSelectionTarget(result: GlobalSearchResultSelection) {
  // returns { view, channelId?, conversationId?, messageId?, memberId? }
}
```

Tests:

```ts
it("maps agent search result to members selection", () => {
  expect(globalSearchSelectionTarget({ kind: "agent", agentId: "agent_coda" })).toEqual({ view: "members", memberId: "agent_coda" });
});
```

- [ ] **Step 2: Write failing blink border test**

In `apps/desktop/src/features/chat/ChatPageView.test.tsx`, add:

```tsx
it("adds blink border class to focused message and removes it later", async () => {
  vi.useFakeTimers();
  render(<ChatPage {...props} focusedMessageId="msg_1" />);
  const message = screen.getByTestId("slei-message-msg_1");
  expect(message).toHaveClass("slei-message--blink-border");
  vi.advanceTimersByTime(3200);
  await waitFor(() => expect(message).not.toHaveClass("slei-message--blink-border"));
});
```

If test ids do not exist, add `data-testid={`slei-message-${message.id}`}` to message articles.

- [ ] **Step 3: Run tests to verify they fail**

Run:

```sh
pnpm --filter @slei/desktop test -- SleiApp ChatPageView
```

Expected: FAIL because helper/class are missing or old focused styling remains.

- [ ] **Step 4: Implement global search result selection**

In `apps/desktop/src/app/SleiApp.tsx`, replace the old `handleSearchResultSelect(channelId: string)` with:

```ts
async function handleGlobalSearchResultSelect(selection: GlobalSearchResultSelection) {
  if (selection.kind === "agent") {
    setActiveMemberId(selection.agentId);
    navigateToView("members");
    return;
  }
  if (selection.kind === "channel") {
    setActiveChannelId(selection.channelId);
    setActiveConversationId(undefined);
    setActiveSessionId(undefined);
    await refreshChannelMessagesIntoState(selection.channelId);
    navigateToView("chat");
    return;
  }
  if (selection.sourceKind === "channel" && selection.channelId) {
    setActiveChannelId(selection.channelId);
    setActiveConversationId(undefined);
    if (selection.sessionId) {
      const receipt = await bridge.activateChannelSession(selection.channelId, selection.sessionId);
      setData((current) => createEmptySleiData({
        ...current,
        channels: current.channels.map((channel) => (channel.id === receipt.channel.id ? channelFromView(receipt.channel, messages) : channel)),
        channelSessions: current.channelSessions.some((session) => session.id === receipt.session.id)
          ? current.channelSessions.map((session) => (session.id === receipt.session.id ? receipt.session : session))
          : [...current.channelSessions, receipt.session],
      }));
      await refreshChannelMessagesIntoState(selection.channelId, data.members, selection.sessionId);
    } else {
      setActiveSessionId(undefined);
      await refreshChannelMessagesIntoState(selection.channelId);
    }
    setFocusedMessageId(selection.messageId);
    navigateToView("chat");
    return;
  }
  if (selection.sourceKind === "dm" && selection.conversationId) {
    const messagesReceipt = await bridge.listConversationMessages(selection.conversationId);
    // Update data with replaceConversationMessages, set active conversation, set focus.
  }
}
```

This `sessionId` path is a transition compatibility layer for the current desktop data model. It must stay internal to search navigation and should be removed when channel/DM historical sessions are removed from the product.

Show an i18n error toast if required target fields are missing or load fails.

Do not expose session switching as a user-facing search behavior.

- [ ] **Step 5: Implement blink border class**

In `apps/desktop/src/features/chat/ChatPageView.tsx`:

- Keep existing scroll/focus behavior.
- Use a state name like `blinkMessageId`.
- Add class with `cn(..., blinkMessageId === message.id && "slei-message--blink-border")`.
- Add `data-testid`.
- Clear after 3000ms.

In `apps/desktop/src/app/app.css`:

```css
@keyframes slei-message-blink-border {
  0%, 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0); }
  15%, 45%, 75% { box-shadow: 0 0 0 2px hsl(var(--primary)); }
  30%, 60% { box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15); }
}

.slei-message--blink-border {
  animation: slei-message-blink-border 0.9s ease-in-out 3;
  border-color: hsl(var(--primary));
}
```

Use existing CSS variable syntax in `app.css`; adjust if the project uses non-`hsl(var())` tokens.

- [ ] **Step 6: Add e2e coverage for global search navigation**

Create `apps/desktop/e2e/global-search.spec.tsx` or extend an existing router/search spec.

Cover:

- Open global search via left nav search button.
- Empty input state renders.
- Mock bridge returns results.
- Click Agent result; members view selected item is active.
- Click Channel result; chat view selected channel is active.
- Click message result; target article gets blink border class.
- Click a channel message result whose DTO includes a non-active `sessionId`; assert the app activates/loads that session internally and the target message gets the blink border class.

- [ ] **Step 7: Run navigation and e2e tests**

Run:

```sh
pnpm --filter @slei/desktop test -- SleiApp ChatPageView SearchPageView
pnpm --filter @slei/desktop test:e2e -- global-search
```

Expected: PASS. If the e2e script uses a different syntax, use the command pattern from `apps/desktop/package.json`.

- [ ] **Step 8: Commit navigation/focus behavior**

```sh
git add apps/desktop/src/app/SleiApp.tsx apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/app/app.css apps/desktop/src/app/SleiApp.test.ts apps/desktop/src/features/chat/ChatPageView.test.tsx apps/desktop/e2e/global-search.spec.tsx
git commit -m "feat: navigate from global search results"
```

---

### Task 7: Full Verification and Cleanup

**Files:**
- Review all changed files from prior tasks.
- Update only docs if implementation details diverged from the approved spec in a meaningful way.

- [ ] **Step 1: Run formatting**

Run:

```sh
cargo fmt --check
pnpm --filter @slei/desktop lint
```

Expected: PASS.

- [ ] **Step 2: Run focused Rust tests**

Run:

```sh
cargo test -p slei-storage global_search -- --nocapture
cargo test -p slei-daemon --test global_search_api -- --nocapture
```

Expected: PASS.

- [ ] **Step 3: Run focused desktop tests**

Run:

```sh
pnpm --filter @slei/desktop test -- SearchPageView
pnpm --filter @slei/desktop test -- highlight
pnpm --filter @slei/desktop test -- SleiApp
pnpm --filter @slei/desktop test -- ChatPageView
```

Expected: PASS.

- [ ] **Step 4: Run broader regression tests required by Slei guardrails**

Run:

```sh
cargo test -p slei-daemon --test broadcast_claim_api
cargo test -p slei-daemon --test task_api
cargo test -p slei-daemon --test task_service
cargo test -p slei-daemon --test channel_orchestration_flow
pnpm --filter @slei/desktop test
```

Expected: PASS.

- [ ] **Step 5: Run or document e2e verification**

Run the e2e command from `apps/desktop/package.json`:

```sh
pnpm --filter @slei/desktop test:e2e -- global-search
```

Expected: PASS. If the local environment cannot run e2e, document the exact blocker and the unrun command in the final handoff.

- [ ] **Step 6: Inspect for forbidden production mock paths**

Run:

```sh
rg -n "mock|fixture|fake|sample|demo" apps/desktop/src/features/search apps/desktop/src/app/SleiApp.tsx crates/slei-daemon/src/services/search_service.rs
```

Expected: No production fallback that fabricates search results. Test files may contain mocks/fixtures.

- [ ] **Step 7: Final commit if cleanup changed files**

If verification cleanup changed files:

```sh
git add <changed-files>
git commit -m "test: verify global search"
```

If no files changed, do not create an empty commit.

---

## Execution Notes

- Use @superpowers:subagent-driven-development for implementation in this harness.
- Keep tasks sequential through Task 3 because storage/API/bridge contracts build on each other.
- Task 4 can run after Task 3 and before Task 5.
- Task 6 depends on Task 5.
- Do not merge unrelated user changes. If the worktree becomes dirty from outside changes, inspect and preserve them.
- After implementation and verification, Slei project instructions require asking whether to merge into `master` or another branch.
