# Slei 全站 EinUI 重构设计

## 背景

Slei 桌面端近期已经将部分 UI primitive 迁向 EinUI / liquid glass 风格，例如 tabs、switch、select、separator、button 等组件。但当前代码仍处于半迁移状态：

- `apps/desktop/src/app/app.css` 中保留大量 `--slei-*`、soft/neumorphic 阴影、圆角和旧兼容 token。
- `components/ui/*` 中混合了 shadcn 默认结构、手写 glass 样式、Slei 私有 token 和旧 Radix 聚合包导入。
- 页面层仍有较多旧 surface class、`SoftPanel` 调用和直接断言旧视觉 class 的测试。
- 图标依赖仍以 `@tabler/icons-react` 为主，而 EinUI registry 组件以 `lucide-react` 为主。

本次重构目标是一次性完成全站视觉基座迁移：不再在旧 Slei soft UI 上叠加 glass，而是将桌面端统一切换到 EinUI dark-first liquid glass 体系。

参考资料：

- https://ui.eindev.ir/docs/theming
- https://ui.eindev.ir/docs/dark-mode
- https://ui.eindev.ir/docs/registry

## 目标

本次重构采用“一次性全站迁移，内部按层推进”的策略。最终结果需要满足：

1. 桌面端视觉基座切换为 EinUI dark-first liquid glass。
2. token、primitive 组件、页面调用点、通知、图标、依赖和审计测试全部进入新体系。
3. `--slei-*` 和 legacy compatibility token 清理干净。
4. `@tabler/icons-react` 删除，图标统一迁到 `lucide-react`。
5. `radix-ui` 聚合包删除，改用 `@radix-ui/react-*` 独立包。
6. `SoftPanel` 删除，调用点迁到 EinUI card / glass card 体系。
7. 页面不再依赖旧 soft/neumorphic 的自定义 shadow、radius、surface token。
8. daemon、SQLite、路由、任务、频道、agent、多 agent flow 等业务架构不变。

不纳入范围：

- 不重做信息架构。
- 不改变产品功能和 daemon 数据流。
- 不引入 mock/demo 数据填充 production UI。
- 不把业务规则从 daemon 移到 React 组件。

## 迁移层次

### 1. 依赖与 registry 基座

先建立 EinUI registry 组件来源和依赖基线：

- 配置 shadcn / EinUI registry。
- 以 shadcn CLI 安装的 EinUI registry 组件为基准。
- 新增 `lucide-react`。
- 新增 `framer-motion`，保留 EinUI registry 组件原生 motion 行为。
- 用 `@radix-ui/react-*` 独立包替换 `radix-ui` 聚合包。
- 删除 `@tabler/icons-react`。
- 清理不再使用的视觉依赖。

依赖迁移必须同步代码导入，不能只改 `package.json`。

### 2. 主题 token 重建

`apps/desktop/src/app/app.css` 需要从旧 Slei soft/neumorphic token 改为 EinUI dark-first 主题：

- dark-first 背景采用 EinUI 推荐的 slate / purple / slate 渐变基调。
- 保留 light / dark / system 主题偏好，默认值改为 dark。
- dark mode 是主体验；light mode 只需保证可读、可点、焦点可见，并使用较弱 glow。
- 保留 shadcn / Tailwind 必要 semantic token，例如 `--background`、`--foreground`、`--card`、`--popover`、`--primary`、`--border`、`--ring`。
- semantic token 要映射到 EinUI 视觉，不再映射到 Slei soft/neumorphic 风格。
- 核心 glass token 包括：
  - `--glass-bg`
  - `--glass-border`
  - `--glass-blur`
  - `--glow-cyan`
  - `--glow-purple`
  - `--glow-pink`
  - `--text-primary`
  - `--text-secondary`
  - `--text-muted`

需要删除的全局视觉 token：

- 所有 `--slei-*` token。
- legacy compatibility token，例如旧兼容层里的 `--color-*`、旧 `--radius-*`、旧 `--shadow-*`、旧 `--padding-*`、旧 `--duration-*` 等。
- `slei-raised-*`、`slei-inset-*` 等 Tailwind utility。
- 依赖 `shadow-[var(--slei-*)]` 的页面或组件样式。

注意：Tailwind v4 / shadcn 必需的 `@theme inline` 映射不属于 legacy compatibility token。例如 `@theme inline` 中用于生成 Tailwind utility 的 `--color-*`、`--radius-*`、`--shadow-*` 映射可以保留，但它们必须映射到 EinUI / shadcn semantic token，不能再指向 Slei soft/neumorphic 或旧兼容变量。审计测试应禁止旧兼容层和旧视觉 token 回流，而不是误杀 Tailwind v4 必需映射。

动画 token 可以保留，但应是通用命名，例如 dropdown、modal、icon、focus transition。动画逻辑可以保留，不能继续依赖 `--slei-*`。

### 3. Primitive 组件替换

以下组件全局替换为 EinUI registry 版本或以 registry 为基准的项目内必要适配版：

- accordion
- alert
- alert-dialog
- avatar
- badge
- button
- card
- checkbox
- dialogs
- dropdown-menu
- input
- label
- popover
- radio
- scroll-area
- select
- separator
- sheet
- skeleton
- switch
- tabs
- textarea
- tooltip
- notification

如果 `components/ui/*` 中存在以上列表之外的 primitive，也必须在实施前清点并做出明确处理：迁到 EinUI registry 对应组件、以 registry 风格重写，或记录保留理由。不能因为组件不在用户最初列举中就保留旧 Radix 聚合包、Tabler 图标或旧 Slei surface 样式。

原则：

- 以 EinUI API、props、默认样式为主。
- 页面调用点跟随 EinUI API 调整，不保留旧 Slei primitive API 的长期兼容。
- 保留必要的 `data-slot`、a11y 属性、受控/非受控行为、Radix composition 能力。
- overlay 组件必须保持 keyboard、focus trap、Esc、outside click、disabled、aria-invalid、aria-describedby 等关键行为。
- EinUI registry 使用 `framer-motion` 的组件保留 motion 行为，不改写为 CSS。

### 4. Slei shared components 整理

`SoftPanel` 本身只是 `section + variant className + data-slei-panel/data-variant`，没有业务逻辑或组合小组件，因此删除：

- 删除 `apps/desktop/src/components/SoftPanel.tsx`。
- 删除 `SoftPanel` 导出。
- 删除或改写 `SoftPanel` 测试。
- 所有调用点迁到 EinUI `GlassCard` / `Card`。

以下 shared components 保留，因为它们包含业务语义、可访问性或交互逻辑，但内部要改用 EinUI primitives 和 lucide：

- `Empty`
  - 保留空状态结构和现有插图资源。
  - framed 状态改用 EinUI card。
- `PreferenceRow`
  - 保留 label / description / error / aria 绑定逻辑。
  - 视觉只做布局，不建立独立风格系统。
- `TooltipButton`
  - 保留 tooltip + button + ripple + disabled/a11y 组合。
  - 内部使用 EinUI button / tooltip。
- `StatusBadge`
  - 保留 Slei 运行态、任务态、审批态等语义映射。
  - 视觉使用 EinUI badge 和 glow/status 风格，不再使用旧 token。
- `PageHeader`
  - 保留标题、副标题、actions、图标布局。
  - 图标迁到 lucide。
- `DetailBlock`
  - 保留 title / description / action / value / children 结构。
  - 视觉使用 EinUI card 或简化布局。
- `MemberAvatar`
  - 保留成员头像业务逻辑和 DiceBear 生成逻辑。
  - UI wrapper 使用 EinUI avatar。
- `SleiIcon`
  - 可作为业务图标名称映射层保留。
  - 底层必须全部迁到 `lucide-react`。
  - 禁止直接或间接依赖 Tabler。

### 5. 页面调用点迁移

页面层只负责布局、密度、状态表达和必要响应式，不负责复刻旧视觉系统。

需要清理：

- 旧 `slei-*` visual class。
- `bg-muted/40`、`bg-card/80` 等用于复刻旧 surface 的页面级 class。
- 自定义 shadow / radius / glass token。
- `slei-raised-*`、`slei-inset-*`、`shadow-[var(--slei-*)]`。
- 旧 `SoftPanel` surface 调用。

允许保留：

- 页面布局 class，例如 grid、flex、gap、min/max width、responsive tracks。
- 业务状态颜色，但应使用 Tailwind / shadcn / EinUI token 或局部常量。
- 业务必要的 data-testid / data-*，但不能继续表达旧视觉系统。
- 动画相关逻辑，例如 tooltip button ripple、modal/dropdown transition、icon swap。

重点页面需要逐一覆盖：

- Chat
- Members
- Tasks
- Settings
- Search
- Computers
- App frame / sidebar / global navigation

## 数据流和架构边界

本次重构只改 desktop UI 视觉与组件层：

- daemon 仍是业务数据 source of truth。
- 页面继续接收现有 props / DTO。
- 页面继续触发现有 daemon command / API。
- 不把 agents、channels、messages、tasks、workspace、settings 等生产数据规则写进 React 组件。
- 不改变任务卡、频道消息、coordinator 路由、多 agent flow 的信息结构。
- 不改变 SQLite 持久化策略。

主题偏好保留现有 light / dark / system 流程：

- 默认值改为 dark。
- DOM root 继续同步 `.dark` 或 `.light` class。
- system mode 跟随系统切换。
- light mode 使用 EinUI light 变量覆盖，保证可读和可交互。

## 通知迁移

现有 `Toast.tsx` 迁到 EinUI `glass-notification`：

- notification 视觉和组件结构以 EinUI 为准。
- 保留 Slei 现有通知触发、队列、显示时长、手动关闭、自动消失等产品行为。
- 保留 `TOAST_VISIBLE_MS` 语义，除非实现计划中有明确替代。
- 测试需要覆盖显示、关闭、自动消失、多条通知和不同 toast type。

## 图标迁移

图标统一迁到 `lucide-react`：

- 删除所有 `@tabler/icons-react` import。
- `SleiIcon` 的业务名称映射改为 lucide 图标。
- 直接在组件内使用的图标也改为 lucide。
- 删除 `@tabler/icons-react` 依赖。
- 增加审计测试禁止 Tabler 回流。

## 错误处理和可访问性

迁移后必须验证关键交互：

- dialog / alert-dialog 的 focus trap、Esc、outside click、close button。
- select / tooltip / popover / dropdown 的 keyboard navigation、portal、focus visible。
- input / textarea / checkbox / radio / switch 的 disabled、aria-invalid、aria-describedby。
- notification 的手动关闭、自动关闭、队列行为。
- light / dark / system 切换后焦点、文本、边框和重要状态都可见。

如果某个 EinUI registry 组件缺少 Slei 必需行为，允许做薄适配。适配必须局限在组件内部，不能重新引入全局 Slei token 或旧 visual compatibility 层。

## 测试策略

### 单元测试

需要更新或新增 primitive 测试：

- DOM 节点和关键 `data-slot`。
- variant / size 行为。
- disabled / focus / aria-invalid。
- overlay open / close。
- motion 或 transition 关键 class / 行为。

需要更新 shared component 测试：

- `TooltipButton`：tooltip、ripple、disabled。
- `StatusBadge`：状态映射和新 badge 结构。
- `Empty`：framed 使用 EinUI card，插图仍渲染。
- `Toast` / notification：显示、关闭、自动消失、多条通知。
- `SleiIcon`：所有名称映射到 lucide，且无 Tabler import。

页面测试继续覆盖：

- DOM 渲染。
- 空状态。
- loading / error / disabled。
- 关键交互。
- UI 任务必须验证对应 DOM 节点渲染与关键交互。

测试不再断言旧 `slei-*` visual class。

### 审计测试

新增或加强 `ui-primitive-audit.test.tsx` 等审计测试，禁止：

- `@tabler/icons-react`
- `radix-ui` 聚合包 import
- `--slei-*`
- legacy compatibility 层里的旧 `--color-*` UI token
- legacy compatibility 层里的旧 `--radius-*` UI token
- legacy compatibility 层里的旧 `--shadow-*` UI token
- legacy compatibility 层里的旧 `--padding-*` UI token
- `SoftPanel` 文件、导出和调用
- `slei-raised-*`
- `slei-inset-*`
- `shadow-[var(--slei-*)]`
- 页面级旧 soft/neumorphic surface class 回流

审计测试必须允许 Tailwind v4 / shadcn 必需的 `@theme inline` 映射存在，例如 `--color-background`、`--color-card`、`--radius-lg` 等。禁止目标是旧兼容层、旧 Slei token 和旧视觉 utility，而不是 Tailwind v4 的正常主题桥接。

### 全量验证

实现完成后至少运行：

```bash
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop lint
```

必要时运行根级：

```bash
pnpm test
```

UI 验证需要启动 App，检查至少：

- Chat
- Members
- Tasks
- Settings
- Search
- Computers
- dark / light / system 切换
- dialog / alert-dialog
- select
- tooltip
- notification

## 验收标准

本次重构完成时必须满足：

1. 桌面端全站视觉基座为 EinUI dark-first liquid glass。
2. light / dark / system 主题偏好仍可用，默认 dark。
3. `@tabler/icons-react` 不再存在于依赖或源码导入中。
4. `radix-ui` 聚合包不再存在于依赖或源码导入中。
5. `lucide-react` 和 `framer-motion` 按 EinUI registry 需要引入并真实使用。
6. `SoftPanel` 文件、导出、测试和调用全部移除或迁移。
7. `--slei-*` 和 legacy compatibility token 清理完成。
8. 页面不再依赖旧 soft/neumorphic surface class。
9. notification 视觉迁到 EinUI `glass-notification`，Slei 通知行为不回退。
10. 所有相关单元测试、交互测试、审计测试通过。
11. Production UI 不引入 mock、demo、sample、fake seed 数据。

## 风险和缓解

### 风险：一次性迁移范围过大

缓解：

- 虽然最终作为一次性全站迁移完成，但执行时按层推进。
- 每层完成后运行对应测试。
- 最终以全量测试和审计测试收口。

### 风险：EinUI registry API 与现有页面调用差异大

缓解：

- 以 EinUI API 为准，页面调用点同步迁移。
- 仅保留 Slei 业务 shared components 的必要适配。
- 不为 primitive 建长期兼容外壳。

### 风险：删除 legacy token 导致页面细节回归

缓解：

- 页面只保留布局和业务状态 class。
- 对关键页面做 DOM 和交互验证。
- 审计测试禁止旧 token 回流。

### 风险：图标迁移导致视觉语义丢失

缓解：

- `SleiIcon` 保留业务名称映射层。
- 每个业务图标名称选择语义相近的 lucide 图标。
- 测试覆盖关键图标渲染。

### 风险：通知系统迁移破坏生命周期

缓解：

- 只替换视觉和组件结构。
- 保留现有队列、显示时长、关闭行为。
- 单测覆盖自动消失和手动关闭。
