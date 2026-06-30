# Slei 左侧导航与频道标题重构设计

## 背景

当前桌面端左侧由最左侧 primary rail 和 context sidebar 组成。聊天视图中，context sidebar 同时承担频道、收藏、私聊、排序、创建和删除等入口，右侧频道标题区域又通过单独的成员侧栏管理频道成员。用户希望将左侧重构为更接近单栏工作区导航的形态：去掉最左侧 menu，频道和私聊成为左栏主体，上方只保留高频功能入口，低频设置收敛到底部。

本设计遵守 Slei 架构约束：UI shell 只展示 daemon 返回的数据、触发 daemon command/API，不把频道、私聊、成员、任务或 profile 的生产规则写入 React 本地状态。频道消息路由、任务、成员关系和 profile 持久化仍以 daemon/SQLite 为 source of truth。

## 目标

- 去掉最左侧 primary rail，改为单个左侧工作区 sidebar。
- 左栏顶部只保留 `搜索` 和 `任务` 两个主入口。
- 左栏主体展示频道和私聊，条目只展示名称。
- 频道标题右侧保留 `+` 创建频道和排序按钮；私聊标题右侧保留排序按钮。
- 频道/私聊低频操作改为右键菜单。
- 左下角展示当前用户头像和名称，右侧设置 icon 弹出低频管理菜单。
- 支持用户自定义个人显示名称、头像预设和本地图片头像上传。
- 右侧频道 header 按截图优化频道标题、副标题和成员展示。
- 去掉现有频道成员侧栏，改为 header 成员 group、hover 信息卡、加号添加成员。

## 非目标

- 不改频道消息路由、Agent claim、任务创建、任务状态迁移或 multi-agent 流转。
- 不新增前端 mock、fixture fallback 或 localStorage 生产数据源。
- 不改 daemon 对频道成员关系的权限和校验规则。
- 不在本任务中重做搜索、任务、成员管理、运行设备或设置页面本身。

本地图片头像上传是本次用户明确要求的交付范围。实现计划可以把它作为独立阶段排在左栏和频道 header 之后，但同一轮交付必须包含 profile 图片头像端到端保存、读取和渲染。

## 单栏工作区导航

`SleiAppFrame` 从 `primary rail + context sidebar + resize handle + workspace` 调整为 `workspace sidebar + resize handle + workspace`。`activeView` 仍保留 `chat/search/tasks/members/computers/settings`，右侧主内容继续复用现有 route 渲染；只是常驻入口从 rail 移到新 sidebar。

左栏结构：

1. 顶部工作区区域：展示产品/工作区标识，并提供 `搜索`、`任务` 两个主入口。
2. 频道分组：标题为 `频道`，右侧保留创建频道 `+` 和排序按钮。
3. 私聊分组：标题为 `私聊`，右侧保留排序按钮。
4. 底部个人区：左侧显示当前用户头像和名称，右侧显示设置 icon。

频道条目只展示 `# 名称`，可以保留未读 badge，但不展示项目说明、描述或其他副信息。私聊条目只展示成员名称，不展示成员头像、描述或 role。选中态沿用现有 `SelectableCard` 风格。

搜索和任务按钮点击后切换到现有 `search`、`tasks` view。成员管理、运行设备和设置不再常驻展示，而是通过底部菜单进入。

## 频道与私聊操作

频道标题右侧保留：

- `+`：打开现有创建频道 modal。
- 排序按钮：沿用现有 `slei:sidebar-sort:channels` localStorage 偏好。

私聊标题右侧保留：

- 排序按钮：沿用现有 `slei:sidebar-sort:direct-messages` localStorage 偏好。

频道条目右键菜单包含：

- 编辑频道信息或关联项目。
- 删除频道。默认 `all` 频道不显示删除入口。

私聊条目右键菜单包含：

- 打开成员资料。
- 打开私聊。

右键菜单应使用现有 Radix/shadcn 菜单组件，并提供键盘可访问的等价触发方式：条目获得焦点时可以通过条目内的更多按钮打开菜单，同时支持 `Shift+F10` 打开同一菜单。功能不能只能由鼠标右键访问。

## 底部个人区与设置菜单

底部固定展示当前用户信息：

- 头像：使用 `MemberAvatar` 风格。profile 不可用时使用 `localHumanPresentation` fallback。
- 名称：展示 `profile.displayName`，避免展示 handle 造成视觉噪音。
- 设置 icon：点击后弹出 compact menu。

菜单项：

- `个人资料`：进入 settings 的 account panel。
- `成员管理`：切换到 members view。
- `运行设备`：切换到 computers view。
- `收藏消息`：打开 chat saved workspace。
- `偏好设置`：进入 settings 默认或 appearance panel。

这些入口只改变现有 view 或 workspace mode，不创建新的本地页面状态。

## 个人资料与头像上传

现有 settings account panel 已支持编辑显示名称和选择头像预设。本次保留这些能力，并新增本地图片头像上传。当前 daemon `settings_service` 只接受 `pixel-sun`、`pixel-moon`、`pixel-cube`、`pixel-spark` 预设 id；本任务需要扩展 profile avatar 合同以支持图片头像引用。

头像数据流：

1. 用户在 profile 面板选择头像预设或上传本地图片。
2. 预设头像继续通过现有 profile update 保存预设 id。
3. 本地图片头像通过新的 Tauri/daemon command 上传，输入包含文件名、MIME 类型和图片 bytes。daemon 负责校验、计算 sha256、保存文件，并返回新的 profile。
4. 图片保存到 app data 下的 profile avatar 资源目录，例如 `<slei-data>/profile/avatars/<sha256>.<ext>`。该目录属于 daemon 管理的 profile 资源，不是前端生产状态。
5. SQLite user profile 的 `avatar` 字段保存稳定引用，不保存绝对路径。图片头像引用格式为 `profile-image:<sha256>.<ext>`，例如 `profile-image:abc123.png`。预设头像仍使用现有 `pixel-*` id。
6. UI 渲染头像时根据 avatar 类型选择预设渲染或图片渲染：`pixel-*` 使用现有预设；`profile-image:*` 通过安全的 Tauri/daemon 资源解析入口转换为可显示的本地图片 URL；未知格式回退到 initials。

校验与错误处理：

- 只接受 PNG、JPEG、WebP，MIME 类型必须是 `image/png`、`image/jpeg` 或 `image/webp`，扩展名必须匹配 `.png`、`.jpg`、`.jpeg` 或 `.webp`。
- 上传原文件大小上限为 2 MiB。
- 解码后的宽高上限为 2048 x 2048，宽高必须都大于 0。
- sha256 文件名用于去重和避免用户文件名进入持久化引用。
- 上传失败时保留旧头像并显示本地化错误。
- profile 不可用时禁用上传与保存，并展示现有 profile unavailable 状态。

头像上传不得只写入 React state、localStorage 或散落 JSON 文件。上传后，底部个人区、消息作者展示和设置页头像应使用同一 daemon profile 数据。

## 频道 Header

右侧聊天频道 header 按截图优化为两端布局。

视觉参考截图：`/var/folders/7m/sf3m434s68n_z86ll9grxy1w0000gn/T/codex-clipboard-ecf9f642-5b4e-4fc5-a8db-e80d287c72dd.png`。实现不需要逐像素复刻，但应保留截图里的信息层级：左侧频道名和成员数量 pill，下一行轻量副标题，右侧紧凑成员头像 group 与加号入口。

左侧标题区：

- 第一行显示频道名，例如 `#dev`。
- 频道名旁显示成员数量 pill，例如 `4 Agent`。
- 第二行显示频道说明或关联项目摘要，使用更轻的 muted 文案。
- DM 标题保持私聊语义，不显示频道成员 group。

右侧成员区：

- 使用新的 `ChannelMemberGroup` 组件。
- 横向叠放最多 4 到 5 个成员头像或缩写。
- 头像信息来自 daemon member DTO，可展示 ready/joining 等轻量状态提示。
- group 最右侧固定一个 `+` icon，点击打开添加成员 modal。

## 成员信息卡与添加成员

去掉现有 `ChannelMemberPanel` 侧栏和 header toggle。频道主内容区不再为成员侧栏预留 grid column，聊天区始终占满主内容宽度。

`ChannelMemberGroup` 的每个成员头像支持 hover 和 keyboard focus 弹出信息卡。信息卡内容：

- 头像、名称、handle。
- role 或 description。
- channel readiness 状态。
- `移除成员` 操作。

移除成员：

- 点击信息卡中的移除按钮后展示二次确认。
- 确认后调用现有 `onChannelMemberRemove`。
- 是否允许移除默认成员、系统成员或当前成员，由 daemon/API 返回结果决定；UI 只负责展示错误 toast。

添加成员：

- group 最右侧 `+` 打开现有添加成员 modal。
- modal 继续支持多选可加入成员，调用现有 `onChannelMemberAdd`。
- 可加入成员列表仍由 daemon DTO 和现有 view-model 过滤得出，不引入 mock 成员。

## 错误与空状态

- daemon 离线或 profile 不可用时，左下角使用 fallback 用户展示；涉及 profile 保存的入口显示错误或禁用。
- 没有频道时，频道分组展示空状态，不注入默认假频道。
- 没有私聊时，私聊分组展示空状态或保持空列表，不注入假私聊。
- 频道没有成员时，header 成员 group 只展示 `+` 添加入口。
- 成员添加或移除失败时，保留当前 UI 状态并展示 toast。

## 测试计划

前端测试：

- `SleiAppFrame` 不再渲染旧 primary rail，布局列变为单 sidebar、resize handle、workspace。
- 顶部主入口只展示 `搜索`、`任务`。
- 频道和私聊条目只展示名称，不展示频道描述、关联项目、成员描述或头像。
- 频道标题保留 `+` 创建频道和排序；私聊标题保留排序。
- 频道右键菜单包含编辑和删除，且 `all` 不显示删除。
- 私聊右键菜单包含打开成员资料和打开私聊。
- 底部个人区展示头像、名称和设置 icon。
- 底部设置菜单能进入成员管理、运行设备、个人资料、收藏消息和偏好设置。
- profile 面板支持头像预设和本地图片上传入口；成功调用 profile 更新，失败展示错误。
- 频道 header 展示频道名、成员数量 pill、副标题和成员 group。
- 成员 group 的 `+` 打开添加成员 modal，并可提交添加。
- 成员头像 hover/focus 展示信息卡，信息卡中移除成员触发确认和 `onChannelMemberRemove`。
- 旧 `slei-channel-member-panel` 和 header toggle 不再渲染。
- 涉及 UI 的测试需验证 DOM 节点和关键交互。

daemon/API 测试：

- profile avatar 图片资源保存成功后，`listProfile` 返回稳定 avatar 引用。
- 重启 daemon 后头像引用仍可读取。
- 非图片、空文件和超大文件被拒绝。
- 头像预设更新和 displayName 更新的既有测试继续通过。

手工验收：

1. 宽屏和窄屏下左侧不出现旧 rail，左栏内容不重叠。
2. 搜索、任务、成员管理、运行设备、个人资料、收藏消息、偏好设置入口均能跳转到现有页面。
3. 频道创建、频道排序、私聊排序正常。
4. 频道/私聊右键菜单可用，默认频道不可删除。
5. 上传头像后，底部个人区、设置页和本地用户消息头像保持一致。
6. 频道 header 中成员 hover 信息卡、移除确认和添加成员 modal 可用。

## 实施注意事项

- 优先拆出 `WorkspaceSidebar`、`ChannelNavigationList`、`UserFooterMenu`、`ChannelMemberGroup`、`ChannelMemberCard` 等小组件，避免继续扩大 `SleiAppFrame.tsx` 和 `ChatPageView.tsx`。
- 复用现有 `MemberAvatar`、`SelectableCard`、toast、dialog、dropdown/popover 组件。
- 与 daemon 交互继续通过现有 bridge/API；新增头像上传也应走 Tauri/daemon command，不在前端直接写文件。
- 文档与测试默认使用中文文案。
