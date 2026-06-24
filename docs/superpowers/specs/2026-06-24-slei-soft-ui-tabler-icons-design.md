# Slei Soft UI 与 Tabler 图标全局重塑设计

- 日期：2026-06-24
- 状态：已获用户分段确认，待规格审查
- 适用范围：`apps/desktop` React/Tauri 桌面前端
- 设计方向：shadcn/ui + 中拟物 Soft UI + wellness 主色系 + `@tabler/icons-react`

## 目标

将 Slei 现有桌面 UI 重塑为柔和、舒缓、有实体层次的 Soft UI 视觉系统。用户提供的 health/wellness landing page 提示词仅作为视觉气质来源：柔和、calming、wellness、neumorphic、feature showcase 的清晰层次，而不是新增营销 landing 页。

最终交付必须覆盖完整 C 范围：

- 全局主题 token、shadcn primitives、导航 rail、通用阴影与拟物效果。
- Chat、Tasks、Members、Computers、Settings、Search、Saved、Empty、Diagnostics、Onboarding 等主要页面骨架。
- 消息、任务卡、成员详情、设置表单、抽屉、弹窗、状态徽章、Toast、空状态等高频组件细节。
- 依赖和源码中移除 `lucide-react`，统一迁移到 `@tabler/icons-react`。

实施可以分阶段推进，但最终交付前不能留下半套新 UI 与半套旧 UI 混搭。

## 既有上下文

本设计继承 `docs/superpowers/specs/2026-06-04-slei-shadcn-ui-rebuild-design.md` 的方向：

- 桌面前端已迁向 shadcn/ui、Tailwind v4、Radix 和本地 `components/ui/*` primitives。
- `components/ui/*` 应保持通用 UI primitive，不包含 Slei 业务逻辑。
- Slei 业务组合留在 `apps/desktop/src/components/*`、`apps/desktop/src/features/*` 和 app shell。
- daemon bridge、路由语义、任务/消息/成员/电脑节点业务规则不属于本次视觉重塑范围。

本次重塑是在 shadcn 化之后继续统一视觉语言，不重新引入旧 UI 包，不新增 production mock，不改变 daemon 作为 source of truth 的架构。

## 决策

- 采用“系统化分阶段重塑，最终一次完整交付”。
- 视觉强度选择中拟物：有明显软凸、内凹和柔和层次，但保持桌面工具效率。
- 配色切换为 wellness 主色系：雾蓝、鼠尾草绿、浅青绿为基调，当前暖米色/琥珀退场，仅少量保留为提醒色。
- 全局主图标库改为 `@tabler/icons-react`。
- `lucide-react` 必须从 `package.json`、lockfile 和源码 import 中移除。
- 导航、卡片标题、状态徽章尽量使用 filled 或 filled/duotone 感的 Tabler 图标；普通工具按钮优先使用 outline，避免交互区过重。
- 凡两个以上位置需要同一种视觉或交互模式，必须复用组件、variant 或 token，不在页面里复制 class recipe。

## 架构边界

### 保持不变

- daemon 业务逻辑、状态变更、路由决策、持久化、幂等、重置和数据恢复仍由 daemon 处理。
- SQLite、storage repository、daemon bridge DTO、现有路由语义不因 UI 重塑改变。
- Chat 发送、附件上传、mention、任务回复、成员管理、电脑节点管理、保存消息、通知、runtime setup 等行为保持现有 callback wiring。
- 任务卡片和任务源消息关系继续遵守 `docs/architecture/0006-task-source-message-card.md`。
- 频道发言、coordinator 路由、多 agent 协作继续遵守 `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`。

### UI 分层

- `apps/desktop/src/components/ui/*`：shadcn primitive 层，只放通用组件、variant、可访问性结构。
- `apps/desktop/src/components/*`：Slei 复用组合层，例如 `SleiIcon`、`SoftPanel`、`StatusBadge`、`PageHeader`、`EmptyStateFrame`、`TooltipButton`。
- `apps/desktop/src/features/*`：页面和业务组合层，只做展示、用户输入、轻量 view-model 和 daemon command/API 触发。
- `apps/desktop/src/app/app.css`：保留全局 token、base、scrollbar、markdown、reduced motion、必要 shell sizing；能迁移到组件 variant 的 `.slei-*` 视觉样式逐步收敛。

UI shell 可以保留本地 tab、drawer 开关、toast、表单临时输入、格式化时间等轻量状态；不能把 agents、channels、messages、tasks、workspace、settings 等生产数据规则写入 React 组件。

## 视觉系统

### 色彩

Light theme 是主场：

- 背景：极浅 blue-green wash，避免纯白刺眼。
- Surface：浅青灰或薄荷白，用于主 workspace、sidebar、card。
- Primary：较深 teal/cyan，用于主操作、链接、focus、active 文本。
- Secondary：sage/mint，用于选中背景、温和强调、辅助状态。
- Status：success 使用 green/teal，running 使用 cyan/blue，approval 使用柔和 amber，failed 使用清晰 red/coral。
- 文本必须满足普通文本 4.5:1 对比度，不用低对比灰绿表达正文。

Dark theme 不用纯黑：

- 背景使用深青灰/墨绿。
- Surface 使用稍亮的 blue-green slate。
- 阴影减少依赖，更多使用边框、微亮填充和 alpha 层次区分。
- 状态色保持可读，不只靠颜色表达状态。

### 拟物层次

- Raised：用于主导航 active、主要卡片、重要 CTA，使用柔和外阴影、细边框和微渐变。
- Inset：用于输入框、搜索框、composer、active segmented tab，使用轻内阴影和清晰 focus ring。
- Flat-soft：用于高密度列表行、消息行、文件项，保持紧凑，只在 hover/selected 时出现 soft 层次。
- Overlay：Dialog、Sheet、Popover、Toast 使用同一 surface、ring 和阴影规则。

拟物效果不能牺牲可访问性。纯 neumorphism 的低对比“只靠阴影区分”禁止用于关键信息和表单状态。

### 尺寸、圆角、动效

- 普通卡片和面板圆角以 `12px-16px` 为主。
- 重复卡片、列表项和工具面板避免过度圆角。
- 按钮和 badge 可以更圆，但不让整个应用变成大量胶囊。
- 动效使用 150-250ms 的 color、shadow、opacity、轻微 press/inset 变化。
- 保留并验证 `prefers-reduced-motion`，不得加入强制滚动、弹跳或大量装饰动效。

### 字体

继续使用现有 Outfit 优先策略，中文回退到系统字体。不要引入 landing page 式 serif 字体，以免破坏桌面密度、中文阅读和现有测试稳定性。

## 图标系统

### 依赖与迁移

- 添加 `@tabler/icons-react`。
- 移除 `lucide-react`。
- 全仓源码不得继续 import `lucide-react`。
- lockfile 必须反映依赖替换。

### 封装

新增统一图标层，建议包含：

- `SleiIcon`：统一 `size`、`stroke`、`aria-hidden`、className、filled/outline 规则。
- `icons.ts` 或同等映射：集中定义 `chat`、`tasks`、`members`、`computers`、`settings`、`search`、`saved`、`delete`、`copy`、`send`、`status` 等产品语义到 Tabler 图标组件。

页面和业务组件优先消费语义图标映射，减少各处裸 import。确实只在单处使用的临时图标可以直接 import，但必须遵守尺寸和 aria 规则。

### 使用规则

- 导航：优先使用 filled 图标，active 状态更饱满。
- 卡片标题：优先使用 filled 或 filled/duotone 感图标，并放入 soft icon tile。
- 状态徽章：优先使用 filled 或实心小 glyph，增强状态识别。
- 工具按钮：默认使用 outline，保持轻量和可扫读。
- 尺寸建议：nav 22-24px，card title 18-20px，toolbar 16px，badge 12-14px。
- stroke 建议 1.75-2，按位置统一。
- 装饰图标必须 `aria-hidden`；纯图标按钮必须有 `aria-label`。

## 组件设计

### shadcn primitive

以下 primitives 需要统一 soft variant：

- `Button`：主按钮 soft raised，outline/ghost 保持轻量，active/pressed 可轻内凹；保留 loading、disabled、focus-visible。
- `Card`：增加或整理 `surface`、`raised`、`inset`、`interactive` 等变体；标题支持 icon slot 或组合组件。
- `Input`、`Textarea`、`Select`：使用轻内凹 surface，focus 时出现清晰 ring。
- `Badge`：基础 badge 提供 filled/soft/outline 状态，为 `StatusBadge` 提供底座。
- `Tabs`：用于频道嵌入视图、任务视图、设置等，active 项呈现 soft segmented/inset 状态。
- `Dialog`、`Sheet`、`Popover`、`Tooltip`、`AlertDialog`：统一 overlay、surface、关闭按钮、shadow/ring。

这些 primitives 不写 Slei 业务规则。

### Slei 复用组件

建议新增或整理以下 Slei 复用组件：

- `SleiIcon` / `ProductIcon`：图标统一入口。
- `SoftPanel`：页面区域和 sidebar 区块。
- `SoftCardHeader`：带 icon tile、title、description、action slot 的卡片头。
- `StatusBadge`：run/task/member/node/permission 等状态统一颜色和图标。
- `PageHeader`：各 feature header 统一布局、title、subtitle、actions。
- `EmptyStateFrame`：统一 empty/offline/error/search/permission 等空状态结构。
- `SoftListItem`：channel、DM、saved message、workspace file、search result 等高密度列表项。
- `PreferenceRow`：Settings 页面复用偏好项。

已有 `Empty`、`Toast`、`DetailBlock`、`EditableDetailField`、`TooltipButton`、`MemberAvatar`、`StatusIndicators` 应纳入新视觉，避免共享组件游离在旧风格里。

## 页面落地

### Shell / Navigation

- 左侧 rail 改为柔和实体导航，active 项使用 Tabler filled 图标和 soft active 状态。
- Context sidebar 使用统一 soft surface，不改变频道、成员、电脑、设置导航行为。
- Resize handle 保持 keyboard/focus 可见，并贴合新 surface。
- `SleiAppFrame` 中重复的导航按钮、sidebar header、排序按钮、保存入口等视觉模式应抽成复用组件或局部小组件。

### Chat

保持桌面密度，不把消息变成 oversized casual bubbles。

覆盖：

- Channel header、copy/action buttons、channel/member 状态。
- Chat/tasks embedded tabs。
- Timeline、message row、task root entry、delegation/approval/tool call blocks。
- Composer、attachment chips、mention/slash pickers。
- Permission card、interactive card、saved message action。
- Thread/session drawer。

消息和任务入口必须继续遵守 daemon/source message 语义，UI 只展示 daemon 返回的数据并触发命令。

### Tasks

- Board/List、TaskFilters、TaskCard、TaskStatusBadge、AttentionBadge、TaskThreadDrawer 全部采用 soft card、segmented tabs、filled 状态 badge。
- 状态颜色和图标从统一状态 token/组件取，不在页面散写。
- 任务回复和状态变更 callback 不改变。

### Members

- 成员详情使用 profile header、runtime summary、profile/config/skills/capabilities/permission/workspace 软卡片。
- 成员列表、创建入口、删除确认、消息入口统一图标和按钮风格。
- workspace 文件列表保持紧凑可扫读，不做过度大卡。
- 编辑字段继续使用 daemon update callback 和现有错误展示语义。

### Computers

- 节点列表、节点详情、runtime 状态、创建/删除/重命名、refresh runtime 使用 soft card 和 filled 状态 badge。
- Device/server/bot 图标从 Tabler 语义映射取。
- 不改变 runtime setup 和 node rename/delete/create 行为。

### Settings

- 设置导航、profile、language/timezone、appearance、notifications、about 改为统一 `PreferenceRow` / soft card。
- Appearance 继续遵守现有 light/dark 逻辑；legacy `system` 或 `highContrast` 仍按现有 normalize 规则处理。
- 表单错误、pending 状态、disabled 状态必须清晰可见。

### Search / Saved / Empty / Diagnostics / Onboarding

- Search 输入、过滤器、结果 row、highlight、loading/empty/error 状态纳入统一 soft list 和 empty frame。
- Saved messages 使用 `SoftListItem`，保留 unavailable 状态。
- Empty、offline、error、permission、search-empty 统一图标、插图和文案布局，不引入 fake production 数据。
- Runtime onboarding、crash screen、diagnostics error/export dialogs 使用统一 alert/dialog/panel 规则。

## CSS 收敛

`app.css` 保留：

- Tailwind/shadcn imports。
- `:root`、`.dark`、`@theme inline` token。
- body/html/#app sizing、font、scrollbar。
- focus-visible、selection、reduced motion。
- markdown/code/table 的全局内容样式。
- 少量无法用 Tailwind 表达或跨组件共享的基础变量。

逐步移除或弱化：

- 旧 `.slei-*` 中仅表达按钮、卡片、列表、dialog、badge、tabs 视觉的样式。
- 页面级复制的 shadow/radius/background recipes。
- 与新 token 冲突的暖米色/琥珀主色。

## 测试与验证

### 单元与组件测试

必须更新或新增测试覆盖：

- `Button`、`Card`、`Input`、`Badge`、`Tabs`、`Dialog/Sheet` 等 primitives 的 DOM slot、variant、aria、disabled/loading/focus 相关行为。
- `SleiIcon`、`StatusBadge`、`EmptyStateFrame`、`Toast`、`TooltipButton` 等 Slei 复用组件。
- 图标映射中关键语义图标能渲染，且纯图标按钮有 accessible name。

### 页面测试

保留并更新现有测试，重点覆盖：

- `SleiAppFrame`：导航、sidebar、排序、resize、modal 入口。
- Chat：消息、composer、attachments、tabs、thread/session drawer、saved/message actions、interactive/permission cards。
- Tasks：board/list 切换、任务卡、状态 badge、thread drawer、回复。
- Members：成员列表、详情、编辑、删除、消息、workspace。
- Computers：节点列表、详情、创建、删除、重命名、runtime 状态。
- Settings：profile、locale/timezone、appearance、notifications、about。
- Search/Saved/Empty：关键 DOM、loading/error/empty、结果点击。

### e2e 与可访问性

至少运行与 UI 强相关的 desktop 套件：

- accessibility
- design-system
- chat
- tasks
- members
- settings
- computers
- empty-state

如果时间允许，运行完整 `pnpm --filter @slei/desktop test` 和 workspace 相关验证。

### 依赖验收

- `pnpm --filter @slei/desktop typecheck` 通过。
- `rg "lucide-react"` 在 production/test 源码和 package 文件中无结果。
- `@tabler/icons-react` 已在依赖和 lockfile 中出现。
- 不新增 production mock、demo、sample、fake seed 数据。
- 不新增 JSON production 持久化路径。

### 视觉验收

- Light/dark 都可读，普通文本满足对比度。
- 375px、768px、1024px、1440px 宽度无横向溢出。
- 按钮、badge、tab、列表项文字不溢出、不遮挡。
- 主要页面不出现旧/新风格混搭。
- Hover/active/focus 不造成布局跳动。
- `prefers-reduced-motion` 生效。

## 实施顺序

1. 建立新 token 与 soft UI 基础样式，调整 shadcn primitives。
2. 引入 `@tabler/icons-react`，建立图标封装和语义映射，迁移并移除 `lucide-react`。
3. 重塑共享 Slei 组件：Toast、Empty、TooltipButton、DetailBlock、EditableDetailField、StatusBadge、SoftPanel 等。
4. 重塑 Shell、navigation rail、context sidebar、resize handle。
5. 重塑 Settings、Members、Computers 这些结构化页面。
6. 重塑 Tasks、Search、Saved、Empty、Diagnostics、Onboarding。
7. 重塑 Chat 的 dense interaction surfaces：timeline、composer、cards、drawer、pickers。
8. 收敛旧 `.slei-*` CSS，清理重复 class recipe。
9. 跑完整验证，修复测试、可访问性和视觉回归。

## 非目标

- 不新增 landing/onboarding 营销首屏。
- 不重写 Rust、daemon、protocol、storage。
- 不改变频道路由、coordinator、多 agent 协作、任务卡源消息语义。
- 不新增设置分类、成员能力或电脑节点业务功能。
- 不引入 production mock 或本地 JSON 持久化。
- 不新增除 light/dark 之外的第三套主题。

## 完成标准

任务只有在以下条件全部满足时才视为完成：

- 完整 C 范围页面和高频组件都迁移到新 soft UI。
- `lucide-react` 已彻底移除，Tabler 图标系统生效。
- shadcn primitives 与 Slei 复用组件承担重复视觉模式。
- daemon/source of truth 架构没有漂移。
- 单元、组件、页面和 UI 相关 e2e/可访问性测试通过或有明确记录。
- 交付后主动询问用户是否合并到 `master` 或其他分支。
