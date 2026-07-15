# 贡献指南

感谢你关注 Slei。提交 Issue 或 Pull Request 前，请先阅读本文与 [`AGENTS.md`](AGENTS.md)。

默认主分支为 `master`。

## 开始之前

1. 按 [`README.md`](README.md) 完成环境安装，并确认 `pnpm --filter @slei/desktop desktop` 能启动完整桌面 App。
2. 阅读 [`AGENTS.md`](AGENTS.md) 中的架构与 UI 约束。
3. 改动频道消息、Agent claim、任务卡片或 runtime 边界时，先对照相关 ADR：
   - [`docs/architecture/0005-channel-routing-and-multi-agent-flow.md`](docs/architecture/0005-channel-routing-and-multi-agent-flow.md)
   - [`docs/architecture/0006-task-source-message-card.md`](docs/architecture/0006-task-source-message-card.md)
   - [`docs/architecture/0001-runtime-adapter-and-process-boundaries.md`](docs/architecture/0001-runtime-adapter-and-process-boundaries.md)

## 架构约定（必须遵守）

- **Daemon 是业务控制面**：路由、持久化、幂等、reset 与数据恢复都在 daemon；不要写进 React UI。
- **UI 只做展示壳**：渲染 daemon DTO，收集输入，呈现 loading / error / empty；可做轻量 view-model，不承载生产业务规则。
- **SQLite 是生产状态源**：可变产品状态经 `crates/slei-storage` 访问；不要用 JSON 文件、localStorage 或 fixture 作为 production 数据源。
- **禁止生产 mock**：Mock / sample / fake seed 只允许出现在测试或明确命名的 test helper 中。
- **daemon 不可用时**：UI 展示离线或空状态，不要启用另一套本地假数据路径。

更完整的规则见 [`AGENTS.md`](AGENTS.md)。

## 开发工作流

```sh
pnpm install
pnpm --filter @slei/desktop desktop   # 完整桌面 App
```

常用检查：

```sh
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

开发 reset（需显式开启）：

```sh
SLEI_ENABLE_DEV_RESET=1 pnpm dev:reset
```

## 测试要求

- 所有行为变更都应有配套单元测试。
- 涉及 UI 时，必须验证关键 DOM 节点的渲染与用户交互。
- 改动消息相关 UI 时，检查是否需要同步普通频道消息、任务源消息卡片、任务线程回复、DM 等类型；若只改一种，请在 PR 中说明原因。
- 契约、locale 或打包边界相关改动，留意 CI 中的对应校验脚本。

## Pull Request

1. 基于最新 `master` 开分支。
2. 保持改动聚焦；避免把无关重构塞进同一 PR。
3. PR 描述请写清：
   - 动机与行为变化
   - 验证方式（跑过哪些命令、手动验证路径）
   - 是否需要同步更新 ADR / README / i18n
4. 标题建议沿用仓库风格：`docs:` / `fix:` / `feat:` / `chore:` 等前缀。
5. CI（lint、typecheck、test、Rust clippy/test、必要时 macOS package check）应通过后再请求合并。

## 文档与文案

- 项目文档默认使用**中文**；除非维护者明确要求英文。
- UI 文案走 `packages/i18n` / 桌面 i18n 消息文件，中英文一起更新。
- 架构决策变化时，在同一 PR 中同步更新对应 ADR，避免文档漂移。

## 安全问题

若发现安全漏洞，请优先私下联系维护者，不要在公开 Issue 中贴出可利用细节。现有安全检查清单见 [`docs/architecture/security-mvp-checklist.md`](docs/architecture/security-mvp-checklist.md)。

## License

贡献内容将按项目的 [MIT License](LICENSE) 授权。
