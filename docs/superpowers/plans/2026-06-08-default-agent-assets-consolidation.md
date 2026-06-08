# Default Agent Assets Consolidation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate duplicated default Agent memory and Skill templates so guide-create, memory Skill, initial `MEMORY.md`, key-knowledge defaults, and mock workspace content all come from one canonical source.

**Architecture:** Store canonical default Agent assets as repository resources, expose them to Rust through a small shared crate, and expose the same assets to desktop TypeScript through a generated file. Runtime workspaces remain normal files under `~/.slei/agents/...`; existing startup/migration code keeps standard Skill files current when they are known Slei-managed defaults.

**Tech Stack:** Rust workspace crate with `include_str!`, Tauri desktop broker, daemon member service, TypeScript generated module, Vitest, Cargo tests, existing Slei Agent workspace layout.

---

## Memory Behavior Decision

`Active Context` is not a fixed default fact. It is a resumability field: the Agent should keep it current with what it is doing, what is blocked, and what should happen next. The initial template may seed it with a first-run line, but the memory maintenance workflow must replace that line as work progresses.

Current behavior to fix or clarify:

- initial `MEMORY.md` writes a fixed first-run `Active Context` line.
- the default memory Skill only says to append requested facts under `Key Knowledge` or `Active Context`; it does not provide enough decision rules.
- the current explicit `@agent 记住/remember/learn ...` path is intercepted by desktop and calls `rememberAgentFact`; that deterministic path inserts the fact before `## Active Context`, so it effectively writes `Key Knowledge` and does not invoke the Agent's memory Skill.
- the channel `MemoryMaintainerService` writes maintained note links and channel notes, but it is not yet a general current-task memory maintainer.

Target behavior:

- `Key Knowledge` stores durable facts, preferences, responsibilities, project conventions, and lessons that should survive many sessions.
- `Active Context` stores only the current or most recent work state: active task, last meaningful step, blockers, next action, and relevant channel/project.
- Active Context should be replaced or compacted, not endlessly appended.
- Detailed or growing context goes into `notes/*.md`; `MEMORY.md` links to it.
- Memory updates should be bounded, curated, and deduplicated.

Design references:

- Skill Creator guidance: keep `SKILL.md` concise, procedural, and focused on context the model does not already know.
- Hermes Agent memory guidance: persistent memory should be curated and bounded; it distinguishes critical always-in-context memory from searchable session history, and uses add/replace/remove style operations rather than unbounded append-only logs.

## Current Duplication

- `crates/slei-daemon/src/services/member_service.rs`
  - `initial_memory`
  - `default_memory_skill`
  - `guide_create_skill`
  - `default_skill_records`
  - standard Skill write/read/migration helpers
- `apps/desktop/src-tauri/src/daemon_broker.rs`
  - `initial_memory`
  - `default_memory_skill`
  - `default_guide_create_skill`
  - `default_skill_records`
  - standard Skill write/read/migration helpers
- `apps/desktop/src/lib/daemon-bridge.ts`
  - `defaultSkillViews`
  - `defaultGuideCreateSkillContent`
  - mock `MEMORY.md` and mock Skill file content
- Tests and fixtures contain smaller copies of default memory phrasing:
  - `apps/desktop/src/app/fixtures.ts`
  - `apps/desktop/e2e/agent-mvp.spec.tsx`
  - `apps/desktop/e2e/chinese-members.spec.tsx`
  - `apps/desktop/e2e/shell.spec.ts`
  - `crates/slei-daemon/tests/agent_workspace.rs`

## Intentional Non-Goals

- Do not centralize all product tool protocol copy in this pass. Strings around `slei_propose_interactive_card` inside `workers/claude-agent` and event parsers are runtime contracts, not default Agent assets.
- Do not move or rewrite user runtime files under `~/.slei/agents/...` as a standalone migration. Runtime files should only be updated by the existing standard Skill reconciliation path.
- Do not make the frontend parse generated natural language to create actions. Interactive cards still only enter the product through typed product-tool events.
- Do not make desktop browser code read template files from disk at runtime. Browser/mock views should use generated TypeScript constants.

## File Structure

- Create `resources/default-agent-assets/MEMORY.md.template`
  - Canonical initial memory template.
- Create `resources/default-agent-assets/key-knowledge.json`
  - Canonical base Key Knowledge copy for guide, coordinator, and ordinary Agents.
- Create `resources/default-agent-assets/skills/memory/SKILL.md.template`
  - Canonical high-quality memory Skill template.
- Create `resources/default-agent-assets/skills/guide-create/SKILL.md`
  - Canonical guide-create Skill body.
- Create `resources/default-agent-assets/skills.json`
  - Canonical standard Skill metadata: ids, names, triggers, guide-only flag, relative paths.
- Create `crates/slei-default-agent-assets/Cargo.toml`
  - New shared Rust crate.
- Create `crates/slei-default-agent-assets/src/lib.rs`
  - Template renderer and standard Skill definitions.
- Modify `Cargo.toml`
  - Add the new crate to workspace members.
- Modify `crates/slei-daemon/Cargo.toml`
  - Depend on `slei-default-agent-assets`.
- Modify `apps/desktop/src-tauri/Cargo.toml`
  - Depend on `slei-default-agent-assets`.
- Modify `crates/slei-daemon/src/services/member_service.rs`
  - Replace local default templates with shared crate calls.
- Modify `apps/desktop/src-tauri/src/daemon_broker.rs`
  - Replace local default templates with shared crate calls.
- Create `scripts/generate-default-agent-assets.mjs`
  - Generate desktop TS constants from canonical resource files.
- Create `apps/desktop/src/lib/default-agent-assets.generated.ts`
  - Generated constants used by desktop mock bridge.
- Create `apps/desktop/src/lib/default-agent-assets.ts`
  - Small TS renderer around generated constants.
- Modify `apps/desktop/src/lib/daemon-bridge.ts`
  - Replace local default template functions with generated asset helpers.
- Modify tests and fixtures to assert stable markers from shared/generated assets instead of embedding long default bodies.

---

## Task 1: Add Canonical Resource Assets

**Files:**
- Create: `resources/default-agent-assets/MEMORY.md.template`
- Create: `resources/default-agent-assets/key-knowledge.json`
- Create: `resources/default-agent-assets/skills/memory/SKILL.md.template`
- Create: `resources/default-agent-assets/skills/guide-create/SKILL.md`
- Create: `resources/default-agent-assets/skills.json`

- [ ] **Step 1: Create `key-knowledge.json`**

Move the three existing base text blocks into a canonical resource:

```json
{
  "guide": "引导员负责回答 Slei App 使用问题，并帮助用户创建真实的 Agent 成员与频道。\n主频道：#all（目前唯一频道）\n创建成员时通过 guide-create Skill 生成产品交互卡，不从自然语言文本直接创建成员。",
  "coordinator": "频道协调员负责分析用户意图并路由 Agent，自己不做任何关于用户问题的回复。\n可以将消息路由给单个 Agent 或多个 Agent；例如“大家好”应路由给多个合适 Agent。\n用户明确 @ 某个 Agent、@all 或 @everyone 时，无需再分析意图，直接转发给对应 Agent。\n频道协调员是系统内置成员，只在频道内工作，不提供私聊。",
  "agent": "该 Agent 按 Role 中的职责与用户协作。\n主频道：#all（目前唯一频道）\n只记录真实存在的成员和用户明确要求记住的信息。"
}
```

- [ ] **Step 2: Create `MEMORY.md.template`**

Use placeholders only for values owned by the Agent record:

```md
# {{name}}

## Role
{{description}}

## Team
@lei-lee — 人类用户，项目发起人
{{handle}} — 我自己，{{name}}

## Key Knowledge
{{key_knowledge}}

## Active Context
首次启动，等待用户提出需要引导的任务
```

- [ ] **Step 3: Create high-quality `skills/memory/SKILL.md.template`**

Use Skill Creator principles: keep the Skill concise, procedural, and directly useful at the moment it triggers. Do not turn it into a long memory theory document.

```md
---
name: memory
description: Use when the user mentions {{handle}} and asks this agent to remember, learn, or 记住 something, or when this agent needs to update MEMORY.md so future sessions can resume current work.
---

# Memory

Use this skill to maintain `MEMORY.md` as curated working memory, not as a chat log.

## Memory Model

- `Key Knowledge`: durable facts, role expectations, user preferences, project conventions, and lessons likely to matter across many sessions.
- `Active Context`: current task state for resuming later: goal, latest meaningful progress, blocker, next action, and relevant channel/project. Replace stale context instead of appending a history.
- `Maintained Notes`: links to `notes/*.md` for detailed channel/project/team context.

## Workflow

1. Read `MEMORY.md` before editing it.
2. Classify the update:
   - durable fact or preference -> update `Key Knowledge`
   - current task/progress/blocker/next step -> replace or compact `Active Context`
   - detailed multi-line context -> create or update a focused `notes/*.md` file and link it from `Maintained Notes`
3. Deduplicate or replace stale entries instead of adding near-duplicates.
4. Keep entries short, specific, and attributable to real user instructions or observed project facts.
5. Do not store secrets, one-off chatter, unverified guesses, or facts that can be cheaply rediscovered.
6. Preserve existing Markdown headings and links.

## Active Context Format

Prefer 2-5 bullets:

- Task:
- State:
- Blocker:
- Next:
- Context:

If there is no active work, write `- State: idle; waiting for the next user request.`
```

- [ ] **Step 4: Move the latest guide-create Skill body**

Copy the current desired body from the Rust runtime source into `resources/default-agent-assets/skills/guide-create/SKILL.md`.

Required markers:

- `slei_propose_interactive_card`
- `Call the tool once per agent. Multiple requested agents require multiple tool calls, not one combined card.`
- `If a requested role has responsibilities but no explicit name, assign a simple random unused name`
- `A successful preparation response can say: "已准备创建卡片，请确认。"`

- [ ] **Step 5: Add `skills.json` metadata**

Use stable ids and relative paths:

```json
[
  {
    "id": "memory",
    "name": "memory",
    "relativePath": ".claude/skills/memory/SKILL.md",
    "triggerTemplate": "Use when the user mentions {{handle}} and asks this agent to remember, learn, or 记住 something.",
    "agentKinds": ["guide", "agent", "coordinator"]
  },
  {
    "id": "guide-create",
    "name": "guide-create",
    "relativePath": ".claude/skills/guide-create/SKILL.md",
    "trigger": "Use when the user asks Yeal to create one or more Slei agents, members, or channels.",
    "agentKinds": ["guide"]
  }
]
```

---

## Task 2: Add Shared Rust Asset Crate

**Files:**
- Create: `crates/slei-default-agent-assets/Cargo.toml`
- Create: `crates/slei-default-agent-assets/src/lib.rs`
- Modify: `Cargo.toml`

- [ ] **Step 1: Add crate to workspace**

Add `crates/slei-default-agent-assets` to workspace members.

- [ ] **Step 2: Implement public input and output types**

Keep the crate independent from daemon and desktop domain structs:

```rust
pub struct AgentTemplateInput<'a> {
    pub name: &'a str,
    pub handle: &'a str,
    pub description: &'a str,
    pub agent_kind: Option<&'a str>,
    pub channel_ids: Vec<&'a str>,
}

pub struct StandardSkillAsset {
    pub id: &'static str,
    pub name: &'static str,
    pub trigger: String,
    pub relative_path: &'static str,
    pub body: String,
}
```

- [ ] **Step 3: Implement render helpers**

Expose these functions:

```rust
pub fn initial_memory(input: &AgentTemplateInput<'_>) -> String;
pub fn memory_skill(input: &AgentTemplateInput<'_>) -> String;
pub fn guide_create_skill() -> &'static str;
pub fn standard_skill_assets(input: &AgentTemplateInput<'_>) -> Vec<StandardSkillAsset>;
pub fn base_key_knowledge(agent_kind: Option<&str>) -> &'static str;
```

Rendering rules:

- `agent_kind == Some("guide")` uses guide key knowledge.
- `agent_kind == Some("coordinator")` uses coordinator key knowledge.
- All other kinds use the ordinary Agent key knowledge.
- Sort `channel_ids` inside the shared crate before rendering joined channel text.
- Escape nothing for Markdown in this pass; this preserves current behavior.

- [ ] **Step 4: Add crate unit tests**

Add tests for:

- guide memory includes product-card creation guidance.
- coordinator memory says it routes but does not answer the user.
- ordinary Agent memory uses the generic role copy.
- channel ids render deterministically.
- guide standard skills include `guide-create` and `memory`.
- non-guide standard skills include only `memory`.
- guide-create body contains multi-card and random-name requirements.

- [ ] **Step 5: Run crate tests**

Run:

```sh
cargo test -p slei-default-agent-assets
```

Expected: PASS.

---

## Task 3: Replace Daemon Defaults

**Files:**
- Modify: `crates/slei-daemon/Cargo.toml`
- Modify: `crates/slei-daemon/src/services/member_service.rs`
- Test: `crates/slei-daemon/tests/agent_workspace.rs`

- [ ] **Step 1: Add crate dependency**

Add:

```toml
slei-default-agent-assets = { path = "../slei-default-agent-assets" }
```

- [ ] **Step 2: Add a small adapter from `ProductAgentRecord`**

In `member_service.rs`, create only the conversion:

```rust
fn agent_template_input(agent: &ProductAgentRecord) -> AgentTemplateInput<'_> {
    AgentTemplateInput {
        name: &agent.name,
        handle: &agent.handle,
        description: &agent.description,
        agent_kind: Some(&agent.agent_kind),
        channel_ids: agent.channel_ids.iter().map(String::as_str).collect(),
    }
}
```

This keeps the shared crate independent from daemon storage types while avoiding temporary borrowed-slice lifetimes.

- [ ] **Step 3: Replace local template functions**

Remove local copies of:

- `initial_memory`
- `default_memory_skill`
- `guide_create_skill`

Replace call sites with shared crate calls.

- [ ] **Step 4: Keep daemon-owned path and migration behavior local**

Do not move filesystem operations into the shared crate. Keep these in `member_service.rs`:

- creating `.claude/skills/...`
- writing `MEMORY.md`
- detecting standard Skill file paths
- reconciling stale guide-create default bodies
- preserving user-customized Skill files

- [ ] **Step 5: Update daemon tests**

Update assertions to check canonical behavior:

- Guide Skill contains `slei_propose_interactive_card`.
- Guide Skill contains random-name instruction.
- Guide Skill says one tool call per agent.
- Standard runtime startup updates stale guide-create body.
- Memory content for guide/coordinator/ordinary agents still matches intended role.

- [ ] **Step 6: Verify daemon**

Run:

```sh
cargo test -p slei-daemon --test agent_workspace
cargo test -p slei-daemon --test task_api
```

Expected: PASS.

---

## Task 4: Replace Desktop Tauri Defaults

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add crate dependency**

Add:

```toml
slei-default-agent-assets = { path = "../../../crates/slei-default-agent-assets" }
```

Use the correct relative path from `apps/desktop/src-tauri/Cargo.toml`.

- [ ] **Step 2: Add a small adapter from `DesktopAgentView`**

Convert `DesktopAgentView` into the shared crate input without moving UI/broker-specific fields into the shared crate.

- [ ] **Step 3: Replace local template functions**

Remove local copies of:

- `initial_memory`
- `default_memory_skill`
- `default_guide_create_skill`

Replace call sites with shared crate calls.

- [ ] **Step 4: Keep broker-owned filesystem behavior local**

Do not move:

- agent workspace path calculation
- overlay workspace creation
- `~/.slei` runtime file reconciliation
- Tauri command response shape mapping

- [ ] **Step 5: Update desktop Tauri tests**

Update assertions in `apps/desktop/src-tauri/src/lib.rs` to match canonical markers and ensure stale guide-create updates still happen.

- [ ] **Step 6: Verify desktop Tauri**

Run:

```sh
cargo test -p slei-desktop broker_startup_updates_existing_guide_create_skill_body
cargo test -p slei-desktop guide_local_product_tool_appends_card_message
```

Expected: PASS.

---

## Task 5: Generate TypeScript Defaults For Desktop Mock Bridge

**Files:**
- Create: `scripts/generate-default-agent-assets.mjs`
- Create: `apps/desktop/src/lib/default-agent-assets.generated.ts`
- Create: `apps/desktop/src/lib/default-agent-assets.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Add generator script**

Script responsibilities:

- Read canonical resource files from `resources/default-agent-assets`.
- Read `key-knowledge.json`.
- Read `skills.json`.
- Emit `apps/desktop/src/lib/default-agent-assets.generated.ts`.
- Include a header comment: `// Generated by scripts/generate-default-agent-assets.mjs. Do not edit by hand.`
- Preserve exact Markdown bodies.

- [ ] **Step 2: Add generated exports**

Generated module shape:

```ts
export const INITIAL_MEMORY_TEMPLATE = "...";
export const DEFAULT_KEY_KNOWLEDGE = { ... } as const;
export const MEMORY_SKILL_TEMPLATE = "...";
export const GUIDE_CREATE_SKILL = "...";
export const DEFAULT_SKILL_DEFINITIONS = [...] as const;
```

- [ ] **Step 3: Add a hand-written TS renderer**

In `apps/desktop/src/lib/default-agent-assets.ts`, export:

```ts
export function renderInitialMemory(input: AgentTemplateInput): string;
export function renderMemorySkill(input: AgentTemplateInput): string;
export function guideCreateSkill(): string;
export function defaultSkillViews(input: { handle: string; kind?: string; workspacePath: string }): SkillView[];
export function defaultSkillContent(input: { skillId: string; handle: string }): string;
```

Use `DEFAULT_KEY_KNOWLEDGE` from the generated module so TypeScript does not carry a separate copy of guide/coordinator/ordinary default memory text.

- [ ] **Step 4: Add package scripts**

In `apps/desktop/package.json` or root `package.json`, add:

```json
{
  "scripts": {
    "generate:default-agent-assets": "node ../../scripts/generate-default-agent-assets.mjs",
    "check:default-agent-assets": "node ../../scripts/generate-default-agent-assets.mjs --check"
  }
}
```

Adjust relative paths to match the existing package script layout.

- [ ] **Step 5: Replace mock bridge defaults**

In `apps/desktop/src/lib/daemon-bridge.ts`:

- remove `defaultGuideCreateSkillContent`
- replace local `defaultSkillViews` with imported helper
- render mock `MEMORY.md` through `renderInitialMemory`
- render Skill bodies through `defaultSkillContent`

- [ ] **Step 6: Add generated-file check**

Add a test or script check that fails when canonical resources change without regenerating TS.

Run:

```sh
pnpm --filter @slei/desktop check:default-agent-assets
```

Expected: PASS.

---

## Task 6: Clean Fixtures And Assertions

**Files:**
- Modify: `apps/desktop/src/app/fixtures.ts`
- Modify: `apps/desktop/e2e/agent-mvp.spec.tsx`
- Modify: `apps/desktop/e2e/chinese-members.spec.tsx`
- Modify: `apps/desktop/e2e/shell.spec.ts`
- Modify: daemon tests that embed long Skill fragments

- [ ] **Step 1: Replace long embedded default content**

Use generated/default helpers for app fixtures where practical. Where full helpers are too heavy, assert short markers instead of full paragraphs.

- [ ] **Step 2: Keep i18n display strings separate**

Leave `apps/desktop/src/i18n/messages/*/members.ts` as display copy. These are UI labels, not runtime default Skill assets.

- [ ] **Step 3: Remove accidental stale Guide Create copies**

Search again:

```sh
rg -n "If a requested role has responsibilities|Call the tool once per agent|slei_propose_interactive_card|defaultGuideCreateSkillContent|default_guide_create_skill|guide_create_skill" crates apps workers resources -S
```

Expected:

- full guide-create body only in `resources/default-agent-assets/skills/guide-create/SKILL.md`
- generated copy only in `apps/desktop/src/lib/default-agent-assets.generated.ts`
- runtime/tool contract mentions still allowed in `workers/claude-agent` and event parsing/tests
- short assertions allowed in tests

---

## Task 7: Clarify Explicit Remember Vs Active Context Updates

**Files:**
- Modify: `crates/slei-daemon/src/services/member_service.rs`
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/model.ts`
- Test: `crates/slei-daemon/tests/agent_workspace.rs`
- Test: `apps/desktop/e2e/agent-mvp.spec.tsx`

- [ ] **Step 1: Decide the explicit remember path**

Keep the deterministic `rememberAgentFact` path for explicit `@agent 记住/remember/learn ...` only if the product wants instant non-runtime memory updates. Document that this path writes durable `Key Knowledge` by default and is separate from Agent-executed memory Skill updates.

If explicit remember should use the richer Skill behavior, stop short-circuiting in `SleiApp.tsx` and route the message to the Agent runtime so the Agent can invoke the memory Skill and edit `MEMORY.md` itself.

- [ ] **Step 2: Make deterministic writes section-aware if keeping the direct path**

If keeping `rememberAgentFact`, support a minimal section classifier:

- explicit durable facts -> `Key Knowledge`
- phrases like "当前", "正在", "下次继续", "blocked", "next", "resume" -> `Active Context`
- never append Active Context forever; replace the existing Active Context block with 2-5 bullets

This can be deterministic at first; do not require an LLM call for the direct product action.

- [ ] **Step 3: Add tests for Active Context replacement**

Test both daemon and desktop fallback implementations:

- existing Active Context is replaced/compacted for current-task memory.
- durable facts still land in Key Knowledge.
- user-custom sections and maintained notes are preserved.

- [ ] **Step 4: Add tests for memory Skill quality markers**

Assert the canonical memory Skill body contains:

- `curated working memory, not as a chat log`
- `Key Knowledge`
- `Active Context`
- `replace or compact`
- `Do not store secrets`
- `notes/*.md`

---

## Task 8: End-To-End Verification

**Files:**
- No new files unless tests require small updates.

- [ ] **Step 1: Format Rust**

Run:

```sh
cargo fmt --all -- --check
```

Expected: PASS.

- [ ] **Step 2: Typecheck desktop**

Run:

```sh
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Run desktop tests**

Run:

```sh
pnpm --filter @slei/desktop test
```

Expected: PASS.

- [ ] **Step 4: Run focused Rust tests**

Run:

```sh
cargo test -p slei-default-agent-assets
cargo test -p slei-daemon --test agent_workspace
cargo test -p slei-desktop broker_startup_updates_existing_guide_create_skill_body
cargo test -p slei-desktop guide_local_product_tool_appends_card_message
```

Expected: PASS.

- [ ] **Step 5: Check generated assets**

Run:

```sh
pnpm --filter @slei/desktop check:default-agent-assets
```

Expected: PASS.

- [ ] **Step 6: Check diff hygiene**

Run:

```sh
git diff --check
git status -sb
```

Expected: no whitespace errors; only intentional files changed.

---

## Runtime Behavior Notes

- New Agents created after this change get canonical `MEMORY.md` and standard Skill bodies from the shared resource assets.
- Existing runtime workspaces keep their real files. Startup reconciliation should update only known Slei-managed standard guide-create defaults, preserving user-customized Skill files.
- If the canonical guide-create body changes later, update the resource file first, regenerate TS, then run Rust and desktop checks.
- In overlay workspaces, canonical Skill files still need to be materialized at the overlay root when they are intended to be visible from SDK `cwd`.

## Skill Conflict Policy

This plan does not change overlay Skill conflict resolution. Keep the current intended policy:

- overlay root standard Slei Skills win for built-in Agent behavior visible from SDK `cwd`
- project-linked Skills stay inside their project directories
- agent workspace Skills can be injected into prompt metadata when they are not physically loadable by the SDK
- same-name non-standard project Skills should be reported as conflicts instead of silently overwritten

## Open Follow-Up

After this consolidation lands, consider a separate plan for product tool contract centralization:

- tool names
- input schemas
- permission descriptions
- worker system-prompt reminders
- daemon event parser error messages

That should be separate because it crosses worker protocol, daemon validation, and product UX copy rather than just default Agent runtime assets.
