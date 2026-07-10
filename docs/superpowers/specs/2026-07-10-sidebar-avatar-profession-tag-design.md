# 侧边栏私信头像与职业标签设计

## 目标

调整侧边栏私信列表中的成员行：将头像从当前 28px 增大到 34px，并在成员名称右侧显示职业标签；同时让全局头像统一使用 1px 中灰色实线边框。

## 范围

- 仅影响 `WorkspaceSidebar` 的私信列表行；私信行单独调整为 40px 高度以容纳 34px 头像，频道行继续保持现有 32px 高度。
- 不改变其他 `MemberAvatar` 使用场景的默认尺寸或已有 28px 小头像。
- 所有 `Avatar` 根节点统一使用 1px `solid` 边框，颜色使用现有 `muted-foreground/30` 语义色，不新增硬编码颜色。
- 职业文案复用成员数据：优先使用 `member.profession`，缺失时回退到 `member.role`；两者都为空时不渲染标签。

## 方案

为 `MemberAvatar` 增加名为 `sidebar` 的专用 34px 尺寸变体，并仅在私信列表传入该尺寸。私信列表行覆写为 40px 高度，触发器继续占满行高；频道行不变。职业标签复用现有 `Badge` 组件和 secondary 视觉样式，放在名称之后；名称和标签放在 `min-w-0` 的单行 flex 容器内，标签设置最大宽度并允许截断，确保右侧菜单按钮仍可用。

头像基础组件保留现有 `border` 工具类并显式改用 `border-muted-foreground/30`，从而覆盖默认、small、large 和 sidebar 所有头像尺寸。

不直接修改全局 `small` 尺寸，避免频道成员、状态列表等其他界面产生无关变化；也不在 UI 中硬编码 Yeal 的职业。

## 数据与交互

成员对象继续由 daemon 返回的 `SleiMember` DTO 作为 source of truth。组件只进行职业字段的轻量 fallback 映射和展示；没有职业数据时保持原有名称行，不显示空 Badge。

## 测试

- 为私信列表行增加 DOM 测试：验证私信行的 40px 高度、触发器满高、`data-avatar-size="sidebar"`、`size-[2.125rem]`（34px）和职业标签文本。
- 为头像基础组件增加 DOM/source 测试：验证 1px `border`、`border-muted-foreground/30`，并确保不再使用旧的 `border-border`。
- 覆盖 `profession` 缺失时回退显示 `role`，以及两者都缺失时隐藏标签的行为。
- 覆盖长职业文案的 `min-w-0`、最大宽度和 `truncate` 布局约束。
- 运行 `WorkspaceSidebar` 相关测试及桌面端类型检查/测试命令，确认现有头像尺寸测试仍保持 28px 小头像语义。
