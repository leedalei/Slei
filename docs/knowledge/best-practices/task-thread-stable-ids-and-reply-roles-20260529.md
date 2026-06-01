---
title: "任务线程回复使用稳定 ID 和角色字段"
module: Slei Desktop Task Thread
date: 2026-05-29
problem_type: best_practice
severity: medium
tags: [react, task-thread, stable-id, vitest, reply-role]
related_files:
  - "apps/desktop/src/app/SleiApp.tsx"
  - "apps/desktop/src/app/fixtures.ts"
  - "apps/desktop/e2e/task-thread-flow.spec.tsx"
---

# 任务线程回复使用稳定 ID 和角色字段

## 问题描述
任务线程功能需要把聊天消息转换为任务，并允许用户和 Agent 在任务 Thread 中继续会话。实现这类本地 UI 状态时，如果任务和回复 ID 依赖 `Date.now()`，测试和渲染都容易出现不可复现的状态。

## 环境信息
- **模块**: Slei Desktop Task Thread
- **受影响组件**: chat-to-task helper、task thread drawer、reply list
- **解决日期**: 2026-05-29

## 症状
- `pnpm --filter @slei/desktop test -- e2e/task-thread-flow.spec.tsx` 期望稳定 ID 时失败：
  - `expected 'T-1780054674150' to be 'task-message_1'`
  - `expected [ Array(3) ] to deeply equal [ Array(3) ]`
- Agent 回复虽然能以 sender 文本渲染，但数据模型没有保存 `role`，后续接入任务级 Agent session 时缺少明确角色信息。

## 尝试过但无效的方案
**直接沿用时间戳 ID**:
- **无效原因**: 同一毫秒内追加多条回复会生成重复 ID，测试也无法断言确定结果。

## 解决方案
任务 root ID 基于源消息 ID 生成，回复 ID 基于 task ID 和当前 reply 序号生成，同时在 `SleiTaskReply` 中保留 `role`。

**代码变更**：
```tsx
// 修复前（有问题）:
id: `T-${Date.now()}`;
replies: [...(task.replies ?? []), { id: `reply-${Date.now()}`, sender: reply.sender, body }];

// 修复后（正确）:
id: `task-${message.id}`;
replies: [
  ...(task.replies ?? []),
  { id: `reply-${taskId}-${(task.replies?.length ?? 0) + 1}`, sender: reply.sender, role: reply.role, body },
];
```

## 为什么有效
源消息 ID 已经是会话中的稳定标识，用它生成任务 ID 可以让聊天消息和任务 root 形成可追踪关系。回复序号依赖任务当前 replies 数组，避免了时间戳重复和测试随机性。保留 `role` 后，用户与 Agent 的回复可以共用同一条数据路径，UI 也能按角色扩展样式或后续 runtime 行为。

## 预防措施
- 为本地 UI 状态 helper 写单测时断言稳定 ID，不只断言文本渲染。
- 新增会话类数据结构时同时保留 sender 和 role，避免后续 Agent 接入再迁移数据模型。
- 避免在可测试的业务标识中直接使用 `Date.now()`；确需时间戳时，将生成器作为可注入依赖。

## 相关文档
- `docs/superpowers/plans/2026-05-29-slei-task-thread-flow.md`
