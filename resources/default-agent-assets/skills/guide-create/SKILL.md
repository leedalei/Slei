---
name: guide-create
description: Use when the user asks Yeal to create one or more Slei agents, members, or channels.
---

# Guide Create

Use this skill when the user asks Yeal to create, add, set up, or prepare one or more Slei agents, members, or channels. If the user asks for only a channel, create a channel card. If the user asks for a channel plus agent setup, create the agent cards and the channel card as separate product tool calls.

## Boundaries

- Do not create agents or channels by returning plain JSON, markdown tables, or natural language for the frontend to parse.
- Do not silently invent missing runtime-critical values. Use the defaults below only when the user has not specified them.
- Do not create a card for Yeal or for hidden/system-owned roles.
- Do not call the tool for a vague request such as "make my team better" until you have enough role/name detail to form a useful agent draft.

## Workflow

1. Extract every requested agent and channel from the user message.
2. Normalize each agent draft:
   - `name`: short display name, 1-32 characters. If a requested role has responsibilities but no explicit personal name, assign a simple random unused English name such as Coda, Mira, Nova, Owen, Luna, Kai, Iris, or Theo. Do not use role-only labels such as Developer, QA, Architect, 开发工程师, QA质保员, or 架构师 as the display name.
   - `handle`: lowercase kebab handle with a leading `@`, derived from the random English display name if the user omitted a personal name. Do not derive handles from role-only labels; for example, use `Mira` with `@mira` instead of `开发工程师` with `@developer`.
   - `runtimeKind`: default `ClaudeCode`.
   - `model`: default `Sonnet`.
   - `nodeId`: default `local-node` unless the user names another device.
   - `description`: one concise role paragraph that includes responsibilities, expected collaboration style, and any constraints the user gave.
3. Normalize each channel draft:
   - `name`: short channel name without a leading `#`, lowercase kebab case when the user did not specify exact capitalization.
   - `description`: one concise sentence about the channel purpose. Default to `团队会话频道` when omitted.
   - `projectName`: optional short project label when the user names a project; otherwise omit or use an empty string.
   - `projectPaths`: optional list of project folder paths only when the user provided explicit paths.
   - `agentIds`: optional list of known Slei agent IDs only when Yeal can identify existing members unambiguously; otherwise use an empty list and let the user add members later.
4. For each valid draft, call the product tool command `slei_propose_interactive_card`.
5. Call the tool once per agent or channel. Multiple requested agents and channels require multiple tool calls, not one combined card.
6. After tool calls, reply briefly with what was prepared and what still needs user confirmation.

## Product Tool Command

Call `slei_propose_interactive_card` with an object payload.

### Create Agent Input Schema

```json
{
  "kind": "createAgent",
  "title": "创建 <name>",
  "summary": "<name> · <runtimeKind> / <model>",
  "draft": {
    "name": "<display name>",
    "handle": "@<normalized-handle>",
    "runtimeKind": "ClaudeCode",
    "model": "Sonnet",
    "nodeId": "local-node",
    "description": "<agent role and operating instructions>"
  },
  "actionLabel": "创建",
  "doneLabel": "DONE"
}
```

### Create Channel Input Schema

```json
{
  "kind": "createChannel",
  "title": "创建 #<name>",
  "summary": "#<name>",
  "draft": {
    "name": "<channel-name-without-leading-hash>",
    "description": "<channel purpose>",
    "projectName": "",
    "projectPaths": [],
    "agentIds": []
  },
  "actionLabel": "创建",
  "doneLabel": "DONE"
}
```

### Output contract

The tool returns or emits an interactive card. Yeal should not mark creation complete until the user clicks the card action and Slei reports the card as done. A successful preparation response can say: "已准备创建卡片，请确认。"

## Single agent example

User: "帮我创建一个 Bob，做架构评审。"

Tool call:

```json
{
  "kind": "createAgent",
  "title": "创建 Bob",
  "summary": "Bob · ClaudeCode / Sonnet",
  "draft": {
    "name": "Bob",
    "handle": "@bob",
    "runtimeKind": "ClaudeCode",
    "model": "Sonnet",
    "nodeId": "local-node",
    "description": "架构评审 Agent，负责审查技术方案、识别风险、提出可执行的改进建议，并在需要时把问题拆给实现 Agent。"
  },
  "actionLabel": "创建",
  "doneLabel": "DONE"
}
```

## Multiple agents example

User: "帮我建三个成员：Coda 写代码，Mira 做 QA，Owen 做文档。"

Call the tool once per agent:

```json
{
  "kind": "createAgent",
  "title": "创建 Coda",
  "summary": "Coda · ClaudeCode / Sonnet",
  "draft": {
    "name": "Coda",
    "handle": "@coda",
    "runtimeKind": "ClaudeCode",
    "model": "Sonnet",
    "nodeId": "local-node",
    "description": "开发 Agent，负责按需求实现代码、修复缺陷、运行必要验证，并把风险和阻塞清楚反馈给团队。"
  },
  "actionLabel": "创建",
  "doneLabel": "DONE"
}
```

```json
{
  "kind": "createAgent",
  "title": "创建 Mira",
  "summary": "Mira · ClaudeCode / Sonnet",
  "draft": {
    "name": "Mira",
    "handle": "@mira",
    "runtimeKind": "ClaudeCode",
    "model": "Sonnet",
    "nodeId": "local-node",
    "description": "QA Agent，负责从验收标准、边界条件和回归风险出发检查交付物，并给出可复现的问题描述。"
  },
  "actionLabel": "创建",
  "doneLabel": "DONE"
}
```

```json
{
  "kind": "createAgent",
  "title": "创建 Owen",
  "summary": "Owen · ClaudeCode / Sonnet",
  "draft": {
    "name": "Owen",
    "handle": "@owen",
    "runtimeKind": "ClaudeCode",
    "model": "Sonnet",
    "nodeId": "local-node",
    "description": "文档 Agent，负责整理需求、决策、操作说明和发布说明，确保内容准确、结构清晰、便于团队复用。"
  },
  "actionLabel": "创建",
  "doneLabel": "DONE"
}
```

## Single channel example

User: "帮我创建一个 QA 频道。"

Tool call:

```json
{
  "kind": "createChannel",
  "title": "创建 #qa",
  "summary": "#qa",
  "draft": {
    "name": "qa",
    "description": "QA 协作频道，用于验收标准、回归风险和缺陷跟进。",
    "projectName": "",
    "projectPaths": [],
    "agentIds": []
  },
  "actionLabel": "创建",
  "doneLabel": "DONE"
}
```

## Missing information

If the user omits only model/runtime/device, use defaults. If the user omits the role or expected responsibility for an agent, ask one short clarification before calling the tool. If the user asks for a channel but omits the channel purpose, use a concise default description instead of blocking.
