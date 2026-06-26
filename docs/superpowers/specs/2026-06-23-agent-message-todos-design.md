# Agent 消息待办设计

## 背景

当前频道消息流转中，人类消息会广播给频道内所有 Agent，Agent 消息会按显式 mention 投递给目标 Agent。每个 Agent 被唤醒后根据自身角色、消息内容和 system prompt 自主判断是否通过 `slei-cli message claim` 认领。由于 `message claim` 是按消息独占的原子锁，第一个成功认领的 Agent 会占有这条消息；其他同样判断自己应参与的 Agent 在 claim 失败后只能静默退出。

这会让群体互动场景不完整。例如用户发送“大家好，报数”时，所有 Agent 都可能判断自己应该参与，但只有第一个成功 claim 的 Agent 会回复。后续 Agent 的参与意图没有持久化，且第一个 Agent 的普通回复通常没有显式 mention，daemon 不会继续唤醒其他 Agent。

本设计新增 daemon 管理的 Agent 消息待办，让“已收到 delivery 且真实尝试 claim 但失败”的 Agent 后续可以被串行唤醒，并在 prompt 中拿到自己的待办上下文。设计必须保持 daemon/SQLite 为 source of truth，不把路由、待办或状态规则放入 UI、本地 mock 或 Agent workspace。

## 目标

- 当 Agent 对频道消息的 claim 失败，且该 Agent 确实有这条消息的 delivery 时，daemon 为它记录一条消息待办。
- 顶层频道消息有显式 mention 时，mention 唤醒优先，同时把被唤醒 Agent 在当前频道的 pending 待办作为补充上下文注入 prompt。
- 无显式 mention 时，如果当前频道存在 pending 待办，daemon 每次只串行唤醒一个 Agent 处理自己的待办。
- 待办生命周期由 daemon 自动推进：`pending -> running -> done`，启动失败或 run failed 时恢复 `pending`。
- CLI/API 提供人类和开发调试用的待办增删改查，但 Agent prompt 不暴露 todo update/delete/clear/reopen 权限。
- `slei-cli message read` 支持按两个 message id 查询包含端点的频道消息区间，供 Agent 需要时读取待办消息到当前触发消息之间的上下文。

## 非目标

- 不恢复 coordinator runtime、coordinator JSON 或隐藏中心化路由。
- 不让 UI 决定哪个 Agent 应被唤醒或哪个待办应完成。
- 不把 Agent stdout 自动转换成频道消息；可见回复仍必须通过 `slei-cli message send`。
- 不要求 Agent 重新 claim 原始待办消息。原始消息的独占 claim 已经属于第一个成功 claim 的 Agent。
- 不在 Agent prompt 中暴露待办管理命令；待办完成、恢复和删除由 daemon 自动路径或人工 CLI 管理。

## 数据模型

新增 SQLite 表 `agent_message_todos`：

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定 todo id |
| `agent_id` | 待办所属 Agent |
| `channel_id` | 原始消息所在频道 |
| `message_id` | 原始频道消息 |
| `message_author_id` | 原始消息发言人 |
| `message_created_at` | 原始消息创建时间 |
| `claim_owner_agent_id` | 已成功 claim 原始消息的 Agent |
| `status` | `pending`、`running`、`done`、`deleted` |
| `run_id` | 当前处理该待办的 run id，仅 `running` 时存在；进入 `done`、`pending` 或 `deleted` 时清空 |
| `created_at` | 待办创建时间 |
| `updated_at` | 最近更新时间 |
| `last_prompted_at` | 最近注入 prompt 的时间 |
| `completed_at` | 完成时间 |
| `note` | 可选人工说明 |

约束和索引：

- `UNIQUE(agent_id, message_id)`，避免同一 Agent 对同一消息重复创建待办。
- `message_id` 外键指向频道消息。
- 查询索引：`(agent_id, channel_id, status, created_at)`。
- 调度索引：`(channel_id, status, created_at)`。

`message_deliveries` 继续表达“这条消息曾经投递给某 Agent 以及 runtime 投递状态”。`agent_message_todos` 单独表达“这个 Agent 仍有未处理的补充参与上下文”。两者不互相替代。

## 待办创建规则

待办只在 `slei-cli message claim` 对应的 daemon claim API 中自动创建，且必须同时满足：

1. claim 失败，且失败原因是该消息已被其他 Agent 成功 claim。
2. 失败的 Agent 对该 message 存在 delivery。
3. 原始消息是频道消息，且不是 `task_card`、`tombstone` 或旧任务控制消息。
4. 原始消息未删除。

满足条件时，daemon 调用内部 service 方法 `create_pending_from_failed_claim(...)`，幂等 upsert 一条 `pending` todo。若 `(agent_id, message_id)` 已存在：

- `pending` 或 `running`：保持现状，不重复创建。
- `done` 或 `deleted`：不自动重开，只有人工 CLI 操作可以恢复。

如果 claim 失败但没有 delivery，或者消息不是可处理的频道消息，daemon 不创建 todo，只保持原有 claim response 语义。

## 调度规则

### Mention 优先

当顶层频道消息中有显式 `@handle` 时，daemon 继续优先唤醒被 mention 的 Agent。启动 run 前，daemon 查询每个被 mention Agent 在当前频道的 `pending` 待办，将待办作为该 Agent 自己的补充信息注入 prompt，并把这批待办标记为 `running`、绑定本次 `run_id`。

被 mention 的 Agent 会同时看到：

- 当前触发消息，即最新 mention 消息。
- 当前频道 pending 待办列表。

多 mention 场景中，每个被 mention Agent 只会收到属于自己的 pending 待办，不会看到其他 Agent 的待办。

### 无 mention 串行推进

v1 的待办串行推进只由顶层频道消息触发，不由任务回复或普通消息线程回复触发。任务回复和普通消息线程回复仍只按现有显式 mention handoff 规则唤醒 Agent，避免把待办调度扩散到任务线程和子线程。

当顶层频道消息落库且没有可解析 mention 时，daemon 先执行该消息原本的路由规则，再决定是否需要额外推进待办：

- 如果消息作者是 human：保持现有 human broadcast 语义，为频道内 Agent 创建 delivery 并启动对应 run；这些 broadcast run 启动前会注入各自当前频道的 pending 待办。daemon 不再为同一 human 消息额外启动 todo-only run，避免和 broadcast delivery 重叠。
- 如果消息作者是 Agent：现有规则下无 mention 的 Agent 消息不会创建新的普通 delivery；此时 daemon 查询当前频道 pending 待办，并额外串行唤醒一个 Agent 处理待办。
- `task_card`、`tombstone` 和旧任务控制消息不触发待办推进。

当需要额外串行推进待办时，daemon 每次只选择一个 Agent 唤醒。选择规则：

1. 按待办 `created_at` 从早到晚。
2. 若时间相同，按稳定 sequence 或 todo id 排序。
3. 如果目标 Agent 已有当前频道运行中的 channel run，则跳过或延后，避免重复并发。

该 run 的触发消息是刚刚完成的无 mention Agent 频道消息；prompt 同时包含目标 Agent 在当前频道的 pending 待办列表。这样群体互动会形成可控串行流：第一个 Agent 回复后，daemon 再唤醒下一个有待办的 Agent。

### 待办注入范围

每次 run 最多注入 5 条当前频道 pending 待办，按 `created_at` 升序选择。`mark_running_for_prompt(agent_id, channel_id, run_id, limit)` 的默认 limit 为 5。若某 Agent 待办超过 5 条，本次只处理最早的 5 条；后续无 mention 发言可继续推进剩余待办。

## Prompt 合同

Agent run packet 增加 `## Pending Message Todos` 区块，仅在本次 run 注入了待办时出现。每条待办包含：

- todo id
- channel id
- message id
- author id
- created at
- claim owner agent id
- 原消息正文

Agent prompt 中只加入以下规则：

- 当 `Pending Message Todos` 存在时，即使当前触发消息按普通 claim 规则不可 claim 或应该静默，也要先处理这些待办。不要为了处理待办而 claim 当前触发消息。
- 待办是补充参与上下文，不要重新 `claim` 原始消息。
- 若待办信息足够，可以直接通过 `slei-cli message send` 回复。
- 若需要判断上下文，可斟酌读取从待办消息到当前触发消息之间的频道内容，例如：

```sh
slei-cli message read --channel "#all" --from-message msg_A --to-message msg_B
```

Agent prompt 不包含 `slei-cli todo update/delete/clear/reopen` 等管理命令。待办是否完成由 daemon 按 run 生命周期自动更新。

## 生命周期

待办状态由 daemon 自动推进：

- 创建：claim 失败且符合创建条件时，状态为 `pending`。
- 注入 prompt 前：daemon 将本次注入的 todo 标为 `running`，写入 `run_id` 和 `last_prompted_at`。
- worker 启动失败：恢复为 `pending`，清空 `run_id`。
- run completed：将本次 `run_id` 绑定的 todos 标为 `done`，写入 `completed_at`，清空 `run_id`。
- run failed 或 cancelled：恢复为 `pending`，清空 `run_id`。
- 人工删除：CLI/API 使用软删，将 todo 标为 `deleted`，清空 `run_id`。不做物理删除。

daemon 不尝试解析自然语言判断 Agent 是否逐条处理了所有待办。只要本次 run 正常完成，本次注入 prompt 的待办都视为完成。

## CLI 与 API

新增 CLI 命令组 `todo`，用于人类和开发调试：

```sh
slei-cli todo list --agent agent_coda --channel "#all" --status pending
slei-cli todo show todo_123
slei-cli todo create --agent agent_coda --channel "#all" --message msg_123 --note "manual recovery"
slei-cli todo update todo_123 --status done --note "manually resolved"
slei-cli todo delete todo_123
slei-cli todo clear --agent agent_coda --channel "#all" --status pending
```

删除语义固定为软删：

- `todo delete` 将指定 todo 标为 `deleted`。
- `todo clear` 将匹配条件的 todo 批量标为 `deleted`。
- `todo list` 默认不返回 `deleted`，除非显式 `--status deleted`。
- `todo show` 可以按 id 查看 `deleted` todo。
- 自动 failed-claim 路径不会重开 `done` 或 `deleted` todo；只有人工 `todo update` 才能把它改回 `pending`。

对应 daemon API：

- `GET /v1/agent-message-todos?agentId=&channelId=&status=`
- `GET /v1/agent-message-todos/{todoId}`
- `POST /v1/agent-message-todos`
- `PATCH /v1/agent-message-todos/{todoId}`
- `DELETE /v1/agent-message-todos/{todoId}`
- `POST /v1/agent-message-todos/clear`

自动路径使用 service 内部方法，不依赖 CLI：

- `create_pending_from_failed_claim(...)`
- `mark_running_for_prompt(agent_id, channel_id, run_id, limit)`
- `mark_done_for_run(run_id)`
- `restore_pending_for_run(run_id)`

CLI 写命令必须使用 idempotency key；CLI 未显式传入时沿用现有模式自动生成。

## Reset

`agent_message_todos` 是生产可变业务状态，必须纳入 dev reset 清理范围。开发 reset 应清空该表中的所有记录，包括 `pending`、`running`、`done` 和 `deleted`。reset 期间若存在 in-flight run，沿用现有 reset guard，确保 reset 后旧 run 事件不会恢复或完成已清空的 todo。

## 消息区间查询

`slei-cli message read` 新增按 message id 的包含端点区间查询：

```sh
slei-cli message read --channel "#all" --from-message msg_A --to-message msg_B
```

API 增加 query 参数：

```text
GET /v1/messages/read?channel=all&fromMessage=msg_A&toMessage=msg_B
```

语义：

- 返回与 `msg_A` 和 `msg_B` 位于同一频道的消息区间。
- 包含两端：`msg_A <= sequence <= msg_B`。
- 如果 A/B 顺序反了，daemon 自动按 sequence 排序后返回。
- 如果任一 message 不存在、已删除或不属于指定频道，返回 400。
- 结果继续过滤旧任务控制消息等不应暴露给 Agent 的消息类型。
- `fromMessage/toMessage` 与 `around` 互斥；与 `after/before` 互斥。

## 错误处理

- claim 失败但没有 delivery：不创建 todo。
- claim 失败但消息不是可处理的频道消息：不创建 todo。
- 重复 claim 失败：todo 创建幂等。
- 已 `done/deleted` 的 todo 不自动重开。
- mention 唤醒时若 todo 注入成功但 worker 启动失败：todo 恢复 `pending`。
- run completed 后：本次注入 prompt 的 todo 全部标记 `done`。
- run failed 或 cancelled 后：本次注入 prompt 的 todo 恢复 `pending`。
- 无 mention 待办调度一次只唤醒一个 Agent。
- CLI/API 写操作未授权或缺少 idempotency key 时返回现有风格错误。

## ADR 更新

实现该设计时需要同步更新 `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`：

- 说明 Channel Group Address 不再仅依赖“下一条可见消息触发 + Agent 自行重读历史”，而是由 failed claim 形成 daemon/SQLite 待办。
- 明确待办不是隐藏 coordinator 决策，也不是 UI 路由。它只来自已有 delivery 和真实 failed claim。
- 明确 agent-authored 无 mention 消息不会重新走 claim 广播，但可以作为推进同频道 pending todo 的串行触发点。
- 补充 prompt 中的 pending todo 区块和 message id 区间读取命令。

## 测试计划

必须增加或更新以下测试：

- storage migration/repository：todo CRUD、唯一约束、状态转换、按 agent/channel/status 查询排序。
- claim API：只有“有 delivery + 可处理频道消息 + claim 失败”会创建 pending todo。
- claim API：没有 delivery、`task_card`、`tombstone`、旧任务控制消息或 deleted 消息不创建 todo。
- orchestrator：mention 优先，并把当前频道 pending todos 注入 prompt。
- orchestrator：human 无 mention 消息仍走 broadcast；broadcast run 可以注入已有 pending todos，但 daemon 不为同一 human 消息额外启动 todo-only run。
- orchestrator：无 mention 时只调度一个 pending todo Agent。
- lifecycle：启动失败恢复 pending；worker failed 恢复 pending；worker completed 标 done。
- reset：dev reset 清空 `agent_message_todos`，旧 run 事件不会恢复已清空待办。
- prompt：包含 `Pending Message Todos` 和 `from-message/to-message` 查询建议。
- prompt：不包含 todo update/delete/clear/reopen 指令。
- prompt/orchestrator：无 mention Agent 频道消息触发 pending todo run 时，Agent 可基于待办上下文行动，不需要对当前触发消息存在 delivery 或 claim 当前触发消息。
- CLI：`todo list/show/create/update/delete/clear` 的请求路径和 JSON。
- CLI：`message read --from-message --to-message` 参数。
- API：`/v1/messages/read?fromMessage=&toMessage=` 包含两端。
- API：反向顺序也返回正确区间。

建议实现后运行：

```sh
cargo fmt --check
cargo test -p slei-storage
cargo test -p slei-daemon --test broadcast_claim_api
cargo test -p slei-daemon --test channel_orchestration_flow
cargo test -p slei-cli
pnpm test:guardrails
```
