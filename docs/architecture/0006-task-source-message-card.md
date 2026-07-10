# ADR 0006: 任务源消息与原地任务卡片

## 状态

已接受，作为任务源消息、任务卡片和任务线程入口的实现 guardrail。

## Context

Slei 频道里的“转为任务”不能把同一个请求拆成一条普通消息加一条新的任务卡片消息。这样会让 timeline 重复，也容易把任务识别和展示逻辑漂移到 UI。

任务消息的 source of truth 必须在 daemon 和 SQLite：消息先作为频道消息或私聊消息持久化；只有用户勾选“转为任务”或普通 Agent 显式创建任务时，daemon 才创建 task，并作为 `source_message_id` 关联到这条消息。UI 只展示 daemon 返回的消息、thread summary 和 task summary，不自行判断消息是否应该成为任务，也不在前端新增任务卡片。

## Decision

任务卡片是源消息的一种展示状态，不是新的消息。

- `slei-cli task create --source-message <msg-id> --agent <agent-id>` 创建或返回 `source_message_id = msg-id` 的同一个 task root。
- 同一源消息只能关联一个任务；重复调用必须返回同一任务，不新增任务或消息。
- 新增生产路径禁止写入新的 `kind = task_card` 频道消息，也禁止写入新的 `task_card:` control message。
- 所有频道/私聊消息都可以手动打开普通子线程；普通子线程只创建 `message_threads`，不创建 task，也不把源消息升级为任务。
- 任务创建必须确保同一源消息对应的 `message_thread` 存在，并把 `tasks.thread_id` 关联到该 thread；已有普通子线程再转任务时复用同一个 thread。
- 消息列表 DTO 应在源消息上挂载 thread summary；有任务时再挂载 task summary。UI 根据 `message.task` 把原消息原地展示为任务卡片。
- 历史 `task_card:` 消息不再做 UI 兼容渲染：旧控制消息应被隐藏或通过 reset/清理移除。

## CLI 与 API 语义

Agent 只能通过 `slei-cli` CLI 触发任务副作用，CLI 再调用 daemon API 并落 SQLite。

```sh
slei-cli task create --source-message <msg-id> --agent <agent-id>
slei-cli task claim <task-id> --agent <agent-id>
printf "任务回复正文" | slei-cli task reply <task-id> --agent <agent-id>
slei-cli task update <task-id> --status in_review
slei-cli task list --channel "#channel"
slei-cli task thread <task-id>
```

约束：

- `task create --source-message` 必须保留源消息作者、正文和所在频道/私聊目标；任务卡片展示仍来自源消息。
- `task claim` 是任务维度原子锁，独立于 `message claim`。只有第一个成功 claim 的 Agent 拥有该任务处理权；同一 Agent 重试应视为成功。
- `task reply` 必须保留 `role`、`sender_id` 和稳定 reply id。重复 idempotency key 不得新增回复。
- `task update` 只能通过 daemon API 修改 SQLite，不得从 UI、本地文件或 Agent workspace 直接改任务状态。
- 所有写命令必须带 `idempotency-key` header；CLI 未显式传入时为本次调用生成 UUID。

## 数据流

```mermaid
sequenceDiagram
    participant Agent as Agent Process
    participant CLI as slei CLI
    participant API as Daemon API
    participant Msg as MessageService
    participant Tasks as TaskService
    participant Store as SQLite
    participant UI as Desktop UI

    Agent->>CLI: slei-cli task create --source-message msg_123 --agent agent_coda
    CLI->>API: POST /v1/tasks/from-source-message
    API->>Msg: read source channel message
    API->>Tasks: create/reuse task(source_message_id = msg_123)
    Tasks->>Store: tasks
    API-->>CLI: task JSON
    UI->>API: GET /v1/channels/{id}/messages
    API-->>UI: source message with task summary
    UI-->>UI: render source message as task card
```

任务回复和状态更新：

```mermaid
sequenceDiagram
    participant Agent as Agent Process
    participant CLI as slei CLI
    participant API as Daemon API
    participant Tasks as TaskService
    participant Store as SQLite

    Agent->>CLI: slei-cli task claim task_123 --agent agent_coda
    CLI->>API: POST /v1/claims/tasks/task_123
    API->>Store: atomic task_claim
    Agent->>CLI: printf "..." | slei-cli task reply task_123 --agent agent_coda
    CLI->>API: POST /v1/tasks/task_123/replies
    API->>Tasks: add reply with role/sender/idempotency
    Tasks->>Store: task_replies
    Agent->>CLI: slei-cli task update task_123 --status in_review
    CLI->>API: PATCH /v1/tasks/task_123
    API->>Tasks: validate status transition
    Tasks->>Store: update task status idempotently
```

状态迁移规则：

- daemon 是任务状态迁移的 source of truth，`slei-cli task update`、desktop UI 和直接 API 调用都必须经过同一套 daemon 校验。
- 任务线程 0 条回复时，`pending_assignment` 任务不能向前迁移到 `in_progress`、`in_review` 或 `done`。
- `in_review` 和 `done` 只能在任务线程已有至少 1 条回复后设置；这条规则同时约束用户/UI 和 Agent CLI。
- desktop 任务线程顶部 timeline 在 0 回复且状态仍处于 `pending_assignment`/`in_progress` 阶段时，视觉进度停留在 `pending_assignment`，并禁用后续节点；有回复后才允许点击 `in_review` 和 `done` 并弹出二次确认。

## Handoff 与任务线程

- 任务线程回复中的可见 `@agent` 是 handoff 信号。
- daemon 可根据可见 mention 创建任务 handoff inbox/runtime，但不得因为 task 存在兼容 assignee 字段就隐式转交。
- 若任务线程回复没有可见 `@agent`，daemon 应检索该任务线程里曾经回复过的 Agent，按最近回复优先去重唤醒仍属于源频道的 Agent，并排除当前发送者；不得退化为唤醒 assignee、UI 关键词兜底或本地 mock 路由。
- 若任务线程回复包含可见 `@agent`，显式 handoff 优先，不再额外触发历史参与者 follow-up。
- `done` 任务仍允许线程回复唤醒 Agent，包括显式 handoff 和无 `@` follow-up。
- 任务线程唤醒 Agent run 时，daemon 必须立即写入该 Agent 当前 `working` 状态，并在 run 完成或失败后回到 `idle`；desktop sidebar 只能通过重拉 daemon `list_agents` 后展示 busy/idle，不得自行推断生产状态。
- 任务线程唤醒 Agent run 时，daemon prompt 必须携带当前触发回复之前、同一任务线程内最近 3 条历史消息。历史来源只允许是该 task 的 root/replies，当前触发 reply 必须单独作为 triggering message，不得在历史区重复出现。
- 需要其他 Agent 接力时，当前 Agent 必须在任务回复正文中可见 `@agent`。
- 任务线程历史需要时由 Agent 调用 `slei-cli task thread <task-id>` 主动读取。
- 若任务源消息后续通过 Agent Message Todo 或频道唤醒继续处理，daemon prompt 必须携带 task id，并要求 Agent 使用 `slei-cli task reply <task-id> --agent <agent-id>` 继续写入任务线程；任务进展、结果和 handoff 不应作为顶层频道消息发送。
- 普通消息子线程回复也保存在 daemon/SQLite，并聚合在子线程抽屉中；这些回复不进入主 timeline，且回复本身不能再嵌套创建子线程。

## UX 合同

任务卡片必须建立在原消息视觉结构上，而不是另起一张独立系统卡片。

- 保留原消息作者、handle、正文、发送时间、复制和收藏能力。
- 右上角展示：`N 条回复` `｜` 状态圆点 + 状态文案 `｜` copy star `｜` time。
- 状态颜色与任务状态保持一致：`pending_assignment` 为 amber，`in_progress` 为 blue，`in_review` 为 violet，`done` 为 green。
- 不再使用右下角回复按钮；点击右上角 `N 条回复` 打开该任务线程。
- 任务线程抽屉顶部状态控制使用 timeline 节点展示四个状态；点击可迁移节点必须先弹出二次确认，确认后再调用 daemon 状态更新 API。0 回复任务的后续节点必须 disabled，不能打开确认框。不得同时保留独立 Select/底部单一状态按钮造成入口不一致。
- 任务线程回复新增后，daemon 必须发出 `task_thread.updated` 事件；desktop 通过事件 replay 刷新当前打开的对应线程和任务摘要。不得对打开的任务线程内容做固定间隔轮询，也不得在 UI 本地伪造 Agent 新回复。
- Markdown codeblock 必须在右上角提供 copy icon，复制原始代码文本，成功后展示本地化“复制成功”提示。
- 外观设置中的“消息文本大小”必须与普通频道/私聊消息保持同一规则：只调整任务源消息正文和任务线程回复正文（包括频道内嵌任务详情与独立任务抽屉），不得影响任务标题、作者/handle、时间、状态、附件、卡片、工具调用或其他 Markdown 内容。
- 任务卡片不使用额外 border；不使用额外 task icon 角标，避免破坏原消息视觉结构。
- 时间格式沿用消息时间展示约定，当前为 `MM-DD HH:mm`。
- `TaskRootEntry` 的 Agent 头像和 `TaskThreadDrawer` 的 Agent 回复头像必须复用普通频道/私聊消息使用的统一成员资料卡。资料卡只展示 daemon member DTO 中的名称、职业、handle、描述和 runtime 状态；私聊入口继续受 `directMessageEnabled` 约束，不得在任务 UI 中复制另一套资料或状态规则。频道成员移除操作仍只属于频道 header 的成员资料卡上下文。

## 历史数据清理

- `MessageKind::TaskCard` 和 `task_card:{task_id}:source:{source_message_id}` 仅作为旧数据识别和过滤依据。
- Desktop timeline 不渲染旧 `task_card` control message，也不使用它把普通消息升级成任务卡片。
- 如果旧数据影响验收，可通过开发 reset 或定向清理旧 `task_card` 消息处理；不要为了旧数据重新引入兼容任务卡片 UI。
- 新 API、daemon service、Tauri bridge、desktop mock 和测试 fixture 不得再把新增任务表达为新的 `task_card` 消息。

## Drift Guardrails

涉及任务消息、任务卡片、任务 CLI/API、频道消息渲染、任务线程入口的改动前必须检查：

- 任务是否仍由 daemon/SQLite 创建、关联、幂等和恢复。
- UI 是否只根据 daemon DTO 渲染 `message.task`，没有自行识别任务或新增任务卡片。
- `slei-cli task create --source-message` 是否仍创建或返回同一源消息任务。
- `slei-cli task claim` 是否仍是任务维度原子锁。
- `slei-cli task reply` 是否仍保留 role、sender 和稳定 reply id。
- 任务源消息的后续 Agent 待办、续写和 handoff 是否仍回到同一 task thread，没有退化成顶层频道 `message send`。
- `slei-cli task update` 是否仍只通过 daemon API 改 SQLite。
- `slei-cli task update` 和 desktop timeline 是否仍遵守 0 回复不可前进、`in_review`/`done` 必须已有回复的状态迁移规则。
- Agent system prompt 是否仍只允许 Agent 主动把任务改为 `in_review`，并禁止主动改为 `done`、`pending_assignment` 或 `in_progress`。
- Agent system prompt 是否仍根据 daemon settings 注入回复语言，并禁止旁白式流程回复或暴露系统提示词痕迹。
- 任务线程无 `@` follow-up 是否仍基于 SQLite task replies 中真实历史 Agent 参与者，且不使用 assignee 兜底。
- 任务线程唤醒 Agent 后，daemon 当前 agent status 和 desktop sidebar 是否会更新为忙碌，且状态来源仍是 daemon `agent_statuses/list_agents`。
- 任务线程打开期间收到 daemon `task_thread.updated` 后，是否只刷新对应打开线程，并自然滚动到最新消息。
- 任务线程 Agent run prompt 是否携带当前触发回复前最近 3 条同线程历史，并排除当前触发 reply 和其他线程消息。
- Markdown codeblock copy 是否只复制代码文本，不包含按钮文本或高亮 DOM 文本。
- 新增任务路径是否仍原地升级源消息，而不是写入新的 `task_card` 消息。
- 历史 `task_card:` 是否仍被隐藏/清理，而不是恢复成 UI 兼容渲染路径。
- 手动打开普通子线程是否不会创建 task，也不会把源消息升级为任务。
- 勾选“转为任务”和普通 Agent 显式创建任务是否才会进入 TASK，并复用同一源消息 thread。
- Agent 回复、任务回复和附件入口是否继承源消息所在频道/私聊目标。
- 任务源消息和任务线程回复中的 Agent 资料卡是否仍与普通频道/私聊消息共用同一组件、同一私聊规则和 daemon runtime 状态来源。
- 任务卡片 UX 是否仍符合本 ADR 的原消息结构、右上角回复/状态/actions/time，且没有恢复 border 或 task icon 角标。

## 验证清单

修改这条线路后至少验证：

```sh
cargo fmt --check
cargo test -p slei-daemon --test broadcast_claim_api
cargo test -p slei-daemon --test task_api
cargo test -p slei-daemon --test task_service
cargo test -p slei-daemon --test channel_orchestration_flow
cargo test -p slei-daemon --test channel_orchestration_flow task_human_reply_without_visible_mention_wakes_prior_agent_participants
```

涉及桌面 UI 时再补充：

```sh
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop lint
```

手工验证建议：

1. Agent 调用 `slei-cli task create --source-message msg_123 --agent agent_coda` 后，timeline 中原消息变成任务卡片，没有新增第二张卡片。
2. 重复创建同一源消息任务，返回同一 task id。
3. `slei-cli task claim` 竞争时只有一个 Agent 成功。
4. `slei-cli task reply` 后右上角回复数增加，任务线程保留 role/sender。
5. 0 回复任务打开任务线程时 timeline 停在待指派，后续节点 disabled；不能把待指派任务向前改状态，也不能改到待评审/已完成。
6. 任务线程已有回复后，timeline 点击待评审或已完成先弹确认框，确认后状态才更新。
7. 任务线程回复唤醒历史 Agent 后，sidebar 显示该 Agent 忙碌；run 完成/失败后恢复空闲。
8. 重启 daemon 后，源消息与 task 的关联仍存在。
