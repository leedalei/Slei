# Slei Claude CLI Runtime 与 System Prompt 注入 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Slei Claude worker 从 SDK `query()` 执行迁移到 spawn Claude CLI，并由 daemon 为每次 run 注入完整 Slei system prompt。

**Architecture:** daemon 生成 Slei system prompt 并通过 worker RPC `input.system_prompt` 传给 worker；worker 负责把 prompt、cwd、session、model、MCP config 和工具限制映射到 `claude --print --output-format stream-json`。worker 解析 CLI JSONL 为稳定内部 runtime events，再复用现有 worker event 边界返回 daemon。

**Tech Stack:** Rust 2021, Axum/Tokio, serde_json, TypeScript, Vitest, Node child_process, Claude Code CLI, Model Context Protocol SDK, Markdown ADR。

---

## 规格

设计规格：`docs/superpowers/specs/2026-06-16-slei-claude-cli-system-prompt-design.md`

知识检索结果：

- `docs/knowledge/` 中没有匹配 Claude/runtime/prompt 的历史条目。
- `docs/knowledge/patterns/critical-patterns.md` 不存在。

## 文件结构

### Worker Protocol And Runtime

- Modify: `tests/contract/worker-rpc.json`  
  在 `commands.start_run.input` 中加入 `system_prompt` fixture。
- Modify: `workers/claude-agent/src/protocol.ts`  
  `RunInput` 增加 `system_prompt?: string`。
- Modify: `workers/claude-agent/src/events.ts`  
  将 SDK 命名泛化为 runtime event 命名，保留兼容导出直到 worker 测试迁完。
- Create: `workers/claude-agent/src/fixtures/cli-stream-json/success.jsonl`  
  固定 CLI stream-json success 样例，覆盖 partial/final text、tool use/result、MCP product tool、success result。
- Create: `workers/claude-agent/src/fixtures/cli-stream-json/error.jsonl`  
  固定 CLI stream-json error 样例，覆盖 result error。
- Create: `workers/claude-agent/src/fixtures/cli-stream-json/bad-line.txt`  
  固定坏 JSON 行样例。
- Create: `workers/claude-agent/src/claude-cli.ts`  
  CLI args、MCP config、spawn runner、JSONL parser、CLI event normalizer。
- Create: `workers/claude-agent/src/claude-cli.test.ts`  
  CLI args、MCP config、JSONL normalizer、fake spawner 测试。
- Modify: `workers/claude-agent/src/worker.ts`  
  删除 SDK query 执行路径，调用 `runClaudeCodeCli`。
- Modify: `workers/claude-agent/src/local-runner.ts`  
  使用 CLI runner 输出 worker events；worker artifact 仍由 daemon 启动该文件。
- Modify: `workers/claude-agent/src/worker.test.ts`  
  删除 SDK query 行为断言，改为 fake spawner/CLI stream tests。
- Modify: `workers/claude-agent/src/events.test.ts`  
  contract fixture 断言 `system_prompt`，runtime event mapper 覆盖新命名。
- Modify/Delete: `workers/claude-agent/src/permissions.ts`  
  删除 SDK `canUseTool` production permission controller，或降级为静态 CLI permission constants。
- Modify/Delete: `workers/claude-agent/src/permissions.test.ts`  
  删除 SDK approval 测试，改为静态 CLI 权限常量测试。
- Modify: `workers/claude-agent/package.json`  
  移除 `@anthropic-ai/claude-agent-sdk` dependency。
- Modify: `pnpm-lock.yaml`  
  随 dependency 移除更新。

### Worker MCP

- Modify: `workers/claude-agent/src/slei-tools.ts`  
  移除 SDK helper import，保留 SDK-free tool names、MCP names、JSON schemas、product event helper。
- Create: `workers/claude-agent/src/mcp-server.ts`  
  可直接执行的 stdio MCP server，编译后由 Claude CLI `--mcp-config` 指向 `dist/mcp-server.js`。
- Modify: `workers/claude-agent/src/slei-tools.test.ts`  
  覆盖 SDK-free tool definitions、MCP tool names、event helper。
- Create: `workers/claude-agent/src/mcp-server.test.ts`  
  覆盖 tools/list 和 call tool ack 行为。

### Daemon Prompt Contract

- Modify: `crates/slei-daemon/src/adapters/claude_worker.rs`  
  `start_run` 必须接收 `system_prompt: &str` 并发送 `input.system_prompt`。
- Create: `crates/slei-daemon/src/services/agent_prompt_service.rs`  
  生成 Slei system prompt。
- Modify: `crates/slei-daemon/src/services/mod.rs`  
  导出 `agent_prompt_service`。
- Modify: `crates/slei-daemon/src/state.rs`  
  初始化并暴露 prompt service，或让调用点直接构造无状态 service。
- Modify: `crates/slei-daemon/src/services/agent_dm_service.rs`  
  DM run 传入完整 system prompt。
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`  
  broadcast/task handoff run 传入完整 system prompt；broadcast `input.prompt` 只保留触发消息，`input.context` 为空。
- Modify: `crates/slei-daemon/src/services/coordinator_service.rs`  
  legacy coordinator run 传 minimal legacy system prompt，避免漏传。
- Modify: `crates/slei-daemon/tests/claude_worker.rs`  
  adapter command contract 测试。
- Modify: `crates/slei-daemon/tests/agent_workspace.rs`  
  DM prompt contract 测试。
- Modify: `crates/slei-daemon/tests/channel_orchestration_flow.rs`  
  broadcast/task prompt 三层边界测试。

### Docs

- Modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`  
  记录 daemon 生成 system prompt、worker spawn Claude CLI、approval 降级为静态 CLI 权限模式。
- Modify: `docs/architecture/0001-runtime-adapter-and-process-boundaries.md`  
  追加历史说明：早期 SDK 边界已由 0005/本阶段实现替代。
- Modify: `docs/architecture/0002-claude-worker-packaging-spike.md`  
  更新 runtime 执行描述，避免继续把 SDK query 写成当前实现。

## Task 1: Worker RPC Contract Adds `system_prompt`

**Files:**
- Modify: `tests/contract/worker-rpc.json`
- Modify: `workers/claude-agent/src/protocol.ts`
- Modify: `workers/claude-agent/src/events.test.ts`
- Modify: `crates/slei-daemon/src/adapters/claude_worker.rs`
- Modify: `crates/slei-daemon/tests/claude_worker.rs`

- [ ] **Step 1: 写 TypeScript contract 失败测试**

在 `workers/claude-agent/src/events.test.ts` 的 `"models commands..."` 测试中加入：

```ts
expect(startRun.input.system_prompt).toContain("Slei system prompt");
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @slei/claude-agent test -- events.test.ts
```

Expected: FAIL，`system_prompt` 不存在。

- [ ] **Step 3: 更新 contract fixture**

在 `tests/contract/worker-rpc.json`：

```json
"input": {
  "prompt": "Implement the task",
  "system_prompt": "Slei system prompt: use slei CLI and claim rules.",
  "context": [{ "role": "user", "content": "Previous undeleted message" }]
}
```

- [ ] **Step 4: 更新 TypeScript protocol**

在 `workers/claude-agent/src/protocol.ts`：

```ts
export type RunInput = {
  prompt: string;
  system_prompt?: string;
  context: Array<{ role: "user" | "assistant" | "system"; content: string }>;
};
```

- [ ] **Step 5: 运行 TypeScript 测试确认通过**

```bash
pnpm --filter @slei/claude-agent test -- events.test.ts
```

Expected: PASS。

- [ ] **Step 6: 写 Rust adapter 失败测试**

在 `crates/slei-daemon/tests/claude_worker.rs` 增加或修改 `claude_worker_start_run_and_cancel_write_private_worker_commands`：

```rust
adapter
    .start_run(
        "run_1",
        &session,
        "hello",
        "Slei system prompt: claim with slei-cli message claim.",
        Vec::new(),
    )
    .unwrap();

assert_eq!(
    commands[0]["input"]["system_prompt"],
    "Slei system prompt: claim with slei-cli message claim."
);
```

- [ ] **Step 7: 运行 Rust 测试确认失败**

```bash
cargo test -p slei-daemon --test claude_worker claude_worker_start_run_and_cancel_write_private_worker_commands
```

Expected: FAIL，方法签名或 JSON 字段不匹配。

- [ ] **Step 8: 更新 Rust adapter 签名**

在 `crates/slei-daemon/src/adapters/claude_worker.rs`：

```rust
pub fn start_run(
    &self,
    run_id: &str,
    session: &RuntimeSession,
    prompt: &str,
    system_prompt: &str,
    context: Vec<Value>,
) -> Result<(), ClaudeWorkerError> {
    self.transport.send(json!({
        "type": "start_run",
        "run_id": run_id,
        "session": { /* existing fields */ },
        "input": {
            "prompt": prompt,
            "system_prompt": system_prompt,
            "context": context,
        }
    }))?;
    Ok(())
}
```

- [ ] **Step 9: 临时修复 compile callsites**

先给三个 callsite 传临时字符串，后续 Task 7 替换为真实 prompt：

```rust
"Slei runtime system prompt pending daemon builder."
```

Files:
- `crates/slei-daemon/src/services/agent_dm_service.rs`
- `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- `crates/slei-daemon/src/services/coordinator_service.rs`

- [ ] **Step 10: 运行验证**

```bash
cargo test -p slei-daemon --test claude_worker
pnpm --filter @slei/claude-agent test -- events.test.ts
```

Expected: PASS。

- [ ] **Step 11: 提交**

```bash
git add tests/contract/worker-rpc.json workers/claude-agent/src/protocol.ts workers/claude-agent/src/events.test.ts crates/slei-daemon/src/adapters/claude_worker.rs crates/slei-daemon/tests/claude_worker.rs crates/slei-daemon/src/services/agent_dm_service.rs crates/slei-daemon/src/services/channel_orchestrator_service.rs crates/slei-daemon/src/services/coordinator_service.rs
git commit -m "feat: pass system prompt through worker protocol"
```

## Task 2: SDK-Free Slei Product Tool Definitions And MCP Server

**Files:**
- Modify: `workers/claude-agent/src/slei-tools.ts`
- Modify: `workers/claude-agent/src/slei-tools.test.ts`
- Create: `workers/claude-agent/src/mcp-server.ts`
- Create: `workers/claude-agent/src/mcp-server.test.ts`

- [ ] **Step 1: 写 SDK-free tool definition 失败测试**

在 `workers/claude-agent/src/slei-tools.test.ts` 增加：

```ts
import {
  isSleiProductToolName,
  SLEI_PRODUCT_TOOL_DEFINITIONS,
  toSleiMcpToolName,
} from "./slei-tools.js";

it("defines SDK-free MCP tool schemas", () => {
  expect(SLEI_PRODUCT_TOOL_DEFINITIONS.map((tool) => tool.name).sort()).toEqual([
    "slei_propose_interactive_card",
    "slei_request_human_reply",
    "slei_request_visible_delegation",
  ]);
  expect(toSleiMcpToolName("slei_propose_interactive_card")).toBe(
    "mcp__slei__slei_propose_interactive_card",
  );
  expect(SLEI_PRODUCT_TOOL_DEFINITIONS[0].inputSchema).toHaveProperty("type", "object");
  expect(isSleiProductToolName("slei_request_human_reply")).toBe(true);
  expect(isSleiProductToolName("unknown_tool")).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @slei/claude-agent test -- slei-tools.test.ts
```

Expected: FAIL，`SLEI_PRODUCT_TOOL_DEFINITIONS` 不存在或 SDK import 仍耦合。

- [ ] **Step 3: 拆出 SDK-free tool definitions**

在 `workers/claude-agent/src/slei-tools.ts` 移除 `@anthropic-ai/claude-agent-sdk` import，保留：

```ts
export type JsonSchema = Record<string, unknown>;

export type SleiProductToolDefinition = {
  name: ProductToolRequestedEvent["tool_name"];
  description: string;
  inputSchema: JsonSchema;
};

export const SLEI_PRODUCT_TOOL_DEFINITIONS: readonly SleiProductToolDefinition[] = [
  {
    name: "slei_propose_interactive_card",
    description: "Propose a typed Slei interactive card for user confirmation.",
    inputSchema: {
      type: "object",
      required: ["kind", "title", "summary", "draft", "actionLabel", "doneLabel"],
      properties: {
        kind: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
        draft: { type: "object", additionalProperties: true },
        actionLabel: { type: "string" },
        doneLabel: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  /* visible delegation and human reply definitions */
];
```

Keep:
- `SLEI_PRODUCT_TOOL_NAMES`
- `toSleiMcpToolName`
- `fromSleiMcpToolName`
- `isSleiProductToolName` as an exported function
- `createSleiTools`
- `parseFreeformAssistantText`

Delete `createSleiMcpServer`.

- [ ] **Step 4: 写 MCP server 失败测试**

Create `workers/claude-agent/src/mcp-server.test.ts` with a unit-level helper:

```ts
import { describe, expect, it } from "vitest";
import { listSleiMcpTools, callSleiMcpTool } from "./mcp-server.js";

describe("Slei stdio MCP server helpers", () => {
  it("lists Slei product tools with MCP schemas", () => {
    expect(listSleiMcpTools().map((tool) => tool.name).sort()).toEqual([
      "slei_propose_interactive_card",
      "slei_request_human_reply",
      "slei_request_visible_delegation",
    ]);
  });

  it("acknowledges tool calls without mutating product state", async () => {
    await expect(
      callSleiMcpTool("slei_request_visible_delegation", {
        target: "@alice",
        summary: "Review this",
      }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("Slei received") }],
    });
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

```bash
pnpm --filter @slei/claude-agent test -- mcp-server.test.ts
```

Expected: FAIL，文件不存在。

- [ ] **Step 6: 实现 MCP server helper**

Create `workers/claude-agent/src/mcp-server.ts`:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { SLEI_PRODUCT_TOOL_DEFINITIONS, isSleiProductToolName } from "./slei-tools.js";

export function listSleiMcpTools() {
  return SLEI_PRODUCT_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export async function callSleiMcpTool(name: string, _args: unknown): Promise<CallToolResult> {
  if (!isSleiProductToolName(name)) {
    throw new Error(`unknown Slei MCP tool: ${name}`);
  }
  return {
    content: [{ type: "text", text: "Slei received this product tool request and will show it in the app." }],
  };
}

export async function runSleiMcpServer(): Promise<void> {
  const server = new Server({ name: "slei", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listSleiMcpTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callSleiMcpTool(request.params.name, request.params.arguments),
  );
  await server.connect(new StdioServerTransport());
}
```

If the installed MCP SDK API differs, adapt to the local `@modelcontextprotocol/sdk@1.29.0` types while preserving tests.

- [ ] **Step 7: Wire MCP server executable entrypoint**

At the bottom of `workers/claude-agent/src/mcp-server.ts`:

```ts
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSleiMcpServer();
}
```

Do not route this through `index.ts`; daemon worker launch still uses `dist/local-runner.js`, while Claude CLI MCP config uses `dist/mcp-server.js`.

- [ ] **Step 8: 运行测试**

```bash
pnpm --filter @slei/claude-agent test -- slei-tools.test.ts mcp-server.test.ts
pnpm --filter @slei/claude-agent typecheck
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add workers/claude-agent/src/slei-tools.ts workers/claude-agent/src/slei-tools.test.ts workers/claude-agent/src/mcp-server.ts workers/claude-agent/src/mcp-server.test.ts
git commit -m "feat: expose slei product tools over mcp"
```

## Task 3: Claude CLI Args, MCP Config, JSONL Normalizer

**Files:**
- Create: `workers/claude-agent/src/fixtures/cli-stream-json/success.jsonl`
- Create: `workers/claude-agent/src/fixtures/cli-stream-json/error.jsonl`
- Create: `workers/claude-agent/src/fixtures/cli-stream-json/bad-line.txt`
- Create: `workers/claude-agent/src/claude-cli.ts`
- Create: `workers/claude-agent/src/claude-cli.test.ts`
- Modify: `workers/claude-agent/src/worker.test.ts`
- Modify: `workers/claude-agent/src/events.ts`

- [ ] **Step 1: 写 CLI args 失败测试**

Create `workers/claude-agent/src/claude-cli.test.ts` with:

```ts
import { buildClaudeCliArgs, buildSleiMcpConfig } from "./claude-cli.js";

it("builds Claude CLI args with system prompt, MCP config, model and session", () => {
  const command = startRunCommand({
    system_prompt: "Slei system prompt",
    model: "Sonnet",
    additional_directories: ["/workspace/shared"],
  });
  const mcpConfigPath = "/tmp/slei-mcp.json";

  expect(buildClaudeCliArgs(command, { mcpConfigPath })).toEqual([
    "--print",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--append-system-prompt",
    "Slei system prompt",
    "--mcp-config",
    "/tmp/slei-mcp.json",
    "--tools",
    "Skill,Read,Grep,Glob,LS,Write,Edit,MultiEdit",
    "--allowedTools",
    expect.stringContaining("mcp__slei__slei_propose_interactive_card"),
    "--disallowedTools",
    "Task,Plugin:*,Bash:curl,Bash:wget",
    "--setting-sources",
    "user,project,local",
    "--permission-mode",
    "default",
    "--model",
    "sonnet",
    "--add-dir",
    "/workspace/shared",
    "--session-id",
    "11111111-1111-4111-8111-111111111111",
    "hello",
  ]);
});

it("builds MCP config for the Slei stdio server", () => {
  expect(
    buildSleiMcpConfig({
      runId: "run_1",
      agentId: "agent_guide",
      serverPath: "/abs/dist/mcp-server.js",
    }),
  ).toEqual({
    mcpServers: {
      slei: {
        type: "stdio",
        command: "node",
        args: ["/abs/dist/mcp-server.js"],
        env: {
          SLEI_RUN_ID: "run_1",
          SLEI_AGENT_ID: "agent_guide",
        },
      },
    },
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @slei/claude-agent test -- claude-cli.test.ts
```

Expected: FAIL，`claude-cli.ts` 不存在或 args 不匹配。

- [ ] **Step 3: 添加 CLI stream fixtures**

Create `workers/claude-agent/src/fixtures/cli-stream-json/success.jsonl`:

```jsonl
{"type":"assistant","message":{"content":[{"type":"text","text":"准"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"备完成。"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_read","name":"Read","input":{"file_path":"MEMORY.md"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool_read","content":"ok","is_error":false}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_card","name":"mcp__slei__slei_propose_interactive_card","input":{"kind":"createAgent","title":"创建 Bob","summary":"Bob","draft":{"name":"Bob"},"actionLabel":"创建","doneLabel":"DONE"}}]}}
{"type":"result","is_error":false}
```

Create `workers/claude-agent/src/fixtures/cli-stream-json/error.jsonl`:

```jsonl
{"type":"assistant","message":{"content":[{"type":"text","text":"准备失败。"}]}}
{"type":"result","is_error":true,"subtype":"error_during_execution","errors":["tool failed"]}
```

Create `workers/claude-agent/src/fixtures/cli-stream-json/bad-line.txt`:

```text
{"type":"assistant",
```

- [ ] **Step 4: 写 normalizer 失败测试**

In `workers/claude-agent/src/claude-cli.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { cliJsonLineToRuntimeEvents } from "./claude-cli.js";

it("normalizes Claude CLI stream-json into runtime events", () => {
  const lines = readFileSync(new URL("./fixtures/cli-stream-json/success.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n");
  const events = lines.flatMap((line) => cliJsonLineToRuntimeEvents("run_1", "agent_guide", line));

  expect(events).toContainEqual({
    type: "assistant",
    runId: "run_1",
    message: { content: [{ type: "text", text: "准" }] },
  });
  expect(events).toContainEqual({
    type: "assistant",
    runId: "run_1",
    message: { content: [{ type: "text", text: "备完成。" }] },
  });
  expect(events).toContainEqual({
    type: "tool_use",
    runId: "run_1",
    id: "tool_read",
    name: "Read",
  });
  expect(events).toContainEqual({
    type: "product_tool",
    runId: "run_1",
    toolUseId: "tool_card",
    agentId: "agent_guide",
    toolName: "slei_propose_interactive_card",
    payload: expect.objectContaining({ kind: "createAgent" }),
  });
  expect(events).toContainEqual({ type: "completed", runId: "run_1" });
});

it("normalizes Claude CLI result errors into failed runtime events", () => {
  const lines = readFileSync(new URL("./fixtures/cli-stream-json/error.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n");
  const events = lines.flatMap((line) => cliJsonLineToRuntimeEvents("run_1", "agent_guide", line));

  expect(events).toContainEqual({
    type: "failed",
    runId: "run_1",
    message: "tool failed",
  });
});
```

Add bad JSON test:

```ts
const badLine = readFileSync(new URL("./fixtures/cli-stream-json/bad-line.txt", import.meta.url), "utf8").trim();
expect(() => cliJsonLineToRuntimeEvents("run_1", "agent_guide", badLine)).toThrow(/invalid Claude CLI JSON/);
```

- [ ] **Step 5: 实现 `claude-cli.ts` 最小代码**

Implement:

```ts
export type ClaudeCliRunOptions = {
  mcpConfigPath: string;
};

export function buildClaudeCliArgs(command: StartRunCommand, options: ClaudeCliRunOptions): string[] { /* args */ }
export function buildSleiMcpConfig(input: { runId: string; agentId: string; serverPath: string }) { /* JSON */ }
export function cliJsonLineToRuntimeEvents(runId: string, agentId: string, line: string): ClaudeSdkEvent[] { /* normalizer */ }
```

Keep event type name temporarily `ClaudeSdkEvent` only if needed for compatibility; prefer adding alias:

```ts
export type RuntimeEvent = ClaudeSdkEvent;
export const mapRuntimeEvent = mapClaudeSdkEvent;
```

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter @slei/claude-agent test -- claude-cli.test.ts
pnpm --filter @slei/claude-agent typecheck
```

Expected: PASS for new args/normalizer tests.

- [ ] **Step 7: 提交**

```bash
git add workers/claude-agent/src/claude-cli.ts workers/claude-agent/src/claude-cli.test.ts workers/claude-agent/src/fixtures/cli-stream-json workers/claude-agent/src/events.ts
git commit -m "feat: normalize claude cli stream events"
```

## Task 4: Replace SDK Query Execution With Spawned Claude CLI

**Files:**
- Modify: `workers/claude-agent/src/claude-cli.ts`
- Modify: `workers/claude-agent/src/worker.ts`
- Modify: `workers/claude-agent/src/local-runner.ts`
- Modify: `workers/claude-agent/src/worker.test.ts`
- Modify: `workers/claude-agent/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: 写 fake spawner 失败测试**

In `workers/claude-agent/src/worker.test.ts`:

```ts
it("runs Claude CLI through a spawned process and maps output", async () => {
  const spawned: Array<{ command: string; args: string[]; cwd: string }> = [];
  const spawner = fakeClaudeSpawner({
    stdout: [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "result", is_error: false }),
    ].join("\n"),
    stderr: "",
    exitCode: 0,
    onSpawn(command, args, options) {
      spawned.push({ command, args, cwd: options.cwd });
    },
  });

  const events = [];
  for await (const event of runClaudeCode(commandWithSystemPrompt(), { spawner })) {
    events.push(event);
  }

  expect(spawned[0]).toMatchObject({ command: "claude", cwd: "/workspace/agent_guide" });
  expect(JSON.stringify(spawned[0].args)).toContain("--append-system-prompt");
  expect(events).toEqual([
    { type: "assistant", runId: "run_1", message: { content: [{ type: "text", text: "hello" }] } },
    { type: "completed", runId: "run_1" },
  ]);
});
```

- [ ] **Step 2: 写 failure/retry 失败测试**

Add tests:

```ts
it("includes Claude CLI stderr when the process exits nonzero before terminal event", async () => {
  /* fake spawner stderr: "auth missing\n", exitCode: 1; expect failed message contains stderr */
});
it("retries resumed runs as fresh session when CLI fails before events", async () => { /* first args --resume, second --session-id */ });
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @slei/claude-agent test -- worker.test.ts
```

Expected: FAIL because run still uses SDK query or fake spawner API missing.

- [ ] **Step 4: 实现 spawner abstraction**

In `workers/claude-agent/src/claude-cli.ts`:

```ts
export type ClaudeCliSpawner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

const defaultSpawner: ClaudeCliSpawner = (command, args, options) =>
  spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
```

Implement `runClaudeCodeCli(command, options?)`:

- prepare workspace.
- create temp MCP config file.
- spawn `claude`.
- read stdout by line.
- normalize each line to runtime events.
- accumulate stderr.
- yield completed if no terminal event and exit code is 0.
- yield failed for bad JSON, spawn error, nonzero without terminal event.
- cleanup temp MCP config file in finally.

- [ ] **Step 5: Update `worker.ts`**

Remove:

```ts
import { query as claudeAgentQuery } from "@anthropic-ai/claude-agent-sdk";
createSleiMcpServer
buildClaudeSdkOptions
streamSdkMessagesWithPermissionRequests
sdkMessageToClaudeEvents
```

Set:

```ts
import { runClaudeCodeCli, buildClaudeCliArgs, buildClearClaudeSessionCliArgs } from "./claude-cli.js";

const defaultRuntimeRunner: RuntimeRunner = (command) => runClaudeCodeCli(command);
```

Keep `ClaudeAgentWorker` authorization and event handling behavior unchanged.

- [ ] **Step 6: Update local runner**

`workers/claude-agent/src/local-runner.ts` should import `runClaudeCodeCli` or `runClaudeCode` after it is CLI-backed.

- [ ] **Step 7: Remove SDK dependency**

```bash
pnpm --filter @slei/claude-agent remove @anthropic-ai/claude-agent-sdk
```

If pnpm is unavailable in the harness, manually edit `workers/claude-agent/package.json` and run `pnpm install --lockfile-only` to update `pnpm-lock.yaml`.

- [ ] **Step 8: Run worker verification**

```bash
pnpm --filter @slei/claude-agent test
pnpm --filter @slei/claude-agent typecheck
rg -n "claude-agent-sdk|claudeAgentQuery|buildClaudeSdkOptions|createSdkMcpServer|canUseTool|permissionController|buildIsolatedSdkOptions|createRunPermissionController" workers/claude-agent/src workers/claude-agent/package.json
```

Expected:
- tests PASS.
- typecheck PASS.
- `rg` returns no production references. Test references are allowed only if asserting absence.

- [ ] **Step 9: Commit**

```bash
git add workers/claude-agent workers/claude-agent/package.json pnpm-lock.yaml
git commit -m "feat: run claude through cli"
```

## Task 5: Downgrade Worker Approval To Static CLI Permissions

**Files:**
- Modify/Delete: `workers/claude-agent/src/permissions.ts`
- Modify/Delete: `workers/claude-agent/src/permissions.test.ts`
- Modify: `workers/claude-agent/src/worker.ts`
- Modify: `workers/claude-agent/src/worker.test.ts`
- Modify: `workers/claude-agent/src/index.ts`

- [ ] **Step 1: 写 production reference 失败测试**

Add a test in `workers/claude-agent/src/worker.test.ts`:

```ts
it("does not expose SDK canUseTool approval hooks in CLI mode", async () => {
  const events: WorkerEvent[] = [];
  const runner: RuntimeRunner = async function* () {
    yield { type: "completed", runId: "run_1" };
  };
  const worker = new ClaudeAgentWorker("secret", { writeEvent: (event) => events.push(event) }, runner);

  await worker.handleCommand({ type: "hello", protocol_version: "v1", launch_secret: "secret" });
  await worker.handleCommand({ type: "resolve_permission", request_id: "perm_missing", decision: "approve" });

  expect(events).toEqual([]);
});
```

This proves the worker no longer keeps an in-process SDK permission controller that daemon/UI can depend on.

- [ ] **Step 2: 写静态 CLI permission constants 失败测试**

Replace `workers/claude-agent/src/permissions.test.ts` with static CLI permission tests:

```ts
import { CLAUDE_ALLOWED_TOOLS, CLAUDE_DISALLOWED_TOOLS, permissionModeForCli } from "./claude-cli.js";

it("uses static CLI tool constraints instead of SDK canUseTool approval hooks", () => {
  expect(CLAUDE_ALLOWED_TOOLS).toContain("Read");
  expect(CLAUDE_ALLOWED_TOOLS).toContain("mcp__slei__slei_propose_interactive_card");
  expect(CLAUDE_DISALLOWED_TOOLS).toContain("Task");
  expect(permissionModeForCli()).toBe("default");
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @slei/claude-agent test -- worker.test.ts permissions.test.ts
```

Expected: FAIL，worker 仍持有 permission controller 或 static constants 不存在。

- [ ] **Step 4: 删除 worker production permission controller**

In `workers/claude-agent/src/worker.ts`, remove:

- `RunPermissionController` from `RuntimeRunner`.
- `#permissionControllers`.
- `createRunPermissionController`.
- `streamSdkMessagesWithPermissionRequests`.
- `resolve_permission` loop.

`resolve_permission` command should be accepted as a no-op for protocol compatibility:

```ts
if (command.type === "resolve_permission") {
  return;
}
```

Daemon may still handle `permission_requested` events from future runtimes or tests, but CLI worker must not generate them without a proven CLI event fixture.

- [ ] **Step 5: Remove or isolate `permissions.ts`**

Preferred:

- Delete `workers/claude-agent/src/permissions.ts`.
- Keep `workers/claude-agent/src/permissions.test.ts`, but rewrite it to import static CLI permission constants from `./claude-cli.js`.
- Remove `export * from "./permissions.js";` from `workers/claude-agent/src/index.ts`.

If any static constants are still useful, move them to `workers/claude-agent/src/claude-cli.ts` and keep tests there.

- [ ] **Step 6: Run verification**

```bash
pnpm --filter @slei/claude-agent test
pnpm --filter @slei/claude-agent typecheck
rg -n "canUseTool|permissionController|buildIsolatedSdkOptions|createRunPermissionController" workers/claude-agent/src
```

Expected:
- tests PASS.
- typecheck PASS.
- `rg` returns no production references. If test files mention these strings only to assert absence, keep them narrowly scoped.

- [ ] **Step 7: Commit**

```bash
git add workers/claude-agent/src
git commit -m "refactor: use static cli permissions"
```

## Task 6: Daemon Slei System Prompt Builder

**Files:**
- Create: `crates/slei-daemon/src/services/agent_prompt_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`

- [ ] **Step 1: 写 prompt builder 失败测试**

Create unit tests in `agent_prompt_service.rs`:

```rust
#[test]
fn system_prompt_includes_identity_cli_header_rules_and_memory_contract() {
    let prompt = build_agent_system_prompt(AgentSystemPromptInput {
        agent_id: "agent_coda",
        handle: "@coda",
        name: "Coda",
        role: "编码助手",
        node_id: "local-node",
        cwd: "/workspace/agent_coda",
        session_id: "session_1",
        model: "Sonnet",
        channel_id: Some("dev"),
        channel_name: Some("#dev"),
        message_id: Some("msg_1"),
        task_id: None,
        runtime_kind: "ClaudeCode",
        legacy_mode: false,
    });

    assert!(prompt.contains("## Slei Agent Identity"));
    assert!(prompt.contains("Agent ID: agent_coda"));
    assert!(prompt.contains("Handle: @coda"));
    assert!(prompt.contains("slei-cli message claim <msg-id> --agent <agent-id>"));
    assert!(prompt.contains("slei-cli message read --channel \"#channel\" --around <msgId>"));
    assert!(prompt.contains("[target=#channel msg=<msg-id> time=<iso8601> type=<human|agent|system>]"));
    assert!(prompt.contains("Active Context"));
    assert!(prompt.contains("最多 3 个频道/事项"));
    assert!(!prompt.contains("raft "));
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-daemon agent_prompt_service
```

Expected: FAIL，module 不存在。

- [ ] **Step 3: 实现 prompt builder**

Create:

```rust
#[derive(Clone, Debug)]
pub struct AgentSystemPromptInput<'a> { /* fields from test */ }

pub fn build_agent_system_prompt(input: AgentSystemPromptInput<'_>) -> String { /* sections */ }

pub fn build_legacy_coordinator_system_prompt() -> String {
    "You are a legacy internal Slei routing worker...".to_string()
}
```

Prompt sections must include:
- identity.
- runtime context.
- message header.
- claim rules.
- CLI commands.
- task handoff.
- status phases.
- MEMORY Active Context.
- output rules.

- [ ] **Step 4: 导出 service**

`crates/slei-daemon/src/services/mod.rs`:

```rust
pub mod agent_prompt_service;
```

If state ownership is useful, add:

```rust
pub fn agent_prompts(&self) -> AgentPromptService
```

Keep builder stateless if simpler.

- [ ] **Step 5: Run tests**

```bash
cargo test -p slei-daemon agent_prompt_service
cargo fmt --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/slei-daemon/src/services/agent_prompt_service.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/state.rs
git commit -m "feat: build slei-cli agent system prompt"
```

## Task 7: Inject System Prompt Into DM, Broadcast, Task, Legacy Runs

**Files:**
- Modify: `crates/slei-daemon/src/services/agent_dm_service.rs`
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/src/services/coordinator_service.rs`
- Modify: `crates/slei-daemon/tests/agent_workspace.rs`
- Modify: `crates/slei-daemon/tests/channel_orchestration_flow.rs`
- Modify: `crates/slei-daemon/tests/claude_worker.rs`

- [ ] **Step 1: 写 DM system prompt 失败测试**

In `crates/slei-daemon/tests/agent_workspace.rs`, add to an existing DM start test or new test:

```rust
let command = start_run_command_with_prompt(&commands, "你好");
let system_prompt = command["input"]["system_prompt"].as_str().unwrap();
assert!(system_prompt.contains("Agent ID: agent_guide_local_node"));
assert!(system_prompt.contains("slei-cli message claim"));
assert!(system_prompt.contains("slei-cli task thread"));
assert!(system_prompt.contains("Active Context"));
assert_eq!(command["input"]["prompt"], "你好");
```

- [ ] **Step 2: 写 broadcast 三层边界失败测试**

In `crates/slei-daemon/tests/channel_orchestration_flow.rs`, extend `broadcast_channel_message_creates_deliveries_for_all_regular_targets`:

```rust
let command = start_run_for_agent(&state.worker_commands(), "agent_nova");
assert_eq!(command["input"]["context"], json!([]));
assert!(command["input"]["prompt"].as_str().unwrap().contains("[target=#dev msg="));
assert!(command["input"]["prompt"].as_str().unwrap().contains("本次触发消息"));
assert!(!command["input"]["prompt"].as_str().unwrap().contains("旧历史不应进 broadcast prompt"));
let system_prompt = command["input"]["system_prompt"].as_str().unwrap();
assert!(system_prompt.contains("## Claim Rules"));
assert!(system_prompt.contains("slei-cli message read --channel \"#channel\" --around <msgId>"));
assert!(system_prompt.contains("Agent ID: agent_nova"));
```

- [ ] **Step 3: 写 task handoff context 失败测试**

In `task_thread_visible_agent_mention_creates_task_scoped_inbox_event` or nearby:

```rust
let command = start_run_for_agent(&state.worker_commands(), "agent_alice");
let system_prompt = command["input"]["system_prompt"].as_str().unwrap();
assert!(system_prompt.contains("Task ID: task_"));
assert!(system_prompt.contains("Source Message ID:"));
assert!(system_prompt.contains("visible @mention handoff"));
assert_eq!(command["input"]["context"], json!([]));
```

- [ ] **Step 4: 运行测试确认失败**

```bash
cargo test -p slei-daemon --test agent_workspace guide_dm_without_card_shortcut_starts_runtime
cargo test -p slei-daemon --test channel_orchestration_flow broadcast_channel_message_creates_deliveries_for_all_regular_targets task_thread_visible_agent_mention_creates_task_scoped_inbox_event
```

Expected: FAIL，系统 prompt 是临时字符串或缺 task context。

- [ ] **Step 5: Inject DM prompt**

In `agent_dm_service.rs`, after session creation:

```rust
let system_prompt = build_agent_system_prompt(AgentSystemPromptInput {
    agent_id: &agent.id,
    handle: &agent.handle,
    name: &agent.name,
    role: &agent.description,
    node_id: &agent.node_id,
    cwd: &agent.workspace_path,
    session_id: &session.session_id,
    model: &agent.model,
    channel_id: None,
    channel_name: None,
    message_id: Some(&message.id),
    task_id: None,
    runtime_kind: &agent.runtime_kind,
    legacy_mode: false,
});
self.worker.start_run(&run_id, &session, &prompt, &system_prompt, context)?;
```

- [ ] **Step 6: Inject channel/broadcast/task prompt**

Change `start_channel_agent_reply_once` signature to receive prompt context:

```rust
async fn start_channel_agent_reply_once(
    &self,
    agent_id: &str,
    channel_id: &str,
    source_message_id: &str,
    prompt: &str,
    task_id: Option<String>,
    suppress_visible_output: bool,
) -> Result<(), ChannelOrchestratorError>
```

Inside, build:

```rust
let system_prompt = build_agent_system_prompt(AgentSystemPromptInput {
    agent_id: &agent.id,
    handle: &agent.handle,
    name: &agent.name,
    role: &agent.description,
    node_id: &agent.node_id,
    cwd: &agent.workspace_path,
    session_id: &session.session_id,
    model: &agent.model,
    channel_id: Some(channel_id),
    channel_name: Some(&format!("#{channel_id}")),
    message_id: Some(source_message_id),
    task_id: task_id.as_deref(),
    runtime_kind: &agent.runtime_kind,
    legacy_mode: false,
});
self.worker.start_run(run_id, &session, prompt, &system_prompt, Vec::new())?;
```

Ensure broadcast prompt remains the existing `broadcast_message_prompt` trigger only; do not append history.

- [ ] **Step 7: Inject legacy coordinator prompt**

In `coordinator_service.rs`:

```rust
let system_prompt = build_legacy_coordinator_system_prompt();
self.worker
    .start_run(&input.run_id, &session, &prompt, &system_prompt, Vec::new())
```

- [ ] **Step 8: Run targeted tests**

```bash
cargo test -p slei-daemon --test claude_worker
cargo test -p slei-daemon --test agent_workspace guide_dm_without_card_shortcut_starts_runtime
cargo test -p slei-daemon --test channel_orchestration_flow broadcast_channel_message_creates_deliveries_for_all_regular_targets task_thread_visible_agent_mention_creates_task_scoped_inbox_event
```

Expected: PASS.

- [ ] **Step 9: Run broader daemon tests**

```bash
cargo test -p slei-daemon --test channel_orchestration_flow
cargo test -p slei-daemon --test agent_workspace
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add crates/slei-daemon/src/services/agent_dm_service.rs crates/slei-daemon/src/services/channel_orchestrator_service.rs crates/slei-daemon/src/services/coordinator_service.rs crates/slei-daemon/tests/agent_workspace.rs crates/slei-daemon/tests/channel_orchestration_flow.rs crates/slei-daemon/tests/claude_worker.rs
git commit -m "feat: inject slei system prompts into agent runs"
```

## Task 8: Update Architecture Docs

**Files:**
- Modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Modify: `docs/architecture/0001-runtime-adapter-and-process-boundaries.md`
- Modify: `docs/architecture/0002-claude-worker-packaging-spike.md`

- [ ] **Step 1: 更新 0005**

Add:

- daemon generates system prompt.
- worker spawns Claude CLI.
- `input.prompt` carries current trigger only.
- `input.system_prompt` carries Slei contract.
- approval is static CLI permission mode unless future CLI permission bridge is implemented.

- [ ] **Step 2: 更新 0001/0002 历史说明**

Append a short note:

```md
> Update 2026-06-16: Claude Code execution now uses the Claude CLI worker path described in ADR 0005. This ADR remains historical boundary context.
```

- [ ] **Step 3: 搜索旧执行描述**

```bash
rg -n "claude-agent-sdk|SDK query|query\\(\\)|createSdkMcpServer|Claude Agent SDK" docs/architecture workers/claude-agent/src workers/claude-agent/package.json
```

Expected:
- No production worker/package references.
- Architecture references only in historical notes or explicit replaced-by context.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/0005-channel-routing-and-multi-agent-flow.md docs/architecture/0001-runtime-adapter-and-process-boundaries.md docs/architecture/0002-claude-worker-packaging-spike.md
git commit -m "docs: record claude cli runtime path"
```

## Task 9: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Worker verification**

```bash
pnpm --filter @slei/claude-agent test
pnpm --filter @slei/claude-agent typecheck
```

Expected: PASS.

- [ ] **Step 2: Rust verification**

```bash
cargo test --workspace
cargo fmt --check
```

Expected: PASS.

- [ ] **Step 3: Architecture/static scans**

```bash
git diff --check
rg -n "claude-agent-sdk|claudeAgentQuery|buildClaudeSdkOptions|createSdkMcpServer|canUseTool|permissionController|buildIsolatedSdkOptions|createRunPermissionController" workers/claude-agent/src workers/claude-agent/package.json
rg -n "\\braft\\b|routing JSON|coordinator runtime" docs/architecture docs/superpowers/specs docs/superpowers/plans resources/default-agent-assets -S
```

Expected:
- `git diff --check` clean.
- No production SDK references.
- No old `raft` command naming.

- [ ] **Step 4: Git status**

```bash
git status --short --branch
```

Expected: clean worktree on feature branch.

- [ ] **Step 5: Completion prompt**

Report verification evidence and ask whether to merge into `master` or another branch, per Slei project instruction.
