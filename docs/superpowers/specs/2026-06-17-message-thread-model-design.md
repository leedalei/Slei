# Slei 统一消息子线程模型设计

## 背景

当前频道和私聊同时存在“新会话 / 历史会话”与“任务线程”两套会话概念，用户理解成本高，代码也容易把消息分流、任务展示和 session 过滤逻辑散落到 UI 层。新的产品方向是：频道和私聊只有一条连续主消息流；任意主消息都可以开启一个子线程；任务只是带任务属性的消息子线程。

本设计遵守 Slei 架构约束：业务逻辑、状态变更、路由决策、持久化、幂等、数据恢复都在 daemon 中处理。UI 只渲染 daemon DTO、触发 daemon command/API，并展示 loading/error/empty 状态。

## 目标

- 移除频道和私聊中的“新会话”“历史会话”产品功能。
- 建立统一 `message_threads` / `thread_replies` 模型，让任意主消息都能开启一级子线程。
- 保留任务能力，但把任务建模为 message thread 的增强属性，而不是另一套独立线程。
- 普通子线程和任务子线程里的回复都能像普通消息一样触发 daemon 路由、claim 和 agent run。
- 主 timeline 初始加载最近 50 条消息，向上滚动每次加载更早 30 条。
- 使用 TanStack Virtual 支持大量消息、动态高度和滚动到指定消息。

## 非目标

- 不支持嵌套子线程。thread 内回复不显示 msg icon，也不能再开二级 thread。
- 第一版不要求 thread drawer 内回复虚拟化；如果后续回复量很大，再复用主 timeline 虚拟列表方案。
- 不用 UI 本地状态模拟任务、thread、回复数或路由行为。

## 产品概念

### 主消息流

频道和私聊各自只有一条连续主 timeline。主 timeline 展示 daemon 返回的主消息，不再按 session 切分，也不展示 thread 内回复。

### 普通消息子线程

任意主消息右上角显示 msg icon。点击后 daemon 创建或返回该消息的 thread，并打开 drawer。普通子线程：

- 不进入 TASK。
- 没有任务状态、分配和任务管理字段。
- 回复聚合在 drawer 中，不回流主 timeline。
- 回复仍由 daemon 持久化、触发路由和唤醒 agent。

### 任务

只有以下路径会创建任务，并进入 TASK：

- 用户发送主消息时勾选“转为任务”。
- agent 通过 daemon/CLI 自动从源消息创建任务。

任务是 message thread 的增强属性。任务与普通子线程共用 thread/reply 模型，但额外拥有状态、分配、attention、TASK 列表入口等任务属性。

## Daemon 数据模型

### messages

继续作为频道和私聊主消息流的 source of truth。实现时可以保留旧 `session_id` 字段用于兼容或迁移，但新读写路径不再依赖 session 分割主消息。

### message_threads

一条主消息最多一个 thread。

建议字段：

- `id`
- `source_message_id`
- `source_kind`: `channel` 或 `dm`
- `source_id`: channel id 或 conversation id
- `created_by`
- `reply_count`
- `created_at`
- `updated_at`

约束：

- `source_message_id` 唯一。
- 创建 thread 必须幂等；重复点击 msg icon 返回同一个 thread。
- 只能基于主消息创建 thread，不能基于 `thread_replies` 创建嵌套 thread。

### thread_replies

thread 内回复。

建议字段：

- `id`
- `thread_id`
- `sender_id`
- `role`: `human`、`agent`、`system`
- `body`
- `status`
- `run_id`
- `created_at`

约束：

- 写入回复必须通过 daemon API/CLI。
- 回复写入后更新 `message_threads.reply_count` 和 `updated_at`。
- 回复不插入主 timeline。
- 回复应触发与普通消息一致的 agent 路由、claim 和 run 机制，只是 target 是 thread。

### tasks

保留任务属性，但关联到同一个 thread/source message。

建议字段变化：

- 保留 `source_message_id`。
- 增加或使用 `thread_id` 关联 `message_threads`。
- 保留 `status`、`creator_id`、`assignee_id`、`attention_required`、`updated_at`。

约束：

- 同一源消息最多一个 task。
- 创建 task 时先 ensure message thread，再 create/reuse task。
- 普通 msg icon 创建 thread 不创建 task。

## API 与行为

### 主消息列表

频道和私聊主消息列表都使用同类分页语义：

- 初始：最近 50 条。
- `before=<cursor>`：返回 cursor 之前更早 30 条。
- `aroundMessageId=<messageId>`：返回目标消息附近窗口，用于搜索、收藏、外部跳转。

返回 DTO 应包含：

- `messages`
- `pageInfo`: `hasMoreBefore`、`oldestCursor`、`newestCursor`

每条主消息 DTO 应包含：

- `threadSummary`：可选，包含 `threadId`、`replyCount`、`updatedAt`
- `taskSummary`：可选，包含 `taskId`、`status`、`assigneeId`、`attentionRequired`

### 创建或打开普通 thread

`POST /v1/message-threads/from-source-message`

输入：

- `sourceMessageId`
- `createdBy`

行为：

- 校验源消息是主消息。
- 如果 thread 已存在，返回现有 thread。
- 如果不存在，创建 thread。
- 不创建 task，不进入 TASK。

### 创建任务

现有 “from source message” 语义保留，但内部调整为：

1. 校验源消息。
2. ensure message thread。
3. create/reuse task。
4. 返回 task summary + thread summary。

发送主消息时勾选“转为任务”也走同一套 daemon 逻辑。

### thread 回复

`POST /v1/message-threads/{threadId}/replies`

行为：

- 写入 `thread_replies`。
- 更新 thread summary。
- 基于 thread target 触发 daemon 路由、claim 和 agent run。
- 返回 reply、thread summary，以及可能的 route/run 信息。

## UI 设计

### 移除 session UI

- 移除频道 header 中的“新会话”“历史对话”按钮。
- 移除私聊 header 中的“新会话”“历史对话”按钮。
- 移除历史会话 drawer。
- 移除前端按 `sessionId` 过滤主 timeline 的逻辑。
- 私聊标题不再依赖 session title；使用成员名。

### 主消息行

所有主消息右上角统一动作区：

- msg icon / 回复数：打开或创建 thread。
- copy。
- star。
- time。
- status square。

如果该消息有关联 task，则同一动作区额外展示任务状态。任务源消息视觉与普通消息保持一致，不再加 border。消息和任务的差异只体现在是否有 task summary，以及是否进入 TASK。

### 发送框

频道和私聊都显示“转为任务”勾选项。

- 未勾选：只发送普通主消息。
- 勾选：发送主消息并创建/reuse task thread，进入 TASK。

### Thread Drawer

普通 thread 和 task thread 共用 drawer。

- 普通 thread：展示源消息、回复列表、回复输入框。
- task thread：在普通 thread 基础上展示状态、分配、attention 等任务控件。
- thread 内回复不显示 msg icon，不支持嵌套。

## 虚拟列表与滚动

主 timeline 使用 TanStack Virtual。

要求：

- 使用 `message.id` 作为稳定 item key。
- 支持动态高度测量，Markdown、附件、卡片、任务状态变化后能重新测量。
- 初始进入频道/私聊时加载最近 50 条并锚定底部。
- 向上接近顶部时加载更早 30 条，prepend 后保持当前可见消息视觉位置不跳动。
- 新消息追加时，如果用户接近底部则自动跟随；否则不打断阅读，并展示“回到底部”入口。
- 滚动到指定消息：
  - 已加载：通过 `messageId -> index` 调用 virtualizer 滚动到 center。
  - 未加载：调用 daemon `aroundMessageId` 读取目标附近窗口，再滚动并高亮。

## 迁移与兼容

- 旧 channel/conversation session 表和字段可以先保留，但新 UI 不展示、不创建、不激活 session。
- 旧数据中的消息仍按主 timeline 展示；实现时需要决定旧 session 消息是全部合并展示，还是通过一次迁移清理 session 关系。
- 现有 task replies 需要迁移或兼容映射到 `message_threads` / `thread_replies`，保证老任务线程仍可打开。
- 同步更新 `docs/architecture/0006-task-source-message-card.md`，把“任务源消息与原地任务卡片”扩展为“消息子线程与任务增强状态”，避免 ADR 与实现漂移。

## 测试策略

### Daemon

- 创建普通 thread 幂等：同一源消息重复创建返回同一 thread。
- 普通 thread 不创建 task，不进入 task list。
- 发送勾选“转为任务”会创建 thread + task，并进入 task list。
- agent 自动创建任务会复用同一 thread。
- thread reply 写入后更新 reply count。
- thread reply 会触发 daemon 路由/claim/run。
- 主消息列表默认返回最近 50 条。
- `before` 每次返回更早 30 条。
- `aroundMessageId` 返回目标附近窗口。
- thread 内回复不能创建嵌套 thread。

### Desktop UI

- header 不再渲染新会话/历史会话按钮和 drawer。
- 频道和私聊不再按 session 过滤主消息。
- 每条主消息渲染 msg icon 或回复数。
- 点击 msg icon 调用 daemon ensure thread 并打开 drawer。
- thread 内回复不渲染 msg icon。
- 私聊发送框可勾选“转为任务”。
- 任务源消息没有 border，视觉与普通消息一致。
- TanStack Virtual 渲染大量消息时 DOM 节点数量受控。
- 向上滚动触发加载更早消息，且 prepend 后滚动位置稳定。
- 跳转到已加载和未加载消息都能滚动并高亮。

### 文档

- 更新 ADR 0006。
- 如涉及频道路由 target 表达，检查并更新 ADR 0005 中的 CLI/API target 说明。

## 验收标准

- 用户无法在频道或私聊中创建/切换/查看“新会话/历史会话”。
- 频道和私聊展示连续主消息流。
- 任意主消息可创建一级子线程并继续聊天。
- 普通子线程不会进入 TASK。
- 勾选转为任务或 agent 自动转任务才进入 TASK。
- thread 回复不刷主 timeline。
- 大量消息下 timeline 交互流畅，支持向上加载和跳转指定消息。
