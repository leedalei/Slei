# Slei Agent 活动日志设计

## 背景

当前频道消息偶发出现“发送后没有 Agent 回复，也没有任何动静”的体验。Slei 已经有 `agent_activity_logs`、`/v1/agents/{agent_id}/activity` 和 `slei agent status`，但这条链路主要记录 Agent 主动上报的状态，例如 `working / reading_history`。当 Agent 没有回复时，用户仍难以判断：

- Agent 是否被 daemon 唤醒。
- Agent 收到了哪条触发消息。
- Agent 是否开始执行工具或 CLI。
- 工具、CLI、worker 是否失败。
- Agent 输出过什么内容，是否被截断、失败或没有形成可见产品消息。

本设计将现有 `agent_activity_logs` 从 status-only 历史升级为可展开的 Agent 活动事件流。daemon 仍是 source of truth；UI 只读取 daemon DTO 并展示，不在 React 中推导业务状态。

## 目标

1. 成员详情页新增 `活动日志` / `Activity` tab，展示当前 Agent 最近 200 条活动。
2. 活动日志默认展示摘要，单条展开后展示截断、脱敏后的 payload preview。
3. 记录足以排查“为什么没有回复”的关键事件：
   - run 启动。
   - 收到触发输入。
   - worker 输出片段。
   - tool / CLI 开始与完成。
   - run 完成或失败。
   - `slei agent status` 状态更新。
4. 日志生产、截断、脱敏和保留策略全部在 daemon / SQLite 层完成。
5. 每个 Agent 只保留最近 200 条日志；API 默认可返回 200 条。
6. 继续兼容现有 status activity 字段，避免破坏已有接口和测试。

## 非目标

- 不实现日志搜索、过滤或 live streaming。
- 不保存完整 system prompt。
- 不把日志表变成完整聊天备份或完整 worker transcript。
- 不在 UI 里拼装 Agent 行为、路由决策或 fallback mock。
- 不改变 claim、delivery、任务路由或 Agent 回复机制。
- 不新增独立 `agent_runtime_events` 表，除非实现阶段发现 SQLite migration 无法安全扩展现有表。

## 架构决策

### 总体路径

复用并扩展现有链路：

```text
Agent runtime / worker event / slei CLI
  -> daemon service
  -> slei-storage repositories
  -> agent_activity_logs
  -> GET /v1/agents/{agent_id}/activity?limit=200
  -> Tauri broker command
  -> Members detail Activity tab
```

关键约束：

- daemon 负责写入日志、截断 payload、脱敏敏感内容和执行保留策略。
- UI 负责 loading/error/empty、时间展示、摘要列表、展开 payload。
- worker event 转换层只提供事件字段，不直接决定业务持久化策略。
- 日志不参与路由、claim 或幂等业务判断，只用于诊断和展示。

### 事件类型

活动事件使用稳定的 `event_kind` 字段。首批事件类型：

| event_kind | 来源 | 含义 |
| --- | --- | --- |
| `status.updated` | `slei agent status` | Agent 主动上报状态 |
| `run.started` | channel / DM run 启动 | daemon 已创建 run 并准备唤醒 Agent |
| `input.received` | run prompt 构建后 | Agent 本次收到的触发输入摘要 |
| `output.delta` | worker `output_delta` | Agent 产生了回复片段 |
| `tool.started` | worker `tool_started` / product tool request | Agent 开始调用工具或 Slei MCP tool |
| `tool.completed` | worker `tool_completed` | 工具调用完成，包含成功与否 |
| `run.completed` | worker `completed` | runtime 正常结束 |
| `run.failed` | worker `failed` 或启动失败 | runtime 失败，包含失败摘要 |

实现可以增加内部辅助事件，但成员页只依赖上述稳定类型和通用字段。

## 数据模型

在 `agent_activity_logs` 上做向后兼容 migration，保留旧字段：

- `state`
- `phase`
- `reason`
- `run_id`
- `channel_id`
- `message_id`
- `task_id`

新增字段：

- `event_kind TEXT NOT NULL DEFAULT 'status.updated'`
- `severity TEXT NOT NULL DEFAULT 'info'`
- `summary TEXT NOT NULL DEFAULT ''`
- `payload_preview TEXT`
- `tool_name TEXT`
- `ok INTEGER`

`severity` 取值：

- `info`：普通进展。
- `warning`：非终止性异常、被拒绝、无输出等需要注意的情况。
- `error`：run 或工具失败。

`ok` 用于 tool/run 结果：

- `1`：成功。
- `0`：失败。
- `NULL`：不适用或未知。

### DTO

`GET /v1/agents/{agent_id}/activity?limit=200` 返回：

```json
{
  "logs": [
    {
      "id": "log_...",
      "agentId": "agent_coda",
      "runId": "run_...",
      "channelId": "all",
      "messageId": "msg_...",
      "taskId": null,
      "eventKind": "tool.completed",
      "severity": "info",
      "summary": "工具完成：Bash ok=true",
      "payloadPreview": "{\"tool\":\"Bash\",\"ok\":true}",
      "toolName": "Bash",
      "ok": true,
      "state": null,
      "phase": null,
      "reason": null,
      "createdAt": "2026-06-17 10:12:00"
    }
  ]
}
```

兼容要求：

- 旧 status 日志继续返回 `state/phase/reason`。
- 新字段对旧日志有默认值。
- API limit 需要 clamp，最大不超过 200；未传时默认 200。

## 截断与脱敏

payload preview 在 daemon 写入前处理。

规则：

- `payload_preview` 最大长度建议 4096 字符。
- 超长内容截断，并追加明确标记，例如 `...[truncated]`。
- 不记录完整 system prompt。
- 不记录完整 daemon token、Authorization、API key、secret、password、token、private key 等明显敏感字段。
- JSON payload 优先结构化脱敏后再序列化。
- 纯文本 payload 使用统一脱敏函数处理。
- 消息正文和输出片段只保留摘要或截断内容，不作为完整历史存储。

建议 repository 或 service 暴露统一 helper：

```text
sanitize_activity_payload(payload) -> payload_preview
summarize_activity_event(kind, fields) -> summary
```

## Daemon 写入点

### ClaimService

`slei agent status` 继续写活动日志，但事件升级为：

- `event_kind = status.updated`
- `summary` 基于 `state / phase / reason` 生成。
- `severity` 根据 state 推断：`blocked` 或异常状态可为 `warning`，普通 working/idle 为 `info`。

idempotency 语义保持不变：同一 status idempotency key 只写一条日志。

### ChannelOrchestratorService

频道 Agent run 需要记录：

- 创建 delivery/run 后写 `run.started`。
- 构建触发 prompt 时写 `input.received`，记录 channel/message/author/type 和正文摘要。
- 处理 `output_delta` 时写 `output.delta`，payload preview 为输出片段截断内容。
- 处理 `tool_started` / `product_tool_requested` 时写 `tool.started`。
- 处理 `tool_completed` 时写 `tool.completed`，包含 `ok`。
- 处理 `completed` 时写 `run.completed`。
- 处理 `failed` 或 worker 启动失败时写 `run.failed`，`severity=error`。

这些日志只用于诊断，不改变 delivery state 的现有完成/失败逻辑。

### AgentDmService

DM run 使用同样事件模型，至少记录：

- `run.started`
- `input.received`
- `output.delta`
- `tool.started`
- `tool.completed`
- `run.completed`
- `run.failed`

DM 日志填充 `run_id`，不强求 `channel_id/message_id`。如有 conversation/message 上下文字段，实现可放入 payload preview。

### Worker 事件层

`WorkerEvent` 已有 `output_delta`、`tool_started`、`tool_completed`、`product_tool_requested`、`completed`、`failed`。实现时不需要让 worker 直接写 SQLite，只需要 daemon service 在消费这些事件时记录活动。

## UI 设计

成员详情页新增第四个 tab：

- 中文：`活动日志`
- 英文：`Activity`

位置：`Profile / Workspace / Capabilities / Activity`。

打开 activity tab 时加载当前 Agent 最近 200 条。切换 Agent 时重新加载。请求失败显示错误状态；没有日志显示空状态；daemon 离线时不使用 mock 数据。

列表展示：

- 最新日志在上。
- 每条显示时间、summary、severity badge、event kind badge。
- 如果有 `runId/messageId/taskId/toolName`，用小号上下文标签展示。
- 如果有 `payloadPreview`，显示展开按钮；展开后用等宽文本展示 payload。
- payload 展开只展示 daemon 返回的截断脱敏文本，UI 不做二次业务裁剪。

交互要求：

- 展开/收起不能改变列表布局稳定性。
- 长 payload 自动换行或横向滚动，不溢出容器。
- 空状态、错误状态、loading 状态都有明确 DOM 节点，方便测试。

## Tauri Broker

新增 broker 能力：

- Rust command：`list_agent_activity_command(agent_id, limit?)`
- DaemonBroker 方法请求：`GET /v1/agents/{agent_id}/activity?limit=200`
- TypeScript bridge：`listAgentActivity(agentId, limit?)`

要求：

- 请求必须使用 daemon token。
- 返回给 webview 的结构不包含 token、endpoint 或内部路径。
- 离线 bridge 返回空日志或 rejected promise 的策略应与现有成员 workspace/daemon 数据读取保持一致；UI 必须显示空/错误状态，不造假日志。

## 测试计划

### Storage

- migration 后旧 status 日志可读。
- 新 activity event 字段可写可读。
- 每个 Agent 只保留最近 200 条。
- API limit 超过 200 时被 clamp。
- payload preview 超长会截断。
- token/secret/password 等字段会脱敏。

### Daemon API

- `POST /v1/agents/{id}/status` 写入 `status.updated`，并保持 idempotency。
- `GET /v1/agents/{id}/activity?limit=200` 返回新 DTO 和旧字段。
- 未授权请求返回 401。
- channel worker 事件可产生 `run.started/input.received/tool.started/tool.completed/run.failed` 等日志。
- DM worker 事件可产生同类日志。

### Tauri

- `list_agent_activity_command` 请求正确路径并携带 Authorization。
- command 返回结构不泄漏 token、endpoint。
- daemon 错误会传递为前端可处理错误。

### React

- 成员详情页渲染 Activity tab。
- Activity tab 显示 loading/empty/error 状态。
- 有日志时展示最近活动、时间、summary、badge。
- 有 payload preview 时可展开/收起。
- 切换成员会重新加载对应成员日志。
- DOM 节点和关键交互有测试覆盖。

## 文档同步

实现时需要同步更新：

- `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`

更新点：

- Agent 活动日志从最近 100 条调整为最近 200 条。
- 活动日志不只来自 `slei agent status`，也包括 daemon 记录的 run/input/output/tool/completion/failure 事件。
- 活动日志仍不参与路由、claim 或业务决策。

## 风险与缓解

- 日志量过大：每个 Agent 限制 200 条，并截断 payload。
- 敏感信息泄露：daemon 层统一脱敏，不把完整 prompt/token 写入日志。
- UI 误导用户：只显示 daemon 返回的数据，离线或失败时显示明确状态。
- 事件重复：status 使用现有 idempotency；worker 事件可接受按事件到达记录，后续如需去重再增加 event key。
- 兼容旧测试：旧 status 字段保留，新字段提供默认值。
