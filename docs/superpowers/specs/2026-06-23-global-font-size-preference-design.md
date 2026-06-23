# 全局字体大小偏好设计

## 背景

设置页已经提供“小 / 中 / 大”字体大小选项，并且 `appearance.fontSize` 已通过 daemon 偏好接口保存到 SQLite。当前问题在于前端只把字体大小映射成 `--slei-font-size` 变量，却没有把这个变量作为应用根字号应用到当前 shell 根节点；旧版 `.slei-shell` 样式仍有相关规则，但当前 React shell 根节点没有使用该 class。因此用户切换字体大小后，主要界面看起来没有变化。

## 目标

- 字体大小设置影响整个桌面应用的主要文字和控件，而不是只影响设置页或聊天正文。
- 复用现有 daemon / SQLite 偏好链路，不新增本地 JSON、mock 或独立持久化。
- 保持 UI shell 的职责为展示偏好结果和触发 daemon command，不把持久化规则下沉到 React 组件。
- 切换字体大小时沿用现有 optimistic update、保存成功 toast、失败回滚与错误提示行为。
- 补充严格测试，覆盖 DOM 渲染和关键交互。

## 非目标

- 不新增更多字号档位。
- 不调整主题、字体族、颜色 token 或布局密度。
- 不重写设置页结构。
- 不改 daemon 偏好 API，除非实现时发现现有契约无法保存 `fontSize`。

## 推荐方案

在全局 rem / text token 层应用字号偏好，并由 `SleiAppFrame` 负责同步。

`SleiAppFrame` 现在已经根据 `appearance.fontSize` 生成 `--slei-font-size`，值分别为 `14px`、`15px`、`16px`。实现时不能只把 `font-size` 加在应用容器上，因为 Tailwind 的 `text-sm`、`text-xs` 等工具类通常基于 `rem`，而 `rem` 相对的是 `html` 根字号，不是 app 容器字号。为了让显式使用 `text-*` 的导航、设置、聊天、任务等界面一起变化，应在应用运行期间同步全局字号来源，例如：

- 在 `document.documentElement` 上写入受控的 `font-size` / `--slei-font-size`，让 `rem` 工具类全局跟随；或
- 在 `app.css` 中重定义 Tailwind 文本尺寸 token，使 `--text-xs`、`--text-sm`、`--text-base` 等由 `--slei-font-size` 派生。

具体实现应选择与现有 Tailwind v4 / shadcn 配置最兼容的一种方式，并确保显式 `text-sm`、`text-xs`、`text-base` 的代表性节点会随设置变化。应用根节点仍可保留 `--slei-font-size` 和稳定的 `data-font-size="sm|md|lg"` 用于测试和可观测性。设置页当前局部的 `text-[var(--slei-font-size)]` 可以移除，避免字号来源重复。

## 备选方案

### 只作用于内容区

只给聊天、任务、设置等 workspace 区域应用字号，导航和控件保持固定。这个方案风险低，但会让部分界面变化、部分界面不变，和“全局”预期不一致。

### 新增 root class

新增 `font-sm`、`font-md`、`font-lg` 之类的 class，再由 CSS 选择器设置字号。这个方案可读，但会和现有 `--slei-font-size` 变量重复表达同一状态，增加维护面。

## 数据流

1. 用户在设置页点击“小 / 中 / 大”按钮。
2. `SettingsPageView` 调用 `onAppearanceChange`，传入包含新 `fontSize` 的完整 `AppearancePreferences`。
3. `SleiApp` 调用 `bridge.updatePreferences({ appearance })`，同时通过 `applyPreferenceMutation` 做 optimistic update。
4. `appearance` state 更新后传入 `SleiAppFrame`。
5. `SleiAppFrame` 更新 `--slei-font-size`，并同步全局 rem / text token 字号来源，界面立即响应。
6. daemon 保存成功后维持当前状态；失败时沿用现有回滚、错误 toast 和 `preferenceError` 展示。

## 组件边界

- `SleiApp`：继续负责偏好读取、更新、optimistic mutation 和错误处理。
- `SleiAppFrame`：负责把 `AppearancePreferences` 映射为 UI shell 主题和全局字号，不处理持久化；若实现需要写 `document.documentElement`，必须在组件生命周期内保持同步并在卸载时恢复，避免污染测试或其他页面。
- `SettingsPageView`：只负责渲染字体大小控件并发出用户选择，不保存生产状态。
- daemon / storage：继续作为偏好 source of truth；本任务不改变 schema 或 repository。

## 错误处理

字体大小偏好更新失败时，不新增错误路径。继续使用当前 `handlePreferenceMutation` 行为：回滚 optimistic 偏好、显示保存失败 toast、在设置页对应区域显示 `preferenceError`，并清除 pending 状态。若收到未知 `fontSize` 值，前端应维持现有类型约束；daemon 仍负责拒绝无效 `sm|md|lg` 之外的值。

## 测试策略

- `SleiAppFrame` 渲染测试：传入 `appearance={{ theme: "light", fontSize: "lg" }}`，断言根节点暴露 `--slei-font-size:16px` 或 `data-font-size="lg"`。
- `SleiAppFrame` jsdom 测试：挂载后确认全局字号来源已经更新，例如 `document.documentElement.style.fontSize` / `--slei-font-size` 或 Tailwind text token 变量变化；切换 props 后应同步变化，卸载后应恢复。
- 设置页 SSR / e2e 测试：更新现有断言，确保设置页继承全局字号，不依赖局部重复类。
- 设置页交互测试：点击字号按钮后，断言 `onAppearanceChange` 收到完整 appearance，例如 `{ theme: "light", fontSize: "lg" }`。
- 代表性 DOM 测试：至少覆盖一个显式使用 `text-sm` 或 `text-xs` 的节点，确认字号偏好不是只影响未设置 class 的普通文本。
- 偏好持久化测试：复用已有 bridge mock 和 daemon 测试；如果实现未改后端，无需新增 daemon 测试。

## 验收标准

- 在设置里选择“小 / 中 / 大”后，应用主要界面字号立即变化。
- 刷新或重启后，daemon 返回的已保存字号继续生效。
- 设置页字体大小按钮的选中态和 pending/错误状态保持正确。
- 无新增 production mock、JSON 持久化或前端本地偏好规则。
- 相关前端测试通过。
