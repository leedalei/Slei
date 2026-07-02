# Slei 全屏设置页与已保存入口设计

## 背景

当前 Slei 桌面端的设置、成员管理、设备管理和已保存消息入口分散在工作区 sidebar、底部设置菜单和不同 `AppView` 中。用户希望把成员管理、设备管理、账号资料和偏好设置统一收进一个专门的设置页面，并参考截图形成类似 Codex 设置页的布局：左上角可返回应用，左侧按分类摆放设置项，右侧展示对应详情。

本设计遵守 Slei 架构约束：业务逻辑、持久化和生产数据规则仍由 daemon/bridge 提供。UI shell 只负责展示数据、收集用户动作、触发已有回调和呈现 loading/error/empty 状态，不新增前端 mock 或本地生产数据源。

## 目标

- 将设置入口改为全屏设置层，看起来像独立页面，但行为上类似覆盖当前应用的全屏 modal。
- 进入设置前的聊天、搜索、任务、频道、私聊、已保存等状态保持不变；点击返回后恢复进入前状态。
- 设置页左侧按分组展示设置项，右侧展示当前设置详情。
- 将成员管理、设备管理、账号资料、偏好设置收敛到设置页中。
- 成员管理和设备管理保留现有完整体验，包括列表、详情、编辑、删除、workspace tabs、设备重命名等能力。
- 将“已保存”从底部设置菜单提取到当前 sidebar 顶部主导航区域，排在“搜索”“任务”之后。
- 保持现有 daemon 数据流和回调，不复制成员、设备、偏好或已保存的生产逻辑。
- 补充严格单元测试和 UI DOM/关键交互测试。

## 非目标

- 不重写成员管理和设备管理的业务能力。
- 不改变 daemon 对 profile、preferences、members、nodes、saved messages 的持久化模型。
- 不新增成员、设备或已保存消息的前端 mock、sample、fake seed 数据。
- 不在本任务中实现全局设置内容搜索。第一版设置搜索只过滤左侧设置项标题和分组。
- 不改变频道消息路由、coordinator 路由、任务卡片或 multi-agent 流程。

## 总体方案

采用“全屏设置 overlay + 复用完整管理页”的方案。

`SleiAppFrame` 增加本地 UI 状态来控制设置 overlay 是否打开，以及 overlay 内部当前设置项。点击当前 sidebar 底部的设置按钮时，不再通过 `onViewChange("settings")` 替换主 workspace，而是打开覆盖层。覆盖层显示时，底层应用状态不变，只在视觉上隐藏 workspace sidebar、resize handle 和当前 workspace 内容。

点击设置页左上角“返回应用”按钮时，只关闭 overlay。由于底层 `activeView`、`activeChannelId`、`activeConversationId`、`activeChatWorkspace`、搜索过滤、任务选中和其他外部状态没有被覆盖层修改，应用自然恢复进入设置前的状态。

现有 `AppView` 中的 `"settings"` 可以暂时保留，以兼容路由、测试或旧入口；但新的主入口不再依赖它。后续如果确认没有外部依赖，再单独清理旧 settings view。

## 设置页布局

设置 overlay 覆盖整个应用内容区域，视觉上类似截图中的独立设置页面：

- 左上角：返回按钮，文案为“返回应用”或同等本地化文案。
- 左栏顶部：设置搜索输入。
- 左栏主体：按分组展示设置项。
- 右侧详情：展示当前设置项对应内容，并独立滚动。

左侧分组结构：

1. `个人`
   - `账号资料`
   - `偏好设置`
2. `工作区`
   - `成员管理`
   - `设备管理`
3. `系统`
   - `关于`

默认打开设置时选中 `账号资料`。如果用户从某个具体菜单项进入，可以直接选中对应设置项。设置项切换只改变 overlay 内部 `activeSettingsPanel`，不影响主应用 `activeView`。

布局应避免卡片套卡片。overlay 外层负责两栏结构、返回按钮、设置搜索和左侧导航；右侧详情区域根据当前设置项渲染对应组件。

## 设置内容归并

### 账号资料

复用现有 settings account panel。保留展示名称、handle、头像预设和头像上传等已有能力，保留 profile 不可用时的空/错误状态。

### 偏好设置

承载现有语言与地区、外观、通知三个偏好面板。右侧可以使用纵向区块或紧凑 tabs 展示，第一版优先选择和现有设置组件改动最小的结构。

偏好设置继续使用现有 `locale`、`timeZone`、`appearance`、`notifications` props 和对应 change 回调。保存中、保存失败和禁用状态沿用现有行为。

### 成员管理

完整复用现有 `MembersPage` 能力，包括：

- 成员列表和默认选中逻辑。
- 成员资料、workspace、capabilities、permissions、activity tabs。
- 成员详情编辑。
- 成员删除确认和错误展示。
- workspace 文件读取、展开、预览和打开路径。
- 活动日志加载、失败状态和展开行为。
- 发送私聊等现有操作。

为了适配设置右侧详情，成员管理可以增加轻量 layout variant，去掉与 overlay 外壳冲突的独立 workspace 顶部外观，但不能删减功能。

### 设备管理

完整复用现有 `ComputersPage` 能力，包括：

- 设备列表或默认设备选择。
- 设备详情、状态、系统信息和 runtime 信息。
- 设备重命名和失败展示。
- 当前设备上的智能体列表。
- 无设备空状态和创建入口。

与成员管理一样，设备管理可以增加轻量 layout variant 适配设置右侧详情，但保留现有功能。

### 关于

复用现有 about panel，展示桌面端版本、daemon 版本和已连接设备数量等信息。

## 已保存入口

“已保存”从底部设置菜单移出，成为当前 sidebar 顶部主导航中的常驻入口，顺序为：

1. 搜索
2. 任务
3. 已保存

点击“已保存”时继续使用现有 `activeChatWorkspace="saved"` 机制，渲染现有 `SavedMessagesWorkspace`。该入口不进入设置 overlay，也不改变已保存列表的数据来源。

底部设置菜单移除“已保存”。成员管理、设备管理、账号资料和偏好设置相关入口改为打开设置 overlay 并选中对应设置项。

## 数据流与状态

设置 overlay 不引入新的 production 数据源。

沿用现有 `SleiAppFrame` props 和回调：

- profile、profile 保存、头像上传。
- locale、timeZone、appearance、notifications 及其保存回调。
- data.members、runtimeSetup.nodes。
- agent update/delete、member message、workspace list/read、activity list、open agent path。
- computer rename/create。
- savedMessages、onSavedMessageSelect。

overlay 本地状态只包括：

- overlay 是否打开。
- 当前设置项。
- 设置搜索输入。

这些状态只影响 UI 展示，不写入 localStorage、SQLite 或 JSON 生产文件。

## 错误与空状态

- profile 不可用时，账号资料显示现有不可用状态。
- 偏好保存失败时，继续显示现有本地化错误。
- 成员为空时，成员管理展示现有空状态，不注入默认成员。
- 设备为空时，设备管理展示现有空状态，不注入默认设备。
- 成员更新、删除、workspace 读取和 activity 加载失败时，沿用 `MembersPage` 现有错误展示。
- 设备重命名失败时，沿用 `ComputersPage` 现有错误展示。
- daemon 离线时，UI 展示离线、空状态或现有错误，不启用本地 mock 系统。

## 测试计划

### 组件与单元测试

- 打开设置 overlay 不调用 `onViewChange("settings")`，不改变底层 `activeView`。
- 从聊天频道、私聊、搜索、任务、已保存进入设置并返回后，底层状态保持进入前状态。
- 设置 overlay 显示时，DOM 中隐藏或不渲染当前 workspace sidebar 和 resize handle。
- 返回按钮关闭 overlay，并恢复底层 workspace。
- 左侧分组渲染 `个人`、`工作区`、`系统`。
- 左侧设置项渲染 `账号资料`、`偏好设置`、`成员管理`、`设备管理`、`关于`。
- 切换左侧设置项会更新右侧详情，不改变主应用 view。
- 设置搜索输入过滤左侧设置项标题和分组。

### UI 交互测试

- sidebar 顶部主导航顺序为“搜索”“任务”“已保存”。
- 点击“已保存”打开现有 saved workspace。
- 底部设置菜单不再显示“已保存”。
- 点击底部设置按钮打开全屏设置 overlay。
- 从底部菜单选择成员管理、设备管理、账号资料或偏好设置时，overlay 打开并选中对应设置项。
- 成员管理详情在设置右侧保留 tabs、编辑、删除确认、workspace 预览和 activity 加载入口的关键 DOM。
- 设备管理详情在设置右侧保留设备重命名、系统信息、runtime 信息和智能体列表关键 DOM。
- 账号资料和偏好设置在设置右侧保留现有保存交互和错误展示。

### 回归测试

- 现有 `SettingsPageView`、`MembersPageView`、`ComputersPageView` 相关测试继续通过。
- 已保存消息列表、选择消息和空状态相关测试继续通过。
- 无成员、无设备、daemon 不可用时，不出现 mock 数据。

## 实施注意事项

- 优先拆出 `SettingsOverlay`、`SettingsNavigation`、`SettingsDetailHost` 等小组件，避免继续扩大 `SleiAppFrame.tsx`。
- 成员管理和设备管理优先通过 layout variant 适配右侧详情，不复制现有页面逻辑。
- `SettingsPanel` 类型需要扩展为覆盖新设置项；如保留旧 `"language-region"`、`"appearance"`、`"notifications"`，应明确它们归入 `偏好设置` 的兼容映射。
- `已保存` 入口应复用现有 `onSavedMessagesOpen` 和 `activeChatWorkspace` 机制。
- UI 文案使用现有 i18n 模式，新增中文和英文文案。
- 本任务完成后需要询问是否合并到 `master` 或其他分支。
