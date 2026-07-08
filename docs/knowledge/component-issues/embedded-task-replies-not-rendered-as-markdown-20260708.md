---
title: "频道内嵌任务回复未按 Markdown 渲染"
module: Slei Desktop Channel Embedded Tasks
date: 2026-07-08
problem_type: component_issue
severity: medium
tags: [react, markdown, task-thread, embedded-view, ui-test]
related_files:
  - "apps/desktop/src/features/chat/ChatPageView.tsx"
  - "apps/desktop/src/features/chat/ChatPageView.test.tsx"
  - "apps/desktop/src/features/tasks/TaskThreadDrawer.tsx"
---

# 频道内嵌任务回复未按 Markdown 渲染

## 问题描述
频道页右上角「任务」tab 的任务详情中，任务回复正文会把 `###`、`**`、列表和表格标记当作普通文本显示。独立任务抽屉已经接入 Markdown 渲染，但频道内嵌任务视图仍走旧的纯文本渲染路径。

## 环境信息
- **模块**: Slei Desktop Channel Embedded Tasks
- **受影响组件**: `ChannelTaskList` 内嵌任务详情、任务回复列表
- **解决日期**: 2026-07-08

## 症状
- 用户在频道页切到「任务」tab 后，回复卡片中出现裸露 Markdown 标记，例如 `### 主流框架` 和 `**Tiptap**`。
- 同一任务在 `TaskThreadDrawer` 中已经能通过 `MarkdownMessage` 正常渲染，导致两个任务入口表现不一致。

## 尝试过但无效的方案

**只检查任务抽屉渲染**
- **无效原因**: 截图中的入口不是独立任务抽屉，而是 `ChatPageView.tsx` 中的频道内嵌任务详情；该路径仍使用 `<p>{reply.body}</p>`。

## 解决方案
把频道内嵌任务详情里的回复正文改为复用聊天消息的 `MarkdownMessage`，并增加 DOM 回归测试，明确断言 `###` 生成标题、`**Tiptap**` 生成 `strong`，且原始 Markdown 标记不再裸露。

**代码变更**：
```tsx
// 修复前（有问题）:
<p className="mt-1 leading-relaxed">{reply.body}</p>

// 修复后（正确）:
<MarkdownMessage
  className="mt-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
  copyCodeLabel={messages.chat.copyMessage}
  markdown={reply.body}
  tone="card"
/>
```

## 为什么有效
`MarkdownMessage` 是聊天消息和任务抽屉共用的 Markdown 渲染组件，内部统一使用 `react-markdown`、`remark-gfm` 和 `sanitizeMarkdown`。频道内嵌任务详情改用同一个组件后，任务回复在不同入口共享相同的 Markdown 能力和 URL 安全处理，不再出现一处渲染、一处纯文本的分叉。

## 预防措施
- 任务线程 UI 变更时同时检查独立任务页、任务抽屉和频道内嵌任务 tab 三个入口。
- 涉及回复正文渲染时，优先复用 `MarkdownMessage`，不要在新视图中直接输出 `{reply.body}`。
- UI 回归测试应覆盖具体 DOM 结果，例如 `<h3>`、`<strong>`，而不只断言文本存在。

## 相关文档
- `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md`
