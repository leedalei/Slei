# 手动创建成员角色预设设计

## 背景

手动创建智能体成员的 modal 当前把运行环境、成员名称、handle、模型和描述放在同一个窄表单中。用户需要手写角色描述，无法从常用角色模板中快速选择。新的体验需要拉宽 modal，把运行环境与成员信息分区展示，并在描述区域支持“自定义”和“选择预设”两种模式。

项目约束要求生产状态、业务规则和持久化默认归 daemon 与 SQLite 处理。角色预设不能作为 frontend mock 或本地常量填充真实界面；desktop UI 只能展示 daemon 返回的数据，并把最终创建请求提交给 daemon。

## 目标

1. 创建成员 modal 更宽，表单清晰分成“运行环境”和“成员信息”两块。
2. 描述区域支持 radio 模式切换：
   - 默认“自定义”，展示现有 textarea。
   - “选择预设”展示可点击的预设角色卡片列表。
3. 角色预设由 daemon 从 SQLite 读取并通过 API 返回，desktop 不内置 production 预设。
4. 选择预设后，提交创建成员时使用预设的 `description` 作为最终 Agent 描述。
5. 创建成员时展示可刷新的像素头像预览，头像种子随创建请求持久化。
6. 去掉 `@handle` 手动配置，handle 默认由名称生成并与名称保持一致。
7. 不把 `presetId` 写入 Agent DTO 或 Agent 持久化字段。
8. 补齐 daemon、storage、bridge 和 UI 单元测试；UI 测试覆盖 DOM 渲染和关键交互。

## 非目标

- 不做预设管理入口，不支持用户在 UI 中新增、编辑或删除预设。
- 不在 Agent 表中保存 `preset_id`。
- 不改变预设与 Agent 的关联语义；选择预设只影响最终 `description`。
- 不改变频道路由、coordinator、多 Agent 协作或任务卡片行为。
- 不在 frontend 通过 mock、demo、sample 或静态常量填充 production 预设列表。

## 数据模型

新增 SQLite 表 `agent_role_presets`：

```text
id          TEXT PRIMARY KEY
title       TEXT NOT NULL
description TEXT NOT NULL
sort_order  INTEGER NOT NULL DEFAULT 0
enabled     INTEGER NOT NULL DEFAULT 1
created_at  TEXT NOT NULL
updated_at  TEXT NOT NULL
```

约束与行为：

- `title` 是卡片主标题，例如“小红书调研员”。
- `description` 是提交创建成员时可直接使用的角色描述，例如“负责从小红书调研检索信息，进行分析对比等...”。
- `sort_order` 控制展示顺序。
- `enabled = 0` 的预设不返回给 desktop。
- 默认预设通过 storage 初始化路径写入 SQLite；daemon 启动时调用该初始化路径，seed 必须幂等。

## 第一版默认预设

第一版 seed 写入以下 10 个 enabled 预设。`sort_order` 按 10 递增，方便后续插入新预设。

| id | title | description | sort_order | enabled |
| --- | --- | --- | ---: | ---: |
| `xiaohongshu-researcher` | 小红书调研员 | 负责从小红书调研检索信息，整理笔记、提炼趋势、对比竞品，并输出可执行的分析结论。 | 10 | 1 |
| `research-analyst` | 资料调研员 | 负责围绕指定主题收集资料、核对来源、归纳关键事实，并形成结构化调研摘要。 | 20 | 1 |
| `product-planner` | 产品策划员 | 负责拆解用户需求、梳理使用场景、设计功能边界，并输出清晰的产品方案。 | 30 | 1 |
| `engineering-implementer` | 研发执行员 | 负责根据明确需求实现代码、修复缺陷、运行验证，并及时反馈风险和阻塞。 | 40 | 1 |
| `system-architect` | 系统架构师 | 负责设计系统架构、拆分模块边界、识别技术风险，并给出可落地的演进方案。 | 50 | 1 |
| `qa-reviewer` | 质量审查员 | 负责检查交付物的正确性、边界条件、回归风险和体验问题，并给出可复现的改进建议。 | 60 | 1 |
| `teaching-assistant` | 教学助理 | 负责把复杂知识拆成循序渐进的讲解、练习和反馈，帮助学习者理解概念并完成训练。 | 70 | 1 |
| `legal-researcher` | 法律研究员 | 负责整理法律、合同和合规相关资料，提炼风险点与待确认问题，并提醒用户寻求专业律师确认。 | 80 | 1 |
| `finance-analyst` | 财务分析员 | 负责整理预算、成本、收入和指标数据，做基础测算、趋势分析和风险提示。 | 90 | 1 |
| `operations-planner` | 运营策划员 | 负责设计活动方案、用户触达节奏、内容排期和效果指标，并持续复盘优化。 | 100 | 1 |

法律相关预设命名为“法律研究员”，避免暗示 Agent 可以替代执业律师给出正式法律意见。

## Daemon API

新增只读接口：

```text
GET /v1/agent-role-presets
```

返回结构：

```json
{
  "presets": [
    {
      "id": "xiaohongshu-researcher",
      "title": "小红书调研员",
      "description": "负责从小红书调研检索信息，进行分析对比等...",
      "sortOrder": 10
    }
  ]
}
```

接口规则：

- 只返回 `enabled = 1` 的预设。
- 按 `sort_order ASC, title ASC` 排序。
- daemon/storage 是预设数据的 source of truth。
- 预设读取失败时返回标准 daemon 错误，desktop 显示错误状态和重试入口。

## Desktop Bridge

新增 DTO：

```ts
type AgentRolePresetView = {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
};

type AgentRolePresetReceipt = {
  presets: AgentRolePresetView[];
};
```

扩展创建 Agent request：

```ts
type AgentCreateRequest = {
  name: string;
  handle: string;
  runtimeKind: string;
  model: string;
  nodeId: string;
  description: string;
  avatarSeed?: string;
};
```

`avatarSeed` 可选是为了兼容已有 guide/product tool 创建路径。手动创建 modal 会提交该字段；daemon 如果收到空值，继续使用现有默认头像 seed 策略。

新增 bridge 方法：

```ts
listAgentRolePresets(): Promise<AgentRolePresetReceipt>
```

Tauri command 建议命名为：

```ts
list_agent_role_presets_command
```

desktop 可以在创建成员 modal 打开时加载预设，也可以在 shell 层缓存本次会话的结果。无论采用哪种实现，UI 都不能在 production 路径中使用本地静态预设兜底。

## 创建成员 Modal 布局

modal 从当前 `sm:max-w-lg` 扩大到约 `sm:max-w-3xl` 或 `sm:max-w-4xl`，内容继续限制在 `max-h` 内并保持可滚动。

表单分为两块：

### 运行环境

包含：

- 关联设备
- 运行 runtime
- 模型

宽屏下作为较窄列展示；窄屏下与成员信息上下堆叠。

### 成员信息

包含：

- 头像预览
- 名称
- 描述来源 radio：`自定义` / `选择预设`
- 描述输入区或预设卡片区

宽屏下作为较宽列展示。footer 仍包含取消和创建按钮，位置保持在表单底部。

头像和名称采用横向布局：

- 左侧展示像素头像预览。
- 右侧展示名称输入。
- 不再展示 `@handle` 输入项。
- hover 头像时显示刷新 icon；点击刷新 icon 重新生成头像 seed 并立即更新预览。
- 头像预览复用现有 Dicebear pixelArt / `MemberAvatar` 视觉语言，保持像素化渲染。

## 名称、Handle 与头像规则

手动创建成员时，用户只配置名称，不配置 `@handle`。desktop 根据名称生成内部 handle，并随创建请求提交给 daemon：

```text
name: 小红书调研员
handle: @小红书调研员
```

生成规则：`handle = "@" + trimmedName`，保留名称中的中文、大小写和其他允许字符。

名称校验：

- 名称不能为空。
- 名称不能包含空白字符。
- 名称不能包含连字符 `-`。
- 名称不能与已有成员名称重复；比较时应做前后空白 trim。
- 名称不限制纯英文，允许中文和其他非空白、非连字符字符。

daemon 的 handle 校验需要同步放宽：

- handle 去掉开头 `@` 后不能为空。
- handle 去掉开头 `@` 后不能包含空白字符。
- handle 去掉开头 `@` 后不能包含连字符 `-`。
- handle 长度仍需有上限，具体上限在实现计划中按现有限制延续或调整。
- handle 不再限制为 ASCII 小写字母、数字和连字符。

头像规则：

- modal 打开时生成默认 `avatarSeed`，优先基于名称；名称为空时使用随机或时间相关 seed。
- 名称变化时，如果用户尚未手动刷新过头像，头像 seed 可随名称同步更新。
- 用户点击刷新 icon 后，生成新的 `avatarSeed`，并标记为用户已手动选择；后续名称变化不覆盖该 seed。
- 提交创建时，desktop 把 `avatarSeed` 传给 daemon。
- daemon 将 `avatarSeed` 写入现有 Agent `avatar_seed` 字段；如果请求未提供，则继续使用现有默认策略。

## 描述来源交互

默认选中“自定义”：

- 显示 textarea。
- 提交时使用 textarea 内容。
- 若 textarea 为空，继续使用现有 `defaultDescription(name)` fallback。

切换到“选择预设”：

- textarea 替换为预设卡片网格。
- 卡片采用 N * M 布局，容器高度最多约两行半，超出纵向滚动。
- 卡片展示 `title` 和 `description`。
- 点击卡片即选中；选中态、hover 态、focus 态必须清晰。
- 卡片应具备可访问语义，例如 `aria-pressed` 或 radio-like 交互。
- 未选择预设时禁用“创建”按钮。
- 选择预设后提交，用选中预设的 `description` 作为 `createAgent` 请求的 `description`。

## 状态与错误处理

- 预设加载中：预设区域显示轻量 loading，不阻塞用户填写运行环境和成员信息。
- 预设为空：选择预设模式下显示空状态，并禁用创建按钮；用户可切回自定义。
- 预设加载失败：选择预设模式下显示错误状态和重试按钮；用户可切回自定义继续创建。
- Agent 创建失败：沿用现有创建失败 toast 和错误处理。
- 字段校验：UI 做名称基础必填、格式和重复校验；daemon 继续负责真实创建约束，例如 handle、node/runtime 是否有效。

## 数据流

```text
SQLite agent_role_presets
  -> slei-storage repository
  -> slei-daemon GET /v1/agent-role-presets
  -> Tauri command / desktop bridge listAgentRolePresets
  -> AgentCreateModal 预设卡片
  -> 用户选择预设
  -> createAgent({ ..., handle: `@${name}`, description: preset.description, avatarSeed })
  -> daemon 创建 Agent
```

约束：

- UI 不读取文件系统，不扫描内置资源，不维护 production 预设副本。
- UI 只把最终描述提交给现有创建成员流程。
- 预设排序、启用过滤和默认 seed 由 daemon/storage 管理。
- 头像 seed 是用户创建成员输入的一部分，由 daemon 持久化到 SQLite。
- handle 仍作为内部身份字段存在，但不再作为手动创建 modal 的用户配置项。

## 测试计划

### Storage / Daemon

- migration 创建 `agent_role_presets` 表。
- repository 能幂等 seed 默认预设。
- repository/API 只返回 enabled 预设。
- repository/API 按 `sort_order ASC, title ASC` 排序。
- API receipt 字段与协议类型一致。
- create Agent 接受可选 `avatarSeed` 并持久化到 Agent `avatar_seed`。
- handle 校验允许中文等非 ASCII 字符，但拒绝空白字符和连字符 `-`。
- 名称校验拒绝空白字符、连字符 `-` 和重复名称。

### Protocol / Bridge

- 新增 `AgentRolePresetView` 与 receipt 类型。
- bridge 调用 daemon/Tauri command 的参数和返回值测试。
- offline bridge 对该方法返回明确错误或空能力状态，不能伪造 production 预设。
- `AgentCreateRequest` 支持可选 `avatarSeed`。

### Desktop UI

- 创建成员 modal 渲染“运行环境”和“成员信息”两块。
- 成员信息区左侧渲染头像，右侧渲染名称输入。
- 不渲染 `@handle` 输入。
- 名称不限制纯英文，允许中文。
- 名称包含空白字符或连字符 `-` 时显示校验错误并禁用创建。
- 名称与已有成员重复时显示校验错误并禁用创建。
- 默认头像按像素风格生成。
- hover 头像时出现刷新 icon。
- 点击刷新 icon 后头像预览变化，提交时携带新的 `avatarSeed`。
- 默认选中“自定义”，textarea 可输入。
- 切换“选择预设”后显示卡片网格，不显示 textarea。
- 卡片展示 title 和 description。
- 点击卡片后有选中态。
- 未选择预设时创建按钮禁用。
- 选择预设后提交，`onCreate` 收到的 request 使用预设 `description`。
- 预设为空时显示空状态，并可切回自定义创建。
- 预设加载失败时显示错误状态和重试按钮，并可切回自定义创建。

## 文档影响

本设计不改变频道发言、coordinator 路由、multi-agent 协作、任务消息或任务卡片语义，因此不需要更新：

- `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- `docs/architecture/0006-task-source-message-card.md`

本设计会扩展创建 Agent DTO，新增可选 `avatarSeed`，但不改变频道路由、任务卡片或预设关联语义。如果实现阶段进一步引入 Agent `presetId` 持久化，需要追加更新相关架构文档。本设计当前不包含 `presetId` 持久化。
