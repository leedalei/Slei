# Composer 布局与命令菜单设计

日期：2026-07-02
状态：已确认，待实现计划

## 背景

Slei desktop 当前聊天输入区由独立 textarea、附件入口、图片入口和“转为任务”checkbox 组成。用户希望把输入框与下方操作融为一个整体，参考图二的单体输入面板布局，同时补齐更自然的附件输入和 slash 命令体验。

当前代码已有可复用基础：

- `ChatPageView` 已有受控 textarea、附件上传、附件预览、发送、mention picker 和 DM skill slash picker。
- 附件上传已经通过 `uploadComposerFile()`、`onAttachmentUpload`、`attachmentIds` 进入 daemon/bridge，不需要新增生产持久化路径。
- `TaskThreadDrawer` 已有任务线程回复 textarea、mention picker、Enter 提交和 daemon 任务回复链路。
- shadcn `Switch` 和 `Textarea` primitive 已存在。

本设计只改 desktop UI 的输入收集与展示层。消息发送、附件保存、转任务创建、任务线程回复和状态变更仍由现有 daemon/bridge 链路负责。

## 目标

1. 主聊天 composer 改为统一圆角输入容器，textarea、附件预览和底部工具栏在同一个框内。
2. 主聊天 textarea 内容增多时自动增高，最大高度 500px，超过后 textarea 内部滚动。
3. 任务线程回复 textarea 也自动增高，建议最大高度为 `min(320px, 40vh)`，避免挤压线程内容。
4. 支持通过拖拽文件到主 composer、粘贴剪贴板文件或点击统一文件按钮添加附件。
5. 合并“插入图片”和“插入文件”为一个“插入文件”功能；图片显示缩略图，普通文件显示文件名、大小和文件图标。
6. “转为任务”从 checkbox 改为 switch，发送语义仍是现有 `asTask`。
7. 支持在开头输入 `/`，或正文中输入空格后的 `/`，唤起统一命令菜单。
8. 命令菜单合并固定 composer 命令和现有 DM skill 命令。
9. placeholder 增加功能提示，例如中文“输入消息到 #all，输入 / 打开功能菜单”。
10. 补齐严格单元测试与 DOM 交互测试。

## 非目标

- 不新增 daemon API、SQLite schema 或消息协议字段。
- 不改变任务创建语义；“转为任务”仍只作为发送选项交给现有 daemon 发送链路。
- 不在 UI 本地持久化附件、任务、消息或运行时状态。
- 不引入 production mock、demo、sample 或 fake seed 数据。
- 不实现富文本编辑器，不支持 inline 图片编辑、富文本 mention token 或复杂 contenteditable 选区模型。
- 不重构整个 `ChatPageView`；本次优先在现有边界内完成集中升级。

## 方案选择

采用方案 A：集中升级现有 `ChatPageView` composer。

原因：

- 保留现有发送链路、附件上传链路、mention picker、DM skill 逻辑和测试结构，风险最低。
- UI 只负责输入状态、附件预览、拖拽/粘贴收集和命令菜单，符合 Slei “业务控制面在 daemon” 的架构约束。
- 不把布局优化扩大成组件大拆分或富文本编辑器改造。

`TaskThreadDrawer` 只同步升级回复 textarea 的自适应高度，不参与附件和 slash 命令范围。

## 架构与数据流

### 主聊天发送

```text
用户输入 / 粘贴 / 拖拽 / 选择文件
  -> ChatPageView 本地 draft/asTask/attachments 状态
  -> onAttachmentUpload 上传附件到 daemon
  -> submitComposerDraftWithFeedback
  -> onSendMessage(body, { asTask, attachmentIds, sessionId })
  -> SleiApp/bridge/daemon 现有发送链路
```

要求：

- `ConversationAttachmentView[]` 仍是 composer 附件预览的数据源。
- 发送成功后清空 `draft`、`attachments` 和 `asTask`，沿用现有 helper 返回值。
- 上传失败时通过现有 toast 通道提示，已成功上传的附件保留。
- 空正文但有附件时仍允许发送；空正文且无附件仍禁用发送。

### 任务线程回复

```text
用户输入回复
  -> TaskThreadDrawer replyDraft 本地状态
  -> onReply(taskId, body)
  -> SleiApp/bridge/daemon 现有 task reply 或 message thread reply 链路
```

要求：

- 只升级 textarea 自适应高度，不改变任务线程状态迁移、mention、Enter 提交、错误提示和滚动到最新回复逻辑。

## 输入控件

继续使用 controlled `textarea`，不切换到 `contenteditable`。

决策理由：

- 现有 composer 和任务线程依赖 textarea 的表单提交、`value` 受控状态、IME 组合输入、Enter/Shift+Enter、mention 键盘选择和测试查询。
- 本次不需要富文本能力；`contenteditable` 会额外引入粘贴清洗、换行归一、placeholder、选区恢复、可访问性和输入法兼容成本。

实现建议：

- 新增局部 hook 或 helper，例如 `useAutosizeTextarea(ref, value, { maxHeight })`。
- 每次 `value`、初始 draft、发送清空后同步高度：
  - 先把 `style.height` 设为 `auto`。
  - 根据 `scrollHeight` 与 `maxHeight` 设置实际高度。
  - 超过最大高度时 `overflowY = "auto"`，否则 `overflowY = "hidden"`。
- 主聊天最大高度：500px。
- 任务线程最大高度：`min(320px, 40vh)`，可以通过 CSS `max-h-[min(320px,40vh)]` 或内联计算表达。
- 保留 IME 判断和 `composerShortcutAction` 现有行为。

## 主聊天布局

主 composer 改为单一输入面板：

- 外层仍浮在 timeline 底部，并继续维护 `composerReservePx`，避免遮住消息。
- `.slei-composer-glass` 可保留作为外层玻璃背景，但内部 `slei-composer-surface` 应成为真正的统一输入容器。
- 附件预览位于容器顶部。
- textarea 位于中部，去掉自身视觉边框，使用透明背景和无额外 focus ring。
- 底部工具栏位于同一容器底部。
- 外层容器承担边框、圆角、背景、focus-within 和 drag-over 状态。

工具栏布局：

- 左侧：统一文件按钮、转为任务 switch 和文案。
- 右侧：发送按钮。
- 文件按钮使用图标按钮，并提供 tooltip/aria-label。
- 发送按钮继续使用现有 shadcn primary button 与 `data-testid="slei-send-button"`。

placeholder：

- 中文频道：`输入消息到 #all，输入 / 打开功能菜单`
- 中文私聊：`输入消息给 Coda，输入 / 打开功能菜单`
- 英文频道：`Message #all, type / for actions`
- 英文私聊：`Message Coda, type / for actions`

## 附件交互

统一入口：

- 移除 composer 中分开的“插入图片”和“插入文件”按钮。
- 只保留一个隐藏 file input，不限制 `accept`。
- 点击“插入文件”按钮打开该 input。
- input change、drop 和 paste 都走同一个 `addFiles(FileList | File[])` 管线。

拖拽：

- 在统一 composer 容器上监听 drag enter/over/leave/drop。
- 只有拖拽数据包含文件时才进入 drag-over 状态并阻止默认打开文件行为。
- drop 后调用 `addFiles()`。
- drag-over 状态只做轻量边框/背景反馈，不用覆盖整个页面。

粘贴：

- 在 textarea 或 composer 容器处理 paste。
- 如果 `clipboardData.files` 或 `clipboardData.items` 中有文件，则提取文件并添加附件。
- 对纯文本粘贴不阻止默认行为。
- 图片和普通文件都按文件处理，不在 UI 中写入正文路径或 markdown。

附件预览：

- 图片：展示缩略图、文件名、大小和删除按钮。
- 普通文件：展示文件图标、文件名、大小和删除按钮。
- 预览位于统一输入容器内部顶部，发送成功后清空。

错误处理：

- `uploadComposerFile()` 单个文件失败时显示 toast。
- 多文件上传时，成功项保留，失败项不加入 attachments。
- 不使用 mock 附件替代 daemon 上传失败结果。

## 命令菜单

把现有 DM skill slash picker 扩展为统一 composer 命令菜单。

触发规则：

- 支持开头 `/`，例如 `/`、`/fi`、`/memory`。
- 支持空格后的 `/`，例如 `帮我 /`、`帮我 /task`。
- 不支持普通词中间的 `/`，例如 `path/to` 或 `https://` 不触发。
- 触发 query 从 slash 后到 draft 末尾；当 query 后继续输入空格和正文时，菜单关闭。

菜单内容：

- 固定命令：
  - `插入文件` / `Insert file`
  - `转为任务` / `Convert to task`
- DM 且目标 Agent 有 skills 时，追加现有 skill 项，例如 `/memory`。
- 频道 composer 只展示固定命令。

执行动作：

- 插入文件：删除本次 slash 查询片段，保留前文，然后打开统一 file picker。
- 转为任务：删除本次 slash 查询片段，保留前文，然后把 `asTask` switch 设为开启。
- skill 项：保持现有语义，把 `/${skill.name} ` 插入 slash 查询位置。

键盘：

- `ArrowDown` / `ArrowUp` 移动选中项。
- `Enter` / `Tab` 执行当前选中项。
- `Escape` 关闭菜单并删除本次 slash 查询片段。
- 点击候选项执行同样动作。

兼容现有 DM skill：

- 原有 `/memory` 私聊技能菜单并入新菜单，不再单独存在第二套 skill slash picker。
- 发送后的 DM skill token 高亮可以继续沿用现有 `leadingSkillSlashToken()` 规则：只高亮正文开头且命中当前 DM Agent skill 的 token。
- 固定 composer 命令不会作为消息正文发送，因此不会影响消息高亮。

## i18n

新增或调整本地化字段：

- `chat.chooseComposerCommand`
- `chat.insertFileCommand`
- `chat.insertFileCommandDescription`
- `chat.convertToTaskCommand`
- `chat.convertToTaskCommandDescription`
- `chat.inputToChannelWithActions(name)`
- `chat.inputToMemberWithActions(name)`

英文同步补齐，避免类型不完整。

## 测试计划

### 纯 helper 测试

在 `apps/desktop/src/app/model.test.ts` 覆盖：

- slash query 支持开头 `/` 和空格后的 ` /`。
- URL、路径和普通词中间 `/` 不触发。
- query 后出现空格和正文时不再触发。
- 执行固定命令时删除 slash 查询片段并保留前文。
- 插入 skill 时在触发位置插入 `/${skill.name} `。

### 主聊天 DOM 测试

在 `apps/desktop/src/features/chat/ChatPageView.test.tsx` 覆盖：

- composer 外层是统一输入容器，textarea 和工具栏在同一 `data-testid="slei-composer-surface"` 内。
- textarea 有自适应高度上限相关配置，最大高度为 500px。
- composer 不再渲染 checkbox，渲染 switch。
- composer 只渲染一个文件 input 和一个文件按钮。
- 点击文件按钮触发 file input。
- drop 文件后渲染附件预览。
- paste 文件后渲染附件预览。
- 图片附件显示缩略图，普通文件显示文件名。
- 输入 `/` 或 `文本 /` 显示合并命令菜单。
- 选择“插入文件”打开文件选择并移除 slash 查询。
- 选择“转为任务”打开 switch 并移除 slash 查询。
- DM 场景固定命令和 skill 项同时出现在同一个菜单。
- 发送仍调用 `onSendMessage(body, { asTask, attachmentIds, sessionId })`。

### 任务线程 DOM 测试

在 `apps/desktop/src/features/tasks/TasksPageView.test.tsx` 或 `TaskThreadDrawer` 相关测试覆盖：

- 任务线程回复 textarea 有自适应高度上限配置。
- Enter 仍提交。
- Shift+Enter 仍换行。
- mention 菜单键盘选择仍可用。

### 验证命令

```sh
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop lint
```

## 验收标准

1. 主聊天输入区视觉上成为一个完整输入面板，不再像“输入框 + 下方操作区”分离。
2. 主聊天 textarea 输入长内容时自动增高，超过 500px 后内部滚动。
3. 任务线程回复 textarea 自动增高，且不会明显挤压线程内容。
4. 点击、拖拽、粘贴都能添加图片或普通文件。
5. 图片附件显示缩略图，普通文件显示文件名。
6. “转为任务”为 switch，不再是 checkbox。
7. `/` 和空格后的 ` /` 能唤起统一命令菜单。
8. 命令菜单至少包含“插入文件”和“转为任务”；DM 私聊中同时包含目标 Agent skills。
9. placeholder 明确提示输入 `/` 可打开功能菜单。
10. 发送、转任务、附件和任务线程回复仍走现有 daemon/bridge 链路。
