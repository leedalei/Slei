---
title: "频道广播消息显示执行中但没有 Agent 回复"
module: 频道消息与 multi-agent 路由
date: 2026-06-17
problem_type: runtime_error
severity: high
tags: [channel-agent, broadcast, claim, cli-env, diagnostics, daemon, worker]
related_files:
  - "crates/slei-daemon/src/main.rs"
  - "crates/slei-daemon/src/services/channel_orchestrator_service.rs"
  - "crates/slei-daemon/src/services/claim_service.rs"
  - "crates/slei-storage/src/repositories/mod.rs"
  - "workers/claude-agent/src/claude-cli.ts"
---

# 频道广播消息显示执行中但没有 Agent 回复

## 问题描述
频道里发送消息后，UI 能看到投递/执行状态，但不管是 `@agent` 还是群发都没有可见 Agent 回复。根因不在前端渲染，而在 daemon spawn 出来的 worker 无法稳定执行 `slei-cli message claim/send` 回写频道。

## 环境信息
- **模块**: 频道消息与 multi-agent 路由
- **受影响组件**: daemon channel orchestrator、Claude worker、本地 `slei-cli` CLI 环境、桌面频道活动展示
- **解决日期**: 2026-06-17

## 症状
- 最新用户消息在 `message_deliveries` 中进入 `running`，但没有对应 Agent 消息：
```text
message_id=msg_ec61060292f44c0daeeb3a00d1eaa535 delivery_state=running run_id=run_...
```
- 事件日志显示 worker 已启动，部分 run 已完成，但没有生成可见回复：
```text
channel_agent_runtime.started run_id=run_... agent_id=...
channel_agent_runtime.completed run_id=run_... output_len=4445 visible_output_created=false
```
- 本机命令行没有全局 `slei`：
```text
slei-cli not found
```

## 尝试过但无效的方案

**方案 1**: 只在 UI 上把 `broadcast_delivered` 展示为 pending agent activity。
- **无效原因**: 这只能说明 daemon 已投递/启动 worker，不代表 agent 已经 claim 或回复；状态容易被误认为“真的有人在处理”。

**方案 2**: 只依赖 worker stdout 作为回复依据。
- **无效原因**: 广播 run 使用 `suppress_visible_output=true`，普通 stdout 不会自动进入频道；可见回复必须由 agent 主动执行 `slei-cli message claim` 和 `slei-cli message send`。

## 解决方案
修复分三层：

1. worker 允许 `Bash`，因为系统提示要求 agent 运行 `slei-cli message claim/send`。
2. daemon 启动时给子进程设置 `SLEI_DAEMON_URL`、`SLEI_DAEMON_TOKEN`，并把 repo 的 `target/debug` 加入 `PATH`，让 worker 能找到并正确连接本地 `slei-cli` CLI。
3. worker completed/failed 时，将对应 `message_deliveries` 从 `running` 收口到 `completed`/`failed`，并记录 diagnostics 事件。

**代码变更**：
```ts
// 修复前:
export const CLAUDE_CLI_TOOLS = ["Skill", "Read", "Grep", "Glob", "LS", "Write", "Edit", "MultiEdit"] as const;

// 修复后:
export const CLAUDE_CLI_TOOLS = ["Bash", "Skill", "Read", "Grep", "Glob", "LS", "Write", "Edit", "MultiEdit"] as const;
export const CLAUDE_ALLOWED_TOOLS = ["Bash", "Skill", "Read", "Grep", "Glob", "LS", ...];
```

```rust
// 修复后：daemon main 在 AppState 配置 local runner 前设置子进程 CLI 环境。
std::env::set_var("SLEI_DAEMON_URL", format!("http://{local_addr}"));
std::env::set_var("SLEI_DAEMON_TOKEN", DESKTOP_TOKEN);
prepend_path(default_slei_cli_dir());
```

```rust
// 修复后：广播 worker 完成时收口 delivery，并记录可检索 diagnostics。
self.claims
    .mark_message_delivery_completed_for_run(&record.source_message_id, &record.agent_id, run_id)
    .await;
self.orchestration
    .record_diagnostic_event("channel_agent_runtime.delivery_completed", "... marked=true")
    .await;
```

## 为什么有效
Slei 的频道回复链路不是“worker stdout 自动变成消息”，而是：

1. daemon 为频道消息创建 delivery 并 spawn worker。
2. agent 判断自己是否要处理，先用 CLI claim。
3. claim 成功的 agent 再用 CLI send 生成真实频道消息。

如果 worker 没有 `Bash`，它无法运行 `slei`；如果子进程环境没有 daemon URL/token 或 PATH，它会连错默认端口或找不到 CLI。修复后，agent 有能力执行真实 claim/send；即使 worker 失败或没有发可见消息，delivery 也会收口并留下 diagnostics，不再长期卡在 running。

## 预防措施
- 频道广播相关问题先查 `event_log`：`channel_agent_runtime.started/completed/failed`、`message_claimed`、`delivery_completed/failed`、`broadcast_stdout_suppressed`。
- 只把 `broadcast_delivered` 当成“已投递/已 spawn”，不要当成“已 claim/已回复”。
- 修改 worker 提示要求 CLI 行为时，必须同时检查 Claude 工具权限、MCP env、daemon 子进程 env。
- 涉及 delivery 状态流转时，必须加测试覆盖 `running -> completed/failed`，并验证 diagnostics 事件存在。

## 相关文档
- `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
