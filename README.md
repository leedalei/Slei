# Slei

[![CI](https://github.com/leedalei/Slei/actions/workflows/ci.yml/badge.svg)](https://github.com/leedalei/Slei/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20arm64-lightgrey)](#打包发布)
[![Status](https://img.shields.io/badge/status-early%20development-orange)](#项目状态)

**Slei** 是一个本地优先（local-first）的桌面协作应用：在频道里与多个 AI Agent 一起工作，把消息、任务、认领与状态都落在本机 daemon 与 SQLite 中，而不是依赖云端控制面。

> 当前处于早期开发阶段。生产打包以 **macOS arm64** 为主；Windows / Linux 与正式签名公证尚未作为正式发布目标。

## 它能做什么

- **本地优先**：业务状态与运行数据默认留在本机（`~/.slei`），daemon 不可用时 UI 展示离线/空状态，而不是切换到本地假数据。
- **多 Agent 频道协作**：人工消息可 `@mention` 指定 Agent，或广播给频道成员；Agent 通过原子 claim 自主认领并回复。
- **任务工作区**：任务卡片是源消息的展示状态；看板/列表共享同一套委派任务模型，支持任务线程回复。
- **本机控制面**：Rust daemon 负责消息投递、claim、任务、幂等、reset 与恢复；桌面 UI 只负责展示与触发 API。
- **Claude Code runtime**：通过打包后的 Claude Agent worker 在本机执行；需要本机已登录 Claude Code，Slei 不会代替安装或登录。

## 技术架构

```text
┌─────────────────┐     typed RPC / events      ┌──────────────────┐
│  Desktop UI     │ ◄──────────────────────────► │  Electron main   │
│  React + Vite   │                              │  (壳 / 生命周期)   │
└─────────────────┘                              └────────┬─────────┘
                                                          │
                                                          ▼
                                                 ┌──────────────────┐
                                                 │  slei-daemon     │
                                                 │  HTTP + WS API   │
                                                 └────────┬─────────┘
                                                          │
                          ┌───────────────────────────────┼───────────────────────────────┐
                          ▼                               ▼                               ▼
                   ┌─────────────┐                 ┌─────────────┐                 ┌─────────────┐
                   │ SQLite      │                 │ slei-cli    │                 │ Claude      │
                   │ slei-storage│                 │ Agent 工具   │                 │ Agent worker│
                   └─────────────┘                 └─────────────┘                 └─────────────┘
```

核心约定：

- **Daemon 是唯一业务控制面**：路由、持久化、幂等、reset 与数据恢复都在 daemon。
- **UI 是展示壳**：渲染 daemon DTO，收集输入，呈现 loading / error / empty。
- **SQLite 是生产状态源**：可变产品状态经 `crates/slei-storage` 访问，不把生产状态散落在 JSON 文件里。

更多决策见 [`docs/architecture/`](docs/architecture/)；贡献与实现约束见 [`AGENTS.md`](AGENTS.md)。

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| **Node.js** | CI 使用 22；建议 22+ |
| **pnpm** | CI 使用 10.x |
| **Rust** | `rust-toolchain.toml` 固定 **stable**，需 `rustfmt`、`clippy` |
| **macOS** | 运行 Electron 桌面壳需要本机图形环境；构建还需 Xcode Command Line Tools |
| **Claude Code** | 本机已安装并可登录，供 Agent runtime 使用 |

首次拉取后：

```sh
pnpm install
```

## 快速开始

从仓库根目录启动完整桌面 App：

```sh
pnpm --filter @slei/desktop desktop
```

该命令会：

1. 构建 `@slei/claude-agent` worker  
2. 构建 `slei-cli` 与 `slei-daemon`  
3. 启动 Vite（`127.0.0.1:1420`）  
4. 编译 Electron main/preload  
5. 打开 Electron 窗口，并由 main 连接或拉起本地 daemon  

默认本地端点：

| 服务 | 地址 |
| --- | --- |
| Daemon API | `http://127.0.0.1:4319` |
| Daemon events | `ws://127.0.0.1:4319/v1/events/ws` |
| Vite dev server | `http://127.0.0.1:1420/` |

在启动终端按 `Ctrl-C` 停止。若本次启动前 daemon 端口空闲，脚本会清理本次拉起的 daemon / worker；若已有外部 daemon，不会抢占或强杀。

### 其他启动方式

```sh
# 只跑 daemon
cargo run -p slei-daemon

# 只跑 Web 前端（不会启动 Electron，也不会自动拉起 daemon）
pnpm --filter @slei/desktop dev
```

验证完整桌面集成时请使用 `desktop` 命令，而不是单独的 `dev`。

若出现 `[slei-desktop] timed out waiting for Vite`，先检查端口占用，或先单独启动 daemon 再跑桌面命令。

## 配置

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `SLEI_DATA_ROOT` | 数据根目录 | `~/.slei` |
| `SLEI_DAEMON_ADDR` | daemon 监听地址 | `127.0.0.1:4319` |
| `SLEI_DAEMON_ENDPOINT` | 开发 reset 等脚本使用的 HTTP 入口 | `http://127.0.0.1:4319` |
| `SLEI_DAEMON_TOKEN` | 本地会话 token | `desktop-session-token` |
| `SLEI_ENABLE_DEV_RESET` | 显式开启开发 reset | 未设置则拒绝 reset |

开发 reset（清空可变产品状态与运行期 agent workspace）：

```sh
SLEI_ENABLE_DEV_RESET=1 pnpm dev:reset
```

## 开发与测试

根目录：

```sh
pnpm test              # 工作区测试 + guardrails
pnpm typecheck
pnpm lint
pnpm test:guardrails
```

桌面应用：

```sh
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop lint
pnpm --filter @slei/desktop build
```

Rust：

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test -p slei-daemon
cargo test -p slei-storage
```

CI 还会校验 locale、契约与 macOS 打包边界（见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。

## 目录结构

```text
apps/desktop/                 Electron + React 桌面应用
apps/desktop/src/electron/    Electron main/preload、daemon RPC、事件转发
crates/slei-daemon/           本地 daemon 与 HTTP/WS API
crates/slei-storage/          SQLite schema、migration、repository
crates/slei-domain/           领域模型
crates/slei-protocol/         daemon / UI / worker 协议类型
crates/slei-cli/              Agent 调用的 CLI 入口
packages/protocol-client/     前端协议客户端
packages/i18n/                UI 文案
workers/claude-agent/         Claude Agent worker
resources/                    内置静态资源（如默认 agent assets）
docs/architecture/            架构决策记录（ADR）
docs/desktop/                 桌面打包与桌面专属说明
scripts/                      开发、校验与发布脚本
```

## 打包发布

当前官方打包路径面向 **macOS arm64**：

```sh
# 产出 app 目录（便于本地验包）
pnpm --filter @slei/desktop package:mac:dir

# 产出 .dmg / .zip
pnpm --filter @slei/desktop package:mac
```

打 tag `v*.*.*`（需与 `apps/desktop/package.json` 的 `version` 一致）会触发 [Release workflow](.github/workflows/release.yml)。更多边界说明见 [`docs/desktop/electron-v2-packaging.md`](docs/desktop/electron-v2-packaging.md)。

> 正式代码签名 / 公证、自动更新、Windows / Linux 安装包仍在后续范围。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 贡献流程、测试要求与 PR 约定 |
| [`AGENTS.md`](AGENTS.md) | 实现约束（daemon 边界、持久化、UI 标准） |
| [`docs/architecture/`](docs/architecture/) | ADR：进程边界、频道路由、任务卡片、安全清单等 |
| [`docs/desktop/electron-v2-packaging.md`](docs/desktop/electron-v2-packaging.md) | Electron 打包、数据目录与验包 |

## 贡献

欢迎 Issue 与 Pull Request。完整流程与约束见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；实现细节请对照 [`AGENTS.md`](AGENTS.md)。

## 项目状态

- **成熟度**：早期 / MVP 持续迭代  
- **桌面底座**：Electron（已收口，不再维护 Tauri 路径）  
- **平台**：开发与发布以 macOS arm64 为主  
- **Runtime**：Claude Code worker（OpenCode / Codex 等 adapter 仍为后续规划，见 ADR 0004）

## 安全说明

- Daemon token 由 Electron main 持有，前端不直接持有敏感凭证。  
- 可变业务数据默认在本地 SQLite；请勿把带真实数据的开发目录提交进仓库。  
- 安全相关检查项见 [`docs/architecture/security-mvp-checklist.md`](docs/architecture/security-mvp-checklist.md)。  
- 若发现安全问题，请优先私下联系维护者，避免在公开 Issue 中贴出可利用细节。

## License

本项目采用 [MIT License](LICENSE)。
