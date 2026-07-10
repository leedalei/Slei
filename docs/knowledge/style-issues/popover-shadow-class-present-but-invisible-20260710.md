---
title: "Popover 中号阴影类名存在但实际渲染几乎不可见"
module: "桌面端 UI 组件"
date: 2026-07-10
problem_type: style_issue
severity: medium
tags: [popover, box-shadow, jsdom, electron, visual-regression, css-token]
related_files:
  - "apps/desktop/src/app/app.css"
  - "apps/desktop/src/components/ui/popover.tsx"
  - "apps/desktop/src/components/ui/overlay-primitives.test.tsx"
  - "apps/desktop/src/components/ui-primitive-audit.test.tsx"
  - "apps/desktop/src/features/chat/ChatPageView.test.tsx"
---

# Popover 中号阴影类名存在但实际渲染几乎不可见

## 问题描述

全局 Popover 已从 small shadow 切换到 medium shadow，相关 JSDOM 测试也通过，但 Electron 中的成员资料 Popover 仍然几乎看不到阴影。问题不在 Radix Portal 或 Popover 组件类型，而在阴影 token 的实际强度以及错误的验证方法。

## 环境信息

- **模块**: 桌面端 UI 组件
- **受影响组件**: `PopoverContent`、成员资料 Popover
- **解决日期**: 2026-07-10

## 症状

- 用户在真实 Electron 窗口中观察到：`我让你加的shadow呢？这个不是popover吗？你怎么验证的？你的jsdom有shadow？`
- DOM 中确实存在 `shadow-[var(--overlay-shadow-md)]`，但截图里卡片边缘只有接近边框的极弱灰度变化，无法形成中号悬浮层级。
- JSDOM 测试只证明 class 字符串存在，不会进行 CSS 光栅化，也无法判断 box-shadow 是否肉眼可见。

## 尝试过但无效的方案

**方案 1**: 将 Popover 从 `--overlay-shadow-sm` 切换到 `--overlay-shadow-md`
- **无效原因**: 浅色主题的 `--overlay-shadow-color` 本身只有 10% alpha，`color-mix(... 24%, transparent)` 又将强度压缩到约 2.4%，从 small 到 medium 的实际视觉差异极小。

**方案 2**: 用 JSDOM 断言 Popover class 包含 medium shadow token
- **无效原因**: JSDOM 不渲染阴影。class contract 通过不等于最终像素效果成立，不能作为视觉验收结论。

## 解决方案

为 Popover 增加专用的双层中号阴影 token，避免复用强度过低的通用 overlay token；所有 Popover 仍通过共享 `PopoverContent` 一次性生效。

**代码变更**：

```css
/* 修复前：浅色主题下有效 alpha 约为 2.4% */
--overlay-shadow-md: 0 4px 4px color-mix(
  in srgb,
  var(--overlay-shadow-color) 24%,
  transparent
);

/* 修复后：两层阴影直接使用主题化 shadow color */
--popover-shadow-md:
  0 10px 24px -6px var(--overlay-shadow-color),
  0 3px 8px -2px var(--overlay-shadow-color);
```

```tsx
// 修复前
"shadow-[var(--overlay-shadow-md)]"

// 修复后
"shadow-[var(--popover-shadow-md)]"
```

自动测试继续锁定 token 和 class contract；视觉验收改为在真实 Electron 窗口中打开成员资料 Popover、截取窗口并检查阴影，最终由用户确认效果已经生效。

## 为什么有效

根本原因是阴影颜色被连续稀释，而不是 Popover 没有使用 shadow class。浅色主题将 `--overlay-shadow-color` 定义为 `rgb(15 23 42 / 0.10)`，再混入 24% 到透明色后，实际 alpha 约为 `0.10 × 0.24 = 0.024`。新的 Popover 专用 token 直接使用主题化颜色，并用远近两层 blur 建立清晰但仍属中号的悬浮层级。

专用 token 也将影响范围限制在全局 Popover primitive，不会意外增强 Select、Dropdown 或其他使用通用 overlay token 的组件。

## 预防措施

- 将 UI 自动测试描述为“DOM/CSS contract 验证”，不要把 class 断言表述为视觉验证。
- 任何 shadow、blur、透明度、渐变或颜色对比修改，都必须在真实 Electron 窗口中打开目标状态并截图检查。
- 审查带 alpha 的颜色再次经过 `color-mix(..., transparent)` 的情况，计算最终有效 alpha，避免双重稀释。
- 为视觉组件使用作用域明确的 token，避免为了一个 Popover 调整影响多个 overlay 的共享 token。

## 相关文档

- 暂无相关文档
