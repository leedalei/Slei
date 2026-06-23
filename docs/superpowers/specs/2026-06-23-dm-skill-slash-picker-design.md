# DM Skill Slash Picker 设计

## 背景

Slei 当前已经有两条相关能力：

- 聊天输入框支持 `@` mention picker，包含候选过滤、键盘选择、插入和 DOM 测试。
- daemon 暴露 `list_agent_skills` / `listAgentSkills(agentId)`，`SleiMember.skills` 可以保存当前 Agent 工作区 `.claude/skills/*/SKILL.md` 解析出的 `SkillView[]`。

用户希望在输入框最开头输入 `/` 时弹出可选 skill，并让发送后的消息把开头 `/skillName` 高亮成类似 `@mention` 的 token。频道中 Agent 很多，无法确定 `/` 应该归属哪个 Agent，因此本设计只覆盖 Agent 私聊 DM，不覆盖频道会话。

## 目标

1. 仅在 Agent 私聊 DM composer 中，当输入框开头输入 `/` 时展示当前 DM Agent 的 skill picker。
2. 候选项来自 daemon 返回的当前 Agent `SkillView[]`，UI 不扫描 `.claude/skills` 或本机 runtime 文件。
3. 选中 skill 后向输入框插入 `/${skill.name} `，例如 `/memory `。
4. 消息展示时，只把正文开头且命中当前 DM Agent skill 的 `/skillName` 高亮为 skill token。
5. 频道 composer 不响应 `/`，消息正文中间的 `/xxx` 不高亮。
6. 为解析 helper、DOM 渲染、键盘交互和 DM skill 加载补齐严格单元测试。

## 非目标

- 不实现完整 Claude Code runtime slash command palette。
- 不列出 Claude Code 内建 slash commands、项目 `.claude/commands` 或用户全局 commands。
- 不支持频道 composer 的 `/` picker。
- 不新增 daemon API、SQLite schema 或消息协议字段。
- 不在 UI 中读取文件系统、扫描 Agent workspace 或推导 runtime 命令。
- 不改变实际发送的 message body；高亮只属于展示层。

## 架构决策

本阶段采用 **DM-only Skill Picker，数据来自 `listAgentSkills`**。

```text
daemon list_agent_skills
  -> Tauri bridge listAgentSkills(agentId)
  -> SleiApp 在打开 DM 时确保 dmMember.skills 已加载
  -> ChatPageView 只消费 dmMember.skills
  -> composer picker 展示 /skillName
  -> 发送普通 message body
  -> 消息渲染只高亮开头 /skillName token
```

这让前端体验接近 slash command，但 source of truth 仍是 daemon 已建模的 Agent skills。若以后要完全等价 runtime slash command palette，应单独设计 runtime command DTO、worker 探测、缓存、失败状态和跨 runtime 兼容策略。

## 数据流

### Skill 加载

当前 `SleiApp` 已在选中成员详情时懒加载 Agent skills，但 DM composer 需要在打开私聊时也有数据。因此实现应补充：

- 当 `activeConversation.kind === "dm"` 且能找到对应 Agent member 时，如果 `member.skills` 缺失，调用 `bridge.listAgentSkills(member.id)`。
- 成功后把 `receipt.skills` 写回 `SleiMember.skills`。
- 失败时保持成员数据不变；composer 不展示 picker，不填充 mock。
- 如果 bridge 离线或 daemon 返回空 skills，UI 展示普通 composer，不生成假候选。

### Composer 消费

`ChatPageView` 只消费 props 中的 `dmMember.skills ?? []`，不直接调用 bridge，不访问文件系统。

建议新增纯 helper：

- `activeSkillSlashQuery(draft)`：只识别输入框开头的 slash token。
- `skillSlashSuggestions(query, skills)`：按 `skill.name` 和 `skill.id` 做大小写不敏感过滤。
- `moveSkillSlashSelection(current, delta, count)`：可复用现有 selection helper，或让现有 helper 命名更通用。
- `insertSkillSlash(draft, activeQuery, skill)`：插入 `/${skill.name} `。
- `leadingSkillSlashToken(body, skills)`：消息展示时识别正文开头的 skill token。

## Composer 交互

触发条件：

- 仅 DM 生效：存在 `activeConversation.kind === "dm"` 且能找到 `dmMember`。
- 仅开头 slash token 生效：draft 的字面第一个字符必须是 `/`，并匹配输入框开头的 `/` 查询，例如 `/`、`/m`、`/memory`。
- 非开头 slash 不触发：` hi /memory`、`hi /memory`、`请用 /memory`、换行后的 `/memory` 都不弹 picker。
- 有其他正文后不触发：当用户已经输入 `/memory 请记住...` 时，不再把 composer 视为正在选择 skill。
- `@mention` 与 `/skill` 不共享候选模型；两者触发规则自然互斥。

键盘与鼠标：

- 输入 `/` 展示当前 DM Agent 所有 skills。
- 输入 `/me` 过滤出名称或 id 包含 `me` 的 skill，例如 `memory`。
- `ArrowDown` / `ArrowUp` 移动选中项。
- `Enter` / `Tab` 选择当前项，并插入 `/${skill.name} `。
- `Escape` 关闭 picker，并清掉开头 slash query。
- 点击候选项也插入 `/${skill.name} `。

可用性：

- picker 应有明确 aria-label，例如中文“选择技能”、英文“Choose skill”。
- 候选项展示 `skill.name` 和 `skill.trigger`；`trigger` 在当前 DTO 中代表从 `SKILL.md` frontmatter 读取到的描述。
- 如果没有 candidates，不展示 picker。
- 发送 disabled、附件、转任务 checkbox 等现有 composer 行为不改变。

## 消息高亮

高亮规则必须严格限制为正文开头：

- 只检查原始 `message.body` 的字面第一个 token；如果消息以空格、换行或其他字符开头，则不识别 skill token。
- 只有第一个 token 精确匹配当前 DM Agent skill 时才高亮：
  - `/${skill.name}`
  - 或 `/${skill.id}`
- token 后面可以是空白、换行或正文结束。
- 只高亮这个开头 token，剩余正文继续走现有 Markdown 渲染。
- 中间出现的 `/memory`、路径片段、URL、Markdown 内容都不处理。
- 未知 `/xxx` 不高亮。
- 频道消息不做 skill token 高亮，因为频道没有单一 Agent skill 归属。

视觉要求：

- token 保留斜杠，例如 `/memory`。
- 视觉接近现有 mention token：小号 badge/token，和正文基线协调，不破坏 Markdown 段落布局。
- 高亮只是展示层，不修改 message body，不影响复制消息、保存消息或线程引用。

## 组件调整

### ChatPageView

- 计算 `dmMember` 后，只有 DM 情况下计算 `activeSkillSlashQuery(draft)`。
- 增加 `selectedSkillIndex` 和 `skillOptionRefs`，复用现有 mention picker 的滚动和键盘体验。
- 在 composer footer 中，当 skill query 和 candidates 存在时渲染 `SkillSlashPicker`。
- `onKeyDown` 中优先处理活跃 picker 的上下键、Escape、Enter/Tab 选择，再走提交逻辑。
- 频道会话中的 `/` 不进入 skill picker 分支。

### SkillSlashPicker

新增展示组件，职责类似 `MentionPicker`：

- 输入 `messages: DesktopMessages`、`skills`、`selectedIndex`、`onSelect`、`optionRef`。
- 使用现有 design system 组件和滚动容器。
- 每项展示 `/skill.name`、描述和可选 path/source 的轻量信息；不展示实现说明文案。

### MarkdownMessage 或消息展示层

现有 `MarkdownMessage` 负责正文 Markdown 渲染。为了避免误伤 Markdown，建议在消息条目层先识别 leading skill token：

1. 如果当前上下文是 DM，且 `leadingSkillSlashToken(message.body, dmMember.skills)` 命中：
   - 渲染 skill token badge。
   - 将剩余正文继续交给 `MarkdownMessage`。
2. 如果未命中，保持现有 `MarkdownMessage` 渲染。

这样可以保证只处理开头 token，不在 Markdown AST 中扫描所有 `/xxx`。

### i18n

新增少量 chat 文案：

- `chooseSkill`：中文“选择技能”，英文“Choose skill”。
- 如需要候选描述 fallback，可新增 `skillDescriptionUnavailable`，但空描述也可以直接不渲染。

中英文 locale 必须同步更新，保持类型检查通过。

## 错误与空状态

- `listAgentSkills` 失败：不展示 picker，不 toast，避免 composer 因能力加载失败打扰输入。
- skills 为空：不展示 picker。
- skill name 为空时不作为候选；正常 daemon 数据不应出现，但 UI helper 可以防御。
- 多个 skill 具有相同 name 时，展示顺序跟 daemon 返回一致；插入 name 后高亮匹配第一个命中项。该情况应由后续 daemon/Agent skill 命名策略处理，本任务不新增去重规则。

## 测试计划

### 单元测试：model helpers

更新 `apps/desktop/src/app/model.test.ts`：

1. `activeSkillSlashQuery("/")` 返回空 query。
2. `activeSkillSlashQuery("/me")` 返回 `me`。
3. `activeSkillSlashQuery("hi /me")` 返回 `null`。
4. `activeSkillSlashQuery("请用 /memory")` 返回 `null`。
5. `skillSlashSuggestions("me", skills)` 能匹配 `memory` 的 name/id。
6. `insertSkillSlash("/", query, memory)` 返回 `/memory `。
7. `leadingSkillSlashToken("/memory remember this", skills)` 命中 `memory`。
8. `leadingSkillSlashToken("please /memory", skills)` 不命中。
9. `leadingSkillSlashToken("/unknown", skills)` 不命中。

### 单元测试：ChatPageView DOM 与交互

更新 `apps/desktop/src/features/chat/ChatPageView.test.tsx`：

1. DM 输入 `/` 时渲染 `SkillSlashPicker`。
2. 频道输入 `/` 不渲染 skill picker。
3. DM 输入 `/me` 只显示匹配的 `memory`。
4. `ArrowDown` / `ArrowUp` 改变 `aria-current`。
5. `Enter` 或 `Tab` 选择后 textarea 值为 `/memory `。
6. `Escape` 清掉开头 slash query 并关闭 picker。
7. 当前 DM Agent skills 为空或未加载时，不展示 picker。

### 单元测试：消息高亮

更新 `MarkdownMessage` 或 chat render 相关测试：

1. DM 消息正文开头 `/memory 请记住...` 渲染 skill token。
2. DM 消息正文中间 `请用 /memory` 不渲染 skill token。
3. 未知 `/unknown` 不渲染 skill token。
4. 频道消息开头 `/memory` 不渲染 skill token。
5. 高亮后剩余正文仍走 Markdown，例如 `**重点**` 正常渲染。

### 单元测试：DM skill 加载

更新 `apps/desktop/src/app/SleiApp.test.ts` 或 bridge mock 相关测试：

1. 打开 DM 时，如果目标 Agent 没有 `skills`，调用 `bridge.listAgentSkills(agentId)`。
2. 加载成功后，`ChatPageView` 收到更新后的 `dmMember.skills`。
3. 加载失败时页面不崩溃，并且 composer 不展示 picker。

### 验证命令

实现完成后至少运行：

```bash
pnpm --filter @slei/desktop test -- apps/desktop/src/app/model.test.ts apps/desktop/src/features/chat/ChatPageView.test.tsx apps/desktop/src/app/SleiApp.test.ts
```

如果 Vitest 文件筛选在当前 workspace 中不支持，应运行 desktop 前端单元测试集合，并在交付说明中写明实际命令。若修改 i18n 类型或 locale，同步运行：

```bash
pnpm --filter @slei/desktop typecheck
```

## 风险与兼容

- 这不是完整 runtime slash command palette，只是当前 Agent skills 的 slash picker。UI 文案和实现命名应避免暗示支持所有 runtime commands。
- `SkillView.trigger` 字段名不直观，但本任务不扩大 DTO 变更；展示时把它当作描述。
- 只高亮 DM 开头 token，可以避免路径、URL、Markdown 和普通文本中的 `/xxx` 被误识别。
- 发送 body 保持 `/skillName ...`，如果 runtime 对 slash 开头文本有特殊解释，应由现有 DM message pipeline 保持原样传递给 Agent。
- 如果未来 runtime command API 落地，可以把 picker 数据源从 `SkillView[]` 扩展为新的 command DTO，但本任务不预留复杂抽象。
