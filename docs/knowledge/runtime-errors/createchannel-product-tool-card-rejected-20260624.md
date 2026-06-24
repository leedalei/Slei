---
title: "引导员无法发送创建频道交互卡"
module: 引导员交互卡与频道创建
date: 2026-06-24
problem_type: runtime_error
severity: medium
tags: [guide-agent, interactive-card, create-channel, product-tool, daemon, desktop]
related_files:
  - "crates/slei-daemon/src/services/card_service.rs"
  - "resources/default-agent-assets/skills/guide-create/SKILL.md"
  - "workers/claude-agent/src/slei-tools.ts"
  - "apps/desktop/src-tauri/src/daemon_broker.rs"
---

# 引导员无法发送创建频道交互卡

## 问题描述

用户让引导员创建频道时，前端看起来已有 `createChannel` 卡片分支，但 Yeal 无法真正发出频道创建卡片。根因是产品工具链只放行 `createAgent`，频道卡片模型和 UI 分支没有接入到 `slei_propose_interactive_card`。

## 环境信息

- **模块**: 引导员交互卡与频道创建
- **受影响组件**: daemon card service、Claude worker MCP tool 描述、默认 guide-create Skill、Tauri 本地 worker 兜底解析、桌面卡片渲染
- **解决日期**: 2026-06-24

## 症状

回归测试复现的具体错误：

```text
product channel card is proposed: UnsupportedProductToolCardKind("createChannel")
```

代码调查中还能看到：

- `CardAction::CreateChannel` 和前端 `card.kind === "createChannel"` 已存在。
- `product_tool_template` 明确拒绝非 `createAgent`。
- `guide-create` Skill 只教引导员发送 `createAgent` payload。
- Tauri 本地兜底错误为 `local Slei interactive cards only support createAgent`。

## 尝试过但无效的方案

- **只依赖 UI 中的 `createChannel` 分支**: 无效。UI 只能展示 daemon/worker 返回的卡片，不能替 daemon 生成产品状态。
- **只改引导员提示词**: 无效。即使 Yeal 发出 `kind: "createChannel"`，daemon 仍会用 `UnsupportedProductToolCardKind("createChannel")` 拒绝。

## 解决方案

修复点必须覆盖完整链路：

1. daemon `propose_product_tool_card` 按 `kind` 映射 action：`createAgent` -> `CardAction::CreateAgent`，`createChannel` -> `CardAction::CreateChannel`。
2. daemon 对 `createChannel` draft 校验 `name`，并校验可选的 `description`、`projectName`、`projectPaths`、`agentIds` 类型。
3. worker MCP tool 描述明确 `createChannel` 是合法用途。
4. 默认 `guide-create` Skill 增加频道卡片 workflow、schema 和示例。
5. Tauri 本地 worker 兜底解析允许 `createChannel`。
6. 增加 daemon、worker、默认资源和桌面渲染测试。

修复前：

```rust
let kind = required_string(payload, "kind")?;
if kind != "createAgent" {
    return Err(CardError::UnsupportedProductToolCardKind(kind.to_string()));
}
let name = required_string(&template.draft, "name")?.to_string();
let action = CardAction::CreateAgent {
    name,
    permission: "Controlled".to_string(),
};
```

修复后：

```rust
let kind = required_string(payload, "kind")?;
if !matches!(kind, "createAgent" | "createChannel") {
    return Err(CardError::UnsupportedProductToolCardKind(kind.to_string()));
}
let action = match template.kind.as_str() {
    "createAgent" => CardAction::CreateAgent { /* ... */ },
    "createChannel" => CardAction::CreateChannel { name },
    kind => return Err(CardError::UnsupportedProductToolCardKind(kind.to_string())),
};
```

## 为什么有效

Slei 的交互卡不是前端从自然语言里解析出来的，而是 worker 发出 `slei_propose_interactive_card` 产品工具事件后，由 daemon 生成、持久化并回传的 typed product state。频道创建卡片要生效，必须让 product tool payload、daemon action、持久化 view、Tauri fallback、guide Skill 和 UI 渲染使用同一个 `createChannel` 合同。

## 预防措施

- 新增交互卡 kind 时，同时检查 daemon `product_tool_template`、action 映射、worker tool 描述、默认 Skill、Tauri fallback 和 UI 渲染。
- 不要只在 UI 类型里加入新 `kind`；UI 不是产品状态生成入口。
- 为每个新增 product card kind 增加至少一条 daemon product tool 测试和一条 worker/guide 事件路径测试。

## 相关文档

- `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- `docs/knowledge/runtime-errors/channel-agent-broadcast-no-reply-20260617.md`
