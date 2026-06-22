# Agent 能力与权限页签设计

## 背景

成员详情页当前有 `资料 / 工作区 / 能力 / 活动日志` 页签。`能力` 页签里同时展示 runtime 能力 badge 和工作区权限信息，并在卡片描述里显示“只读”。这让页面语义不清：用户想查看 Agent 工作区内有哪些 skills 时，只能看到 `ClaudeCode` 这类 runtime 能力，而不是 `.claude/skills/*/SKILL.md` 中定义的技能名称与描述。

现有数据链路已经具备基础能力：

- daemon 暴露 `list_agent_skills` / `listAgentSkills`。
- `SkillView` 包含 `id / name / trigger / path`。
- daemon 读取 `SKILL.md` frontmatter，把 `description` 写入 `trigger` 字段。
- `SleiMember.skills` 已在选中 Agent 时通过 bridge 懒加载。

因此本设计只调整成员详情 UI 的信息架构和展示方式，不在 React 中扫描文件，也不新增 production mock 或本地持久化。

## 目标

1. `能力` 页签展示 Agent 工作区 skills 的名称和描述。
2. 新增 `权限` 页签。
3. 将当前能力页里“只读”和权限相关展示移动到 `权限` 页签。
4. 保持 daemon / bridge 作为 source of truth；UI 只展示 `SleiMember` 已有字段。
5. 为 UI DOM 渲染、tab 切换和关键内容展示补齐单元测试。

## 非目标

- 不实现 skill 安装、编辑、删除或刷新按钮。
- 不在前端解析 `SKILL.md` 或递归扫描工作区。
- 不修改 SQLite schema。
- 不改变 daemon 的 skill 读取路径、排序或兼容策略。
- 不重命名 `SkillView.trigger`。实现阶段可以用局部变量把它展示为描述，但不扩大 DTO 变更范围。
- 不改变 Agent runtime 权限模型或 channel membership 权限模型。

## 信息架构

成员详情页签调整为：

```text
资料 / 工作区 / 能力 / 权限 / 活动日志
```

### 能力页签

`能力` 页签只展示 Agent 工作区 skills：

- 标题使用现有 `members.capabilities`。
- 列表数据来自 `selectedMember.skills ?? []`。
- 每个 skill 展示：
  - `skill.name` 作为主标题。
  - `skill.trigger` 作为描述文本；它对应 daemon 从 `SKILL.md` frontmatter 读取到的 description。
  - 可保留 `Sparkles` 图标，保持和现有能力视觉语言一致。
- 空状态使用现有 `members.noSkills` 和 `members.noSkillsDescription`。

能力页签不再展示：

- `selectedMember.capabilities`。
- `selectedMember.permissions`。
- `members.readOnly` 描述。

### 权限页签

新增 `permissions` tab，显示只读权限相关信息：

- tab 文案使用新增 i18n key：
  - 中文：`权限`
  - 英文：`Permissions`
- 顶部卡片描述使用现有 `members.readOnly`，承接原能力页的“只读”说明。
- Runtime 能力区域展示 `selectedMember.capabilities`，例如 `ClaudeCode`。
- 工作区权限区域展示 `selectedMember.permissions`。
- 若 runtime 能力为空，展示现有 `members.noCapabilities` / `members.capabilityScanUnavailable`。
- 若工作区权限为空，不填充假数据，展示空状态；文案可复用 `members.workspacePermission` 作为标题，并用简短描述说明当前没有权限条目。

## 数据流

实现继续使用现有数据流：

```text
daemon list_agent_skills
  -> Tauri bridge listAgentSkills
  -> SleiApp active member lazy load
  -> SleiMember.skills
  -> MembersPage 能力页签展示
```

约束：

- `MembersPageView` 不调用 daemon，不读取文件系统，只消费 props。
- skills 未加载时与空列表一样进入空状态；不在 UI 中伪造默认技能。
- `selectedMember.capabilities` 只作为权限页中的 runtime capability 展示。
- `selectedMember.permissions` 只作为权限页中的 workspace permission 展示。

## 组件调整

### MembersPageView

- `MemberTab` 增加 `"permissions"`。
- `TabsTrigger` 增加权限页签，位置在能力和活动日志之间。
- `capabilities` content 改为 skills 列表。
- 新增 `permissions` content，移动原能力页中的只读、runtime 能力和工作区权限内容。
- 保持页面只做轻量 view-model 映射，例如把 `skill.trigger` 命名为显示用描述，不做业务判断。

### CapabilitiesPanel helper

`CapabilitiesPanel.ts` 目前是字符串渲染 helper，测试里把它作为“read-only capabilities”验证。实现时应同步调整语义：

- 输入改为 skills 或在命名上明确展示的是 skill name/description。
- 输出包含 `members.capabilities`、skill name 和 description。
- 不再输出 `members.readOnly`。

### PermissionsPanel helper

`PermissionsPanel.ts` 已用于表达 channel/workspace permission。实现时可保留该 helper 的职责，或让成员详情页直接用现有字段渲染；无论哪种方式，权限相关测试需要覆盖 `权限` tab 的真实 DOM 展示。

## 错误与空状态

- daemon skill 加载失败时，`SleiApp` 已保持失败不破坏成员页；成员页展示空 skills 状态。
- 权限页没有 permissions 时，不展示 mock 权限，不隐藏整个 tab。
- 离线 bridge 返回空 skills 时，能力页显示空状态。
- 所有 empty/loading/error 状态只反映 daemon/bridge 数据，不推导生产状态。

## 测试计划

### 单元测试

更新 `apps/desktop/src/features/members/MembersPageView.test.tsx`：

1. 断言 tab bar 包含 `权限` / `Permissions`。
2. 渲染带 `skills` 的 agent，进入能力页后能看到 skill name 和 description。
3. 断言能力页不再展示 runtime capability badge 或 workspace permission badge。
4. 点击权限页签后能看到 runtime capability，例如 `ClaudeCode`。
5. 点击权限页签后能看到 workspace permission，或在空 permissions 时看到空状态。
6. skills 为空时，能力页展示 `noSkills` 和 `noSkillsDescription`。

更新 `apps/desktop/src/features/members/CapabilitiesPanel.test.ts`：

1. 覆盖 skill 名称和描述输出。
2. 断言不再输出“只读”或安装类行动文案。

如实现改动 i18n 类型，更新对应类型检查和现有 i18n 测试。

### 验证命令

实现完成后至少运行：

```bash
pnpm --filter @slei/desktop test -- MembersPageView.test.tsx CapabilitiesPanel.test.ts
```

如果相关测试命令粒度不支持文件筛选，则运行 desktop 前端单元测试集合，并在交付说明中写明实际命令。

## 风险与兼容

- `SkillView.trigger` 字段名不直观，但当前变更不扩大 DTO 范围；页面可以把它作为“描述”展示。
- 现有测试可能仍断言能力页包含 `ClaudeCode`，需要按新语义更新。
- fixture 中旧 `capabilities` 数据继续存在，但展示位置移动到权限页，不删除字段。
- 若未来要把 `trigger` 正式改名为 `description`，应作为独立 DTO 兼容任务处理。
