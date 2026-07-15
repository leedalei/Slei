# Slei

Slei 是一个本地优先的桌面协作应用。当前开发形态由 React/Vite 桌面 UI、Electron shell、Rust daemon、SQLite 存储和 Claude Agent worker 组成。

## 环境准备

- Node.js 和 pnpm。
- Rust stable toolchain；仓库通过 `rust-toolchain.toml` 固定使用 stable，并需要 `rustfmt`、`clippy` 组件。
- macOS 上运行 Electron 桌面壳需要本机图形环境；Rust 构建仍需要 Xcode Command Line Tools。

首次拉取仓库后安装依赖：

```sh
pnpm install
```

## 启动 APP

从仓库根目录运行：

```sh
pnpm --filter @slei/desktop desktop
```

这个命令会执行 `apps/desktop/scripts/desktop-dev.sh`，依次完成：

1. 构建 `@slei/claude-agent` worker。
2. 构建 `slei-cli` 和 `slei-daemon`。
3. 启动 Vite dev server，固定监听 `127.0.0.1:1420`。
4. 编译 Electron main/preload 到 `apps/desktop/dist-electron`。
5. 启动 Electron 桌面窗口，由 Electron main 连接或拉起本地 daemon。

启动成功后：

- daemon API: `http://127.0.0.1:4319`
- daemon events: `ws://127.0.0.1:4319/v1/events/ws`
- Vite dev server: `http://127.0.0.1:1420/`
- Electron 会打开桌面窗口，这是完整 APP 的主要入口。

停止开发进程时，在启动命令所在终端按 `Ctrl-C`。如果本次 Electron 启动前 daemon 端口是空闲的，脚本会清理本次启动的 daemon 和 agent worker；如果已有外部 daemon，脚本不会抢占或强杀它。

## 常见启动方式

完整桌面 APP：

```sh
pnpm --filter @slei/desktop desktop
```

只启动 daemon：

```sh
cargo run -p slei-daemon
```

只启动前端 dev server：

```sh
pnpm --filter @slei/desktop dev
```

注意：只跑 `pnpm --filter @slei/desktop dev` 只能打开 Web 前端页面，不会启动 Electron shell，也不会自动启动 daemon。需要验证完整桌面集成时请使用 `desktop` 命令。

如果 Vite 端口被占用，或 dev server 没能在等待时间内 ready，可能看到：

```text
[slei-desktop] timed out waiting for Vite
```

可以先检查端口占用，或单独运行 daemon，等看到 `slei-daemon listening on 127.0.0.1:4319` 后，再运行完整桌面命令：

```sh
cargo run -p slei-daemon
pnpm --filter @slei/desktop desktop
```

## 常用开发命令

根目录命令：

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm test:guardrails
```

桌面应用命令：

```sh
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop lint
pnpm --filter @slei/desktop build
```

Rust 测试示例：

```sh
cargo test
cargo test -p slei-daemon
cargo test -p slei-storage
```

## 开发数据和 reset

默认数据根目录是 `~/.slei`，也可以通过 `SLEI_DATA_ROOT` 覆盖。daemon 默认监听地址是 `127.0.0.1:4319`，可以通过 `SLEI_DAEMON_ADDR` 覆盖。

开发 reset 需要显式开关：

```sh
SLEI_ENABLE_DEV_RESET=1 pnpm dev:reset
```

`pnpm dev:reset` 会调用本地 daemon 的 `POST /v1/dev/reset`。默认 endpoint 是 `http://127.0.0.1:4319`，默认 token 是 `desktop-session-token`；必要时可通过 `SLEI_DAEMON_ENDPOINT` 和 `SLEI_DAEMON_TOKEN` 覆盖。

## 架构约束

- 业务逻辑、状态变更、路由决策、持久化、幂等、reset 和数据恢复必须在 daemon 中处理。
- UI shell 只负责展示 daemon 返回的数据、收集用户输入、触发 daemon command/API，以及呈现 loading、error、empty 状态。
- 可变产品状态默认存储在 SQLite 中，并通过 `crates/slei-storage` 的 schema/repository 访问。
- Production 代码不要用 mock、demo、sample 或 fake seed 数据填充真实界面。
- 如果 daemon 不可用，UI 应展示离线或空状态，而不是启用另一套本地 mock 系统。

更多项目规则见 `AGENTS.md`。

## 目录概览

- `apps/desktop`: Electron + React 桌面应用。
- `apps/desktop/src/electron`: Electron main/preload、daemon RPC、事件转发和本地安全协议。
- `crates/slei-daemon`: 本地 daemon 和 API。
- `crates/slei-storage`: SQLite schema、migration 和 repository。
- `crates/slei-domain`: 领域模型。
- `crates/slei-protocol`: daemon/UI/worker 之间的协议类型。
- `packages/protocol-client`: 前端使用的协议客户端。
- `packages/i18n`: UI 文案。
- `workers/claude-agent`: Claude Agent worker。
- `docs/architecture`: 架构决策和设计说明。
- `docs/superpowers`: 历史规格和实施计划。
