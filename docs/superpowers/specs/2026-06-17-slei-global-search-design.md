# Slei 全局搜索设计

## 背景

当前桌面端已经有独立 `SearchRoute` 和 `features/search`，但搜索主要基于前端已加载的会话消息做过滤，入口也仍依附在会话列表中。用户需要把搜索从会话列表中独立出来，成为最左侧主导航里的全局搜索入口，并能搜索 Agent、频道、频道消息和单聊消息。

Slei 的架构约束要求生产状态、业务规则、持久化和可恢复数据都由 daemon / SQLite 负责。全局搜索不能依赖 React fixture、本地已加载消息或 mock 数据拼装结果。UI 只负责展示 daemon 返回的 DTO、收集输入和筛选条件、触发跳转与高亮。

## 目标

1. 最左侧主导航新增独立放大镜按钮，进入全局搜索页。
2. 会话列表中的搜索入口不再作为主要入口，避免局部搜索和全局搜索并存造成歧义。
3. 全局搜索支持：
   - Agent / 成员。
   - 频道。
   - 频道消息。
   - 单聊消息。
4. 搜索结果按分类展示，并高亮关键词。
5. 空输入时不请求 daemon，展示居中的空态占位信息。
6. 筛选真实可用：
   - `From`：本地用户 `Me` 和所有 Agent，用于筛选消息作者。
   - `Channel`：仅频道列表，用于筛选频道消息，不包含 DM。
   - `Time`：`Any Time`、`Today`、`Last 7 Days`、`Last 30 Days`。
7. 不实现 `Relevant` 排序筛选。
8. 点击结果后按类型跳转：
   - Agent 结果跳到成员列表并选中 Agent。
   - 频道结果跳到会话页并选中频道。
   - 消息结果跳到对应频道或单聊，并滚动到对应消息。
9. 被定位的消息添加 blink border class，闪烁几秒后移除。
10. 所有可见文案遵守多语言规则，写入 i18n 文件，不在组件中硬编码。

## 非目标

- 不实现全文相关性排序、权重打分或高级 ranking。
- 不实现自定义日期范围。
- 不把 DM 放进 `Channel` 下拉中。
- 不做 command palette 式上下键选择结果。
- 不依赖频道“新会话 / 历史会话”的长期产品能力。后续删除频道和 DM 会话记录功能后，全局搜索仍应基于目标 id + message id 工作。
- 不把搜索业务规则写在 UI、本地 fixture、localStorage 或 mock 中。
- 不改变频道广播、Agent claim、任务卡片和任务线程的业务流转。

## 架构决策

### 总体路径

新增 daemon 侧全局搜索 API，桌面端通过 Tauri bridge 调用：

```text
Desktop Search Page
  -> Tauri bridge globalSearch(request)
  -> daemon GET /v1/search/global
  -> daemon services
  -> slei-storage SQLite repositories
  -> categorized search DTO
  -> Desktop render + navigation
```

关键约束：

- daemon / SQLite 是搜索结果的 source of truth。
- Tauri bridge 只做安全 transport 和 DTO 暴露。
- React 组件只维护输入、筛选状态、loading/error/empty 状态和结果渲染。
- 前端不从 `data.messages`、fixture 或本地 mock 中推导生产搜索结果。
- 空输入由前端直接展示空态，不调用 daemon。

### 新 API

建议新增：

```http
GET /v1/search/global
```

查询参数：

| 参数 | 含义 |
| --- | --- |
| `query` | 必填关键词，trim 后为空时返回 400，前端正常不会发送空 query |
| `fromId` | 可选，`human:local` 或 Agent id，只影响消息结果 |
| `channelId` | 可选，仅筛选频道消息 |
| `timeRange` | 可选，`any`、`today`、`last7Days`、`last30Days` |
| `timeZone` | 可选 IANA 时区，用于计算 `Today` 等时间范围；未传时使用 daemon 保存的用户偏好或默认时区 |
| `includeAgents` | 可选，默认 true |
| `includeChannels` | 可选，默认 true |
| `includeMessages` | 可选，默认 true |
| `agentLimit` | 可选，默认 20，最大 20 |
| `channelLimit` | 可选，默认 20，最大 20 |
| `messageLimit` | 可选，默认 80，最大 80 |

空 `query` 的 API 行为固定为 `400 Bad Request`。前端正常不发送空 query，而是在本地展示空输入占位。

响应 DTO：

```json
{
  "query": "dev",
  "totals": {
    "agents": 2,
    "channels": 3,
    "messages": 42
  },
  "agents": [
    {
      "kind": "agent",
      "agentId": "agent_coda",
      "title": "Coda",
      "subtitle": "@coda",
      "avatarSeed": "coda",
      "matchedFields": ["name", "handle"]
    }
  ],
  "channels": [
    {
      "kind": "channel",
      "channelId": "dev-team",
      "title": "#dev-team",
      "subtitle": "Channel",
      "matchedFields": ["name"]
    }
  ],
  "messages": [
    {
      "kind": "message",
      "sourceKind": "channel",
      "messageId": "msg_123",
      "channelId": "dev-team",
      "conversationId": null,
      "authorId": "agent_coda",
      "authorName": "Coda",
      "authorHandle": "@coda",
      "title": "#dev-team",
      "snippet": "这里是一小段包含 dev 的消息摘要",
      "createdAt": "2026-06-17T10:00:00Z",
      "matchedFields": ["body"]
    }
  ]
}
```

实现阶段可以拆分内部 DTO，但 bridge 暴露给前端的字段需要稳定包含跳转所需信息：

- `kind`
- `sourceKind`
- Agent 结果：`agentId`
- Channel 结果：`channelId`
- Message 结果：`sourceKind`、`messageId`，以及 `channelId` 或 `conversationId`
- `title`
- `snippet`
- `createdAt`

`sessionId` 可以作为当前代码的过渡兼容字段存在，但设计不依赖用户可见的“历史会话切换”。后续删除会话记录功能时，搜索结果应继续使用 `channelId / conversationId + messageId` 定位。

## 搜索语义

### Agent 搜索

搜索字段：

- name
- handle
- description

结果上限 20。内部 coordinator 或 system-owned Agent 是否展示应沿用成员列表现有过滤规则：用户不可见的内部系统 Agent 不作为普通搜索结果出现。

点击 Agent 结果：

- 切换到 `members` 视图。
- 设置 `activeMemberId`。
- 成员列表选中对应 Agent。
- 不自动打开 DM。

### 频道搜索

搜索字段：

- channel name
- description
- project name / project paths，如果现有 daemon channel DTO 已持久化这些字段。

结果上限 20。点击频道结果：

- 切换到 `chat` 视图。
- 设置 `activeChannelId`。
- 清空 `activeConversationId`。
- 加载该频道消息列表。

### 消息搜索

消息结果包含频道消息和单聊消息。

频道消息搜索字段：

- body / content
- author name / handle 只用于 `From` 筛选，不参与消息关键词匹配。

单聊消息搜索字段：

- body
- author name / handle 只用于 `From` 筛选，不参与消息关键词匹配。

消息结果上限 80。默认按 `createdAt` 倒序返回，不做 `Relevant` 排序。

消息关键词搜索只匹配消息正文。若用户要按发送者查消息，应使用 `From` 筛选；Agent 本身的 name / handle / description 匹配由 Agent 分类承载。

过滤规则：

- `From` 只影响消息结果，不影响 Agent / 频道分类。
- 未选择 `Channel` 时，消息结果同时包含频道消息和 DM 消息。
- 选择 `Channel` 后，消息结果只返回该频道内的频道消息，DM 消息不再出现在消息结果中。
- `Time` 只影响消息结果。
- deleted / tombstone 消息必须排除。
- 任务源消息仍作为原消息搜索和定位，不创建或恢复旧 `task_card` 控制消息。

点击消息结果：

- `sourceKind = channel`：进入对应频道，加载消息列表，滚动到 `messageId`。
- `sourceKind = dm`：进入对应单聊，加载消息列表，滚动到 `messageId`。
- 如果目标消息已删除或加载失败，展示 i18n 错误 toast，不保留错误高亮状态。

## UI 设计

### 主导航入口

最左侧主导航增加独立搜索按钮：

- 使用 lucide `Search` 图标。
- 位置靠前，作为全局功能入口。
- 当前视图为 search 时显示 active 状态。
- aria-label 使用 i18n。

本次实现默认移除会话列表里的旧搜索入口，不再表达为会话内搜索。若实现阶段因布局或现有测试需要暂时保留按钮，该按钮也只能跳转到同一个全局搜索页，不能保留另一套会话列表内搜索体验。

### 搜索页布局

页面结构参考用户提供的截图，但所有文案走 i18n。

顶部：

- 左侧黄色放大镜按钮。
- 大输入框。
- 右侧 `Esc` 提示。
- placeholder 使用 i18n，例如中文可为“搜索频道、私聊、成员和消息...”，英文可为 “Search channels, DMs, people, and messages...”。

筛选栏：

- `From` 下拉。
- `Channel` 下拉。
- `Any Time` 下拉。
- 不渲染 `Relevant`。

内容区：

- 空输入：居中空态，包含大放大镜图标、标题和说明。
- 加载中：保留输入和筛选栏，内容区显示 loading。
- 有结果：显示总数并按分类展示。
- 无结果：显示 no result 空态。
- 错误：显示错误空态和可重试入口。

### From 下拉

结构：

- 标题。
- 内部搜索输入。
- `Me`。
- 所有可见 Agent。

数据来源：

- 来自 daemon / bridge 返回的真实用户和 Agent 数据。
- 不从 fixture、本地 mock 或硬编码列表生成。

列表项：

- 头像。
- 名称。
- 选中态。

筛选含义：

- 只筛选消息作者。
- 不影响 Agent / 频道结果分类。

### Channel 下拉

结构：

- 标题。
- 内部搜索输入。
- 频道列表。

数据来源：

- 来自 daemon / bridge 返回的真实频道数据。
- 不从 fixture、本地 mock 或硬编码列表生成。

列表项：

- `#` 图标。
- `#channel-name`。
- 选中态。

筛选含义：

- 只筛选频道消息。
- 不包含 DM。

### Time 下拉

选项：

- `Any Time`
- `Today`
- `Last 7 Days`
- `Last 30 Days`

当前选项显示 check 图标。筛选只影响消息结果。

### 关键词高亮

前端对 daemon 返回的 `title`、`subtitle`、`snippet` 做安全切分渲染：

- 不使用 `dangerouslySetInnerHTML`。
- 支持大小写不敏感匹配。
- 命中片段使用黄色背景，与截图风格一致。
- 中文关键词按字符串包含匹配即可。
- `snippet` 由 daemon 围绕首个命中词生成，最大 180 个字符；无命中词但记录被其他字段带出时，返回正文开头摘要。

## 导航与消息定位

`SleiApp` 增加统一搜索结果选择处理：

```text
handleGlobalSearchResultSelect(result)
```

行为：

- Agent：`navigateToView("members")` + `setActiveMemberId(agentId)`。
- Channel：`setActiveChannelId(channelId)` + 清空 DM 状态 + `navigateToView("chat")`。
- Channel message：进入频道，加载消息列表，设置 `focusedMessageId`。
- DM message：确保 DM conversation 存在，加载消息列表，设置 `focusedMessageId`。

`ChatPage` 复用现有 `[data-message-id]` 定位能力，并升级视觉反馈：

- 目标消息滚动到视口中间。
- 目标消息获得焦点。
- 添加明确的 blink border class，例如 `slei-message--blink-border`。
- 动画持续几秒后移除。

如果当前实现阶段仍有 `sessionId` 字段：

- 可以在 bridge 或 handler 内部用于兼容加载包含该消息的列表。
- 不把“切换历史会话”暴露为搜索导航步骤。
- 后续删除频道/DM 会话记录功能时，应保留基于 `channelId / conversationId + messageId` 的定位路径。

## 状态与错误处理

搜索页状态：

- `idle-empty`：空输入，占位空态，不请求 daemon。
- `loading`：输入或筛选变化后 debounce 请求。
- `success`：展示分类结果。
- `empty-result`：有 query 但无结果。
- `error`：daemon 离线或搜索失败。

请求处理：

- 输入 debounce，建议 200-300ms。
- 用请求序号或 abort controller 防止旧请求覆盖新结果。
- 用户继续输入时保留旧结果或显示 loading 均可，但不能闪回旧 query 的结果。
- 失败时保留输入和筛选条件。

时间范围边界：

- `timeZone` 使用桌面端当前偏好时区传入；daemon 负责把该时区下的自然日边界转换为查询条件。
- `Today` 表示该时区当天 00:00:00 到次日 00:00:00 之前。
- `Last 7 Days` 表示从该时区今天 00:00:00 往前含当天共 7 个自然日。
- `Last 30 Days` 表示从该时区今天 00:00:00 往前含当天共 30 个自然日。
- 未传或非法 `timeZone` 时，daemon 使用用户偏好时区；仍不可用时使用系统默认时区。

daemon 离线：

- UI 展示 i18n 错误空态。
- 不启用本地 mock 搜索兜底。

## i18n

所有可见文案写入：

- `apps/desktop/src/i18n/messages/zh-CN/search.ts`
- `apps/desktop/src/i18n/messages/en-US/search.ts`

需要覆盖：

- 页面标题。
- 输入 placeholder。
- 空输入标题和说明。
- 无结果标题和说明。
- 错误标题和说明。
- 分类标题。
- 总数。
- 下拉标题。
- 筛选选项。
- 跳转 aria-label。
- retry / clear 等按钮文案。

中文界面使用中文文案。截图仅作为布局参考，不作为中文界面的英文文案来源。

## 数据与持久化

需要在 `crates/slei-storage` 增加或扩展 repository 查询：

- 搜索 agents。
- 搜索 channels。
- 搜索 channel messages。
- 搜索 conversation messages。

要求：

- 查询从 SQLite 读取。
- 使用参数绑定，不能拼接 SQL。
- LIKE 查询需要转义 `%`、`_` 和 escape 字符。
- deleted / tombstone 消息排除。
- 时间范围在 daemon 或 repository 层统一计算，使用稳定时区策略。桌面端传 `timeRange`，不传本地计算后的 SQL 条件。
- limit 在 repository 或 service 层 clamp，消息最大 80，Agent / channel 最大 20。

可以先使用 SQLite `LIKE` 实现，不要求 FTS。未来如需要更强相关性再引入 FTS migration。

## 测试计划

### Rust / daemon

Repository 测试：

- 能搜索 Agent name / handle / description。
- 能搜索 channel name / description。
- 能搜索频道消息正文。
- 能搜索 DM 消息正文。
- deleted / tombstone 消息不返回。
- `From` 筛选只影响消息结果。
- `Channel` 筛选只影响频道消息结果，DM 不被 Channel 下拉筛选命中。
- `Time` 的 today / last7Days / last30Days 生效。
- 消息最大 80 条，Agent / channel 最大 20 条。

API 测试：

- 空 query 返回 400。
- 正常 query 返回分类 DTO。
- 筛选参数能传递到 service。
- DTO 包含跳转字段：`agentId`、`channelId`、`conversationId`、`messageId`。
- 未授权请求返回 401。

### Desktop 单元与组件测试

- 空输入显示 i18n 空态，且不调用 bridge。
- 输入后 debounce 调用 `globalSearch`。
- From 下拉可搜索和选择，选择后重新查询。
- Channel 下拉可搜索和选择，选择后重新查询。
- Time 下拉选择后重新查询。
- 结果按 Agent / Channel / Message 分类显示。
- 关键词高亮安全渲染。
- 无结果和错误态显示 i18n 文案。

### Desktop 路由与交互测试

- 点击 Agent 结果跳到 members 并选中对应 Agent。
- 点击 Channel 结果跳到 chat 并选中对应频道。
- 点击频道消息结果跳到频道并设置 `focusedMessageId`。
- 点击 DM 消息结果跳到对应私聊并设置 `focusedMessageId`。
- 定位消息渲染 blink border class，几秒后移除。
- 涉及 UI 的 DOM 节点和关键交互均需覆盖。

建议验证命令：

```sh
cargo fmt --check
cargo test -p slei-storage
cargo test -p slei-daemon
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop lint
```

如实现只改动部分 crate，可在完整验证前先运行更聚焦的相关测试。

## ADR 影响

本设计不改变频道广播、Agent claim、任务源消息或任务卡片语义。实现时仍需遵守：

- `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- `docs/architecture/0006-task-source-message-card.md`

全局搜索是只读查询和 UI 导航，不应新增 UI 路由决策、关键词兜底、mock 数据或不可持久化状态。
