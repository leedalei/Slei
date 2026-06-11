# Slei Agent Instructions

## Task Completion

- Slei 的每个任务完成之后，都要主动咨询是否合并到 `master` 或者其他分支。
- Slei 的项目文档默认使用中文书写；除非用户明确要求英文，新增或更新文档时都应使用中文。

## Core Architecture

- Slei 的核心架构理念是：业务逻辑、状态变更、路由决策、持久化、幂等、重置和数据恢复都必须在 daemon 中处理。
- 频道发言、coordinator 路由和 multi-agent 协作必须遵守 `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`；改动相关代码前应先对照其中的信息流转图和 Drift Guardrails，避免路由逻辑漂移到 UI、本地 mock、关键词兜底或不可持久化状态。
- UI shell 只负责展示 daemon 返回的数据、收集用户输入、触发 daemon command/API、呈现 loading/error/empty 状态。不要在 UI 中写复杂业务逻辑。
- UI 可以做轻量 view-model 映射，例如格式化时间、选择本地 tab、打开/关闭 drawer、toast、表单临时输入状态；但不能把 agents、channels、messages、tasks、workspace、settings 等生产数据的规则写在 React 组件里。
- Production 代码中禁止使用 mock、demo、sample、fake seed 数据来填充真实界面。Mock/fixture 只允许存在于测试、contract fixture、acceptance fixture 或明确命名的 test helper 中。
- 如果 daemon 不可用，UI 应展示离线或空状态，而不是启用另一套本地 mock 系统。

## Persistence

- 所有可变、持久化的产品状态默认必须存储在 SQLite 中，并通过 `crates/slei-storage` 的 schema/repository 访问。
- 不要用 JSON 文件作为 production 持久化存储来保存 agents、channels、channel members、messages、tasks、conversations、cards、saved messages、preferences、nodes、idempotency 或 runtime metadata。
- SQLite 是必要约束：它提供 schema migration、事务、一致性、索引、查询能力、外键约束、幂等记录和可测试的 reset/import 路径，避免 JSON 文件分散写入导致状态不一致。
- 允许使用 JSON 的场景必须有明确理由，通常只包括：
  - API/request/response/event payload 序列化。
  - 测试 fixtures、contract fixtures、acceptance fixtures。
  - 内置静态资源，例如 `resources/default-agent-assets/*.json`。
  - i18n locale 文件。
  - agent workspace 中 runtime 需要读取的文件内容，例如 `MEMORY.md`、notes、skill `SKILL.md`、临时 overlay settings。
  - worker 协议、JSONL 或一次性迁移读取旧 JSON 的兼容路径。
- 旧 JSON production 数据只能作为迁移输入短期读取，不能继续作为新写入路径。

## Reset Policy

- 开发 reset 的目标是清空产品状态和运行期 agent workspace，让系统从全新状态重新开始。
- Reset 应保留代码内置资源、SQLite schema migration 和必要空目录；应清空 SQLite 中的可变业务表，并删除运行期生成的 `agents/` workspace。
- Reset 不应依赖手工删除散落文件。应提供 daemon 或脚本入口，方便开发过程中频繁清空重来。

## UI Standards

- UI 页面和组件必须以 daemon 数据为 source of truth，不从 fixture 默认值推导 production 状态。
- 页面组件应保持展示导向：接收 props、渲染列表/详情/空状态、发出用户动作。复杂规则应下沉到 daemon service，或在前端仅保留很薄的 bridge/view-model 层。
- 表格、列表、成员、频道、任务、消息、电脑节点等界面必须能正确展示空状态；不要为了避免空状态而塞默认成员、默认任务或假设备。
- UI 文案、交互和控件应保持一致：使用现有设计系统组件、图标按钮、明确的 loading/error/disabled 状态，不在页面内解释实现细节。
- 新增 UI 功能时，优先复用现有 app frame、feature view、bridge DTO 和组件模式；不要引入独立的数据模型或本地持久化机制。
