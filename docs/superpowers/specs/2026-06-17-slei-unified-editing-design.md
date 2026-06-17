# Slei 统一编辑方案设计

- 状态：可进入实现计划
- 日期：2026-06-17
- 适用范围：`apps/desktop` 设置面板、成员详情、设备详情
- 相关约束：`AGENTS.md`、`docs/architecture/0005-channel-routing-and-multi-agent-flow.md`、`docs/architecture/0006-task-source-message-card.md`

## 背景

当前设置页里的语言、时区、外观和通知偏好都是选择后立即生效并通过 `bridge.updatePreferences` 保存到 daemon。语言切换会先在 App 层乐观更新 `locale`，然后等待 daemon 返回 preferences，再用 daemon 确认值回填。

成员详情和设备详情已经有字段级编辑雏形：字段默认只读，点击铅笔进入编辑态，保存或取消后退出。账户设置里的显示名和 handle 目前是输入即改本地 profile，和成员、设备的编辑体验不一致。daemon 侧已有 `UserProfile` 概念，并且测试约束了 handle 在 onboarding 创建后不可变；统一编辑方案必须继承这个身份规则。

本设计统一三类界面的编辑规则，但不改变 Slei 的架构边界：业务状态、持久化和生产数据规则仍由 daemon 和 bridge API 负责；UI 只维护短暂草稿、pending 和 error 状态。

## 目标

1. 让用户能一眼判断某个控件是“立即保存”还是“需要保存/取消”。
2. 设置面板、成员详情、设备详情使用同一套编辑反馈、错误和无障碍规范。
3. 保留偏好项的即时反馈，避免语言、主题、通知这类操作变慢。
4. 实体资料使用字段级显式保存，避免资料误改。
5. 新增或调整 UI 必须有严格单元测试，并验证 DOM 节点与关键交互。

## 非目标

1. 不引入整页草稿保存。
2. 不把偏好项迁移到本地 JSON 或其他 UI 持久化路径。
3. 不重构 daemon settings service 的存储模型。
4. 不改变频道、任务、coordinator 或 multi-agent 路由逻辑。
5. 不借本次任务做无关视觉重设计。

## 编辑模型

统一编辑模型分成两类组件族。

### `EditableEntityField`

`EditableEntityField` 用于实体资料，必须显式保存。适用范围：

- 账户资料：显示名。handle 是不可变身份字段，只读展示，不进入字段级编辑。
- 成员详情：显示名称、描述、runtime、model。
- 设备详情：设备名称。

字段默认只读，标题右侧显示铅笔图标按钮。点击铅笔后只编辑当前字段，显示输入控件、保存按钮和取消按钮。保存成功后退出编辑态；保存失败时留在编辑态，保留草稿并显示字段级错误。

字段是否允许空值由调用方配置。显示名、runtime、model 和设备名称不能为空；描述允许为空。handle 不允许在设置面板修改。

### `InstantPreferenceControl`

`InstantPreferenceControl` 用于用户偏好，选择即提交。适用范围：

- 语言。
- 时区。
- 主题。
- 字号。
- 通知开关。

偏好控件不显示保存和取消按钮。用户选择后，UI 立即乐观更新并进入 pending 状态；daemon 保存成功后清除 pending；保存失败后回滚到最近一次 daemon 确认值，并显示错误提示。

头像预设属于账户实体资料，但交互上使用选择即保存：点击头像预设立即提交，失败时回滚并提示。头像不额外进入文本编辑态，也不纳入“字段级显式保存”验收。

## 账户资料合同

账户资料不能继续只存在于 React 本地状态。实现本规范前，需要让 daemon 成为账户资料的 source of truth，并通过 bridge 暴露读取和更新能力。

建议合同：

- `GET /v1/settings/profile` 返回 `{ profile: { displayName, handle, avatar } }`。
- `PATCH /v1/settings/profile` 接收 `{ displayName?: string, avatar?: string }`。
- bridge 提供 `listProfile()` 和 `updateProfile(request)`。
- desktop App 初始化时与 preferences 一起读取 profile，并用 daemon 返回值渲染账户面板。

字段映射：

- `displayName` 对应 daemon `UserProfile.nickname`。
- `handle` 对应 daemon `UserProfile.handle`，只读展示。若未来要支持改 handle，必须另写身份迁移设计。
- `avatar` 对应 daemon profile 的头像字段。第一版可以保存头像 preset id；如果 daemon 继续使用 URL 字段，需要在 DTO 层明确转换，不把转换规则散落在 React 组件里。

持久化要求：

- 账户资料必须存入 SQLite，并通过 storage repository 访问。
- 不允许把账户资料继续保存为 production JSON 或仅保存在 React state。
- 若 daemon 尚未完成 onboarding profile 创建，账户面板应显示 daemon 返回的空状态或默认未设置状态，不使用本地 fake profile 伪装已保存资料。

错误映射：

- `displayName` 为空或只包含空白时返回字段级校验错误。
- `avatar` 不在允许 preset 列表中时返回字段级或控件级校验错误。
- `handle` 出现在 PATCH 请求中时 daemon 应拒绝或忽略并返回明确错误；UI 不应发送 handle 更新请求。
- 存储失败映射为字段级错误或账户面板错误，不退出编辑态。

## 组件职责

### 实体字段组件

实体字段组件负责：

- 渲染只读态、编辑态和保存中状态。
- 管理字段草稿。
- 执行字段级保存和取消。
- 在保存失败时保留草稿并显示错误。
- 提供稳定的 `aria-label`、输入标签和按钮状态。

实体字段组件不负责：

- 生产数据校验以外的业务规则。
- 本地持久化。
- 直接修改 daemon 状态。它只调用上层传入的保存函数。

### 偏好控件组件

偏好控件组件负责：

- 渲染 select、segmented button、switch 等即时保存控件。
- 管理当前控件或偏好分组的 pending 状态。
- 在失败时触发回滚和错误展示。
- 暴露稳定 DOM 标记，便于测试 pending、disabled 和错误态。

偏好控件组件不负责：

- 维护第二套 preferences source of truth。
- 在 UI 中写持久化规则。
- 使用 mock、demo 或 seed 数据填充生产设置。

## 数据流

### 实体资料

1. UI 从 daemon/bridge 返回的数据渲染确认值。
2. 用户点击字段铅笔，组件复制确认值为草稿。
3. 用户保存字段，上层调用对应 daemon command/API。
4. 保存成功后，上层用 daemon 返回的实体数据更新确认值，字段退出编辑态。
5. 保存失败后，字段保留草稿并显示错误；取消时回到当前确认值。

编辑中的草稿不应被后台刷新悄悄覆盖。若字段正在编辑，外部确认值变化只更新只读态来源，不自动改写草稿。

### 用户偏好

1. UI 从 daemon preferences 渲染确认值。
2. 用户修改偏好，App 层先乐观更新对应 UI 状态。
3. App 层调用 `bridge.updatePreferences`，daemon 通过 SQLite 保存。
4. 保存成功后，用 daemon 返回的完整 preferences 回填 locale、timeZone、appearance、notifications。
5. 保存失败后，回滚到最近一次 daemon 确认 preferences，显示 toast，并在相关控件附近显示短错误文本。

语言切换仍然采用乐观更新：界面先切换语言，失败时切回旧语言并提示。

## 交互规范

实体字段：

- 只读态显示字段标题、当前值和铅笔图标按钮。
- 不可编辑身份字段只读展示，不显示铅笔按钮。
- 编辑态显示输入控件、保存按钮、取消按钮。
- 单行字段按 Enter 保存，按 Esc 取消。
- 多行字段通过按钮保存，按 Esc 取消。
- 保存中禁用保存、取消和输入控件，并显示轻量 pending 状态。
- 保存成功不显示全局成功 toast。
- 保存失败显示字段级错误，字段保持编辑态。

偏好控件：

- 语言、时区使用 select。
- 主题、字号使用按钮组或分段控件。
- 通知使用 switch。
- 修改后立即更新 UI。
- pending 期间至少禁用当前控件；第一版可以禁用同一 preference group。
- 保存成功不显示全局成功 toast。
- 保存失败回滚旧值，显示 toast 和控件附近错误。

## 错误处理

实体字段保存失败时：

- 不退出编辑态。
- 不丢失用户输入。
- 字段下方显示错误文案。
- 用户可继续编辑后重试，或取消回到当前确认值。

偏好保存失败时：

- 回滚到最近一次 daemon 确认值。
- 显示 toast。
- 在触发控件附近显示短错误文本。
- 用户下一次操作或离开面板后清除该错误。

如果 daemon 不可用，设置页和详情页不得启用本地 mock 保存路径。UI 应展示错误、离线或空状态。

## 测试方案

前端测试：

- `EditableEntityField` 默认只读，包含铅笔按钮，不包含保存/取消。
- 点击铅笔后显示输入、保存和取消。
- 保存中输入和按钮 disabled。
- 保存失败保留草稿并显示错误。
- 取消恢复确认值。
- 账户显示名、成员、设备至少各有一个测试证明它们使用同一字段级显式保存模式。
- 账户 handle 只读展示，不渲染铅笔按钮，不调用 profile 更新请求。
- 头像 preset 点击后即时保存；失败回滚旧头像并显示错误。
- 语言、主题、通知等偏好修改后立即更新 UI。
- 偏好保存成功后保持 daemon 返回值。
- 偏好保存失败后回滚旧值并显示错误。
- 语言切换失败时，全局文案从新语言回滚到旧语言。
- DOM 需要验证 `aria-label`、`aria-pressed`、`aria-checked`、disabled/pending 标记和错误提示角色。

daemon/bridge 测试：

- preferences 仍通过 daemon API 和 SQLite 保存。
- profile 通过 daemon API 和 SQLite 保存，desktop 不再只用本地 React profile 作为生产 source of truth。
- profile PATCH 支持 `displayName` 和 `avatar`，不支持 handle mutation。
- preferences PATCH 部分更新保留未修改 preference 字段。
- profile PATCH 部分更新保留未修改 profile 字段。
- 非法 locale 或非法 preference 值不污染旧偏好。
- 不新增 production JSON preferences 写入路径。

## 验收标准

1. 设置页里偏好项没有保存按钮，选择后即时生效并保存。
2. 账户显示名、成员详情和设备名称都使用字段级显式保存。
3. 账户 handle 只读展示；头像 preset 点击即保存，失败回滚。
4. 用户能从 UI 明确区分即时偏好、即时头像选择和实体字段编辑。
5. 保存失败不会静默丢失输入，也不会让 UI 长期停留在未确认状态。
6. 所有新增或调整行为都有单元测试覆盖，UI 行为有 DOM 断言。
