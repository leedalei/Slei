# Slei Claude CLI Runtime 与 System Prompt 注入设计

## 背景

Slei 第一阶段已经落地 broadcast delivery、Agent claim、`slei` CLI、任务 CLI、Agent 状态日志和 `MEMORY.md` Active Context。剩余关键缺口在执行面和 prompt 合同：

- `workers/claude-agent` 仍通过 `@anthropic-ai/claude-agent-sdk query()` 启动 Claude Code。
- Agent 的完整 system prompt 仍主要由 worker 侧拼装，daemon 没有把角色、CLI 合同、消息 header、行为约定和运行时上下文作为统一 prompt contract 传给 worker。

本阶段目标是把 Claude runtime 从 SDK query 迁移为 spawn Claude CLI，并让 daemon 成为 Slei system prompt 的 source of truth。cwd 选择、session id、model、workspace overlay 和现有 reset/diagnostic 边界不改变。

## 目标

1. `workers/claude-agent` 不再调用 `@anthropic-ai/claude-agent-sdk query()` 执行 run，改为 spawn `claude` CLI。
2. CLI run 使用 stream-json 输出，worker 继续向 daemon 输出现有 worker events。
3. daemon 在每次 `start_run` command 中传入完整 Slei system prompt。
4. Agent system prompt 覆盖：
   - Agent 角色定义。
   - 所有 `slei` CLI 命令说明。
   - 消息 header 字段说明。
   - claim、静默、任务、handoff、状态更新、MEMORY 使用规则。
   - 当前运行时上下文：Agent ID、channel/server/computer/cwd/session 等。
5. broadcast prompt 只承载当前触发消息；行为规则和 CLI 合同放在 system prompt 中，避免每条消息重复大段说明。
6. 文档同步说明 runtime 已由 SDK query 切换为 spawn CLI。

## 非目标

- 不重新设计 `slei` CLI 命令语义。
- 不改变 daemon 的 cwd 选择逻辑。
- 不实现旧 JSON 数据兼容迁移；开发 reset 仍可清空旧运行数据。
- 不引入第二套本地 mock 或 UI 路由。
- 不要求本阶段把历史 coordinator 代码全部删除；但普通频道消息新路径不得依赖它。

## 架构决策

### Claude CLI 执行模型

worker 使用 `node:child_process.spawn` 启动：

```sh
claude --print \
  --output-format stream-json \
  --include-partial-messages \
  --append-system-prompt "<daemon generated prompt>" \
  --mcp-config "<json string or json file path>" \
  --tools Skill,Read,Grep,Glob,LS,Write,Edit,MultiEdit \
  --allowedTools Skill,Read,Grep,Glob,LS,mcp__slei__slei_propose_interactive_card,... \
  --disallowedTools Task,Plugin:*,Bash:curl,Bash:wget \
  --setting-sources user,project,local \
  --permission-mode <mode> \
  --model <model> \
  --session-id <id> | --resume <id> | --no-session-persistence \
  "<prompt>"
```

要求：

- `cwd` 使用 `prepareWorkspace(command.session).cwd`，不改变现有 cwd 决策。
- `additionalDirectories` 映射到 `--add-dir`。
- `command.input.system_prompt` 必须映射到 `--append-system-prompt`。
- `command.session.persist_session=false` 使用 `--no-session-persistence`。
- 首次持久 session 使用 `--session-id`，恢复使用 `--resume`。
- 恢复 session 如果 CLI 在未产生任何事件前失败，仍按现有策略重试为 fresh session。
- stderr 累积进 failure message，便于 debug。

### stream-json 事件映射

worker 解析 Claude CLI stdout 的 JSONL/stream-json。映射规则尽量复用现有 `ClaudeSdkEvent` -> `WorkerEvent` 管道：

| Claude CLI event | Worker event |
| --- | --- |
| assistant text delta / assistant message text | `output_delta` |
| tool use | `tool_started`，若是 Slei product tool 则 `product_tool_requested` |
| tool result | `tool_completed` |
| permission request / can-use-tool request | `permission_requested` |
| result success | `completed` |
| result error 或非 0 exit | `failed` |

如果 Claude CLI 的 stream-json 事件字段与 SDK 不完全一致，worker 应增加一个小的 CLI event normalizer，而不是把 CLI shape 泄漏到 daemon。

实现前必须先增加固定 fixture，例如 `workers/claude-agent/src/fixtures/cli-stream-json.fixture.jsonl`，覆盖：

- assistant partial delta。
- assistant final text。
- built-in tool use。
- built-in tool result。
- MCP product tool use。
- result success。
- result error。
- 坏 JSON 行。
- stderr + nonzero exit。

测试通过 fixture 验证 normalizer 输出稳定的内部 event，再由现有 `mapClaudeSdkEvent` 或重命名后的 runtime event mapper 转为 worker event。

### Slei product tools

SDK 当前用 in-process MCP server 暴露 `slei_propose_interactive_card`、`slei_request_visible_delegation`、`slei_request_human_reply`。CLI 模式需要继续让 Claude 看见这些 MCP tools。

本阶段采用本地 stdio MCP server：

- 新增 worker 内部 MCP server 入口，例如 `workers/claude-agent/src/mcp-server.ts`。
- `--mcp-config` 指向该 server，server command 使用当前 worker node/dist 入口。
- MCP server 收到 tool call 后只返回确认文本；真正的产品事件仍由 worker 从 CLI stream 中识别 tool_use 并上报 daemon。

这样 daemon 仍只消费 worker events，不需要直接和 MCP server 通信。

### MCP config contract

`--mcp-config` 必须传 JSON 字符串或包含 JSON 的临时文件路径。为避免 shell quoting 和命令长度问题，worker 默认写临时 JSON 文件，并在 run 结束后清理。

配置形态：

```json
{
  "mcpServers": {
    "slei": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/dist/mcp-server.js"],
      "env": {
        "SLEI_RUN_ID": "run_...",
        "SLEI_AGENT_ID": "agent_..."
      }
    }
  }
}
```

要求：

- `mcp-server.ts` 复用现有 product tool 名称和 schema，但不能依赖 `@anthropic-ai/claude-agent-sdk` 的 `createSdkMcpServer` / `tool` helper。
- 可继续使用 `@modelcontextprotocol/sdk` 和 `zod` 定义 stdio MCP server。
- 对 Claude 暴露的 tool names 必须仍是：
  - `mcp__slei__slei_propose_interactive_card`
  - `mcp__slei__slei_request_visible_delegation`
  - `mcp__slei__slei_request_human_reply`
- `slei-tools.ts` 应拆分为 SDK-free 的 tool schema/name helper；旧 SDK helper 删除或只在测试 fixture 中保留。
- Worker 测试必须断言生成的 MCP config JSON，包括 command、args、env 和 server name。
- MCP server 测试必须验证 tools/list 返回三个工具，且 tool input schema 与现有 product tool payload 兼容。

### 权限模型

CLI 支持 `--allowedTools`、`--disallowedTools` 和 `--permission-mode`，但不能直接复用 SDK 的 `canUseTool` 函数。

本阶段保持安全优先：

- Read-only 工具默认允许。
- Slei product MCP tools 默认允许。
- `Task`、plugin、危险 curl/wget 仍禁用。
- 写工具仍通过 Claude Code 的权限体系处理；Slei 继续通过 CLI args 限定 workspace 和工具集合。
- 本阶段不承诺保留 SDK `canUseTool` 驱动的 daemon approval flow。
- 如果当前 Claude CLI stream-json fixture 不能证明存在等价 permission request 事件，worker 不生成 `permission_requested`。
- daemon/adapter capabilities 必须把 approval 能力降级到静态 CLI 权限模式，相关测试应证明 UI/daemon 不再依赖 SDK `canUseTool` 事件。
- 后续若要恢复 Slei 自定义逐工具 approval，应单独设计 CLI permission hook 或 MCP approval bridge。

### Daemon system prompt contract

daemon 增加 system prompt builder，输出 plain text。worker 不再自行决定 Slei 业务规则，只把 daemon prompt 附加给 Claude CLI。

建议模块：

- `crates/slei-daemon/src/services/agent_prompt_service.rs`
- 或作为 `channel_orchestrator_service` / `agent_dm_service` 的私有 helper 起步，若复用变多再提取。

prompt 必须包含以下区块：

```text
## Slei Agent Identity
- Agent ID: ...
- Agent handle/name/role: ...

## Slei Runtime Context
- Server ID: ...
- Computer / node: ...
- Channel / thread / message: ...
- cwd/session/model: ...

## Message Header
[target=#channel msg=msg_id time=... type=human|agent|system]
字段含义...

## Claim Rules
- @我 -> claim
- @别人且没有 @我 -> 静默
- 无 mention 但职责/值守匹配 -> 可 claim
- claim=false -> 静默退出

## Slei CLI Commands
message claim/read/search/send...
task create/claim/reply/update/list/thread...
agent status...
退出码与 idempotency 约定...

## Task And Handoff Rules
任务 reply、可见 @mention handoff、不要隐式转交...

## MEMORY.md Rules
Active Context 最多 3 个频道/事项...
什么时候更新...
需要历史时主动 read/search...

## Output Rules
可见产品动作必须通过 slei CLI/API；普通 stdout 不会自动成为频道消息。
```

### prompt 分层

- `system_prompt`：稳定规则、CLI 合同、运行时元数据。
- `input.prompt`：本次触发消息或 DM 用户输入。
- `input.context`：只用于 DM 的最近对话上下文；broadcast 不注入完整历史。
- `MEMORY.md`：由 workspace 文件和 skill 读取，不把完整历史塞进 prompt。

## 数据结构和协议变更

### Worker protocol

`RunInput` 增加：

```ts
system_prompt?: string;
```

daemon `ClaudeWorkerAdapter::start_run` 增加可选 `system_prompt` 参数，并写入 worker command：

```json
{
  "input": {
    "prompt": "...",
    "context": [],
    "system_prompt": "..."
  }
}
```

旧 worker 若收到无 `system_prompt` 的 command，应仍可运行，但 Slei daemon 新路径必须传入。

需要同步：

- TypeScript `workers/claude-agent/src/protocol.ts`。
- Rust `crates/slei-daemon/src/adapters/claude_worker.rs`。
- worker RPC contract fixture，如存在 `tests/contract/worker-rpc.json` 或等价测试。
- TS protocol test：无 `system_prompt` 可反序列化；新 command 会保留 `system_prompt`。
- Rust adapter test：`start_run` command 包含 `input.system_prompt`。
- 编译或测试层面覆盖全部 daemon callsite，避免新增 `start_run` 时漏传 system prompt。

### CLI args helper

`buildClaudeCliArgs(command, preparedWorkspace?)` 应包含 system prompt、MCP config、tools、model、session 参数。测试应直接断言 args，不依赖真实 Claude CLI。

## 错误处理

- spawn 失败：输出 `failed`，message 包含 executable 和错误。
- CLI 非 0 退出：如果没有 terminal event，输出 `failed`，message 包含 stderr。
- stdout JSON 行解析失败：输出 `failed`，包含截断后的坏行摘要。
- resume 失败且未产生事件：重试 fresh session；如果仍失败，输出 `failed`。
- CLI 已产生 terminal event 后进程退出，不重复生成 terminal event。

## 测试策略

### Worker 测试

- `buildClaudeCliArgs` 包含：
  - `--print`
  - `--output-format stream-json`
  - `--append-system-prompt`
  - `--mcp-config`
  - `--add-dir`
  - `--model`
  - session 参数。
- `runClaudeCode` 使用 fake spawner，不调用 SDK query。
- stream-json assistant text 映射为 `output_delta`。
- stream-json product tool use 映射为 `product_tool_requested`。
- result success 映射为 `completed`。
- 非 0 exit + stderr 映射为 `failed`。
- resume pre-event failure 会用 fresh session 重试。
- CLI permission request 若 fixture 证明存在，应映射为 `permission_requested`；若不存在，不伪造事件。
- MCP config helper 生成稳定 JSON 文件内容。
- stdio MCP server 的 tools/list 暴露三个 Slei product tools。
- `@anthropic-ai/claude-agent-sdk` 不再被 worker production runtime import。

### Daemon 测试

- `ClaudeWorkerAdapter::start_run` command 包含 `input.system_prompt`。
- DM run system prompt 包含角色、CLI 合同、runtime context。
- broadcast run system prompt 包含 message header/claim/CLI/MEMORY 规则；`input.prompt` 只包含触发消息；`input.context` 必须为空；旧历史不得进入 `input.prompt`。
- task handoff run system prompt 包含 task id、thread/source message、visible mention handoff 规则；`input.prompt` 只包含本次任务线程触发消息。
- coordinator legacy run 如果仍存在，必须传 legacy/minimal system prompt，不能阻塞普通 broadcast 新路径。

### 回归测试

- `cargo test --workspace`
- `pnpm --filter @slei/claude-agent test`
- `pnpm --filter @slei/claude-agent typecheck`

## 文档更新

- 更新 `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`：runtime launcher 明确是 spawn Claude CLI；daemon 生成 system prompt。
- 如需保留历史 ADR 0001/0002 中 SDK 描述，追加说明它们是早期边界设计，当前实现以 0005 为准。

## 验收标准

- 生产执行路径没有 `claudeAgentQuery` / SDK query 调用。
- `@anthropic-ai/claude-agent-sdk` 不再作为 worker runtime 执行依赖；MCP helper 替换后，应从 worker dependencies 移除。
- daemon 发出的 `start_run` command 都带完整 `system_prompt`。
- broadcast/DM/task 关键路径测试证明 Agent 能看到 Slei CLI 合同和行为规则。
- worker RPC/protocol contract 覆盖 `input.system_prompt`。
- MCP config 和 stdio MCP server 有测试覆盖。
- 若 CLI 不能提供等价 permission request 事件，capabilities 和测试明确 approval 降级为静态 CLI 权限模式。
- 所有新增生产代码都有先失败后通过的测试覆盖。
