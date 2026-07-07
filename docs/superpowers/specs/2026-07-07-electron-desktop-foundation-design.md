# Slei Electron Desktop Foundation 设计

## 背景

Slei 当前桌面端由 React/Vite UI、Tauri Rust broker、独立 Rust daemon、runtime worker/CLI 组成。新的底层重构目标是完全替换 Tauri，使用最新版 Electron 作为桌面底座。

本设计以 Electron 43.0.0 稳定版为目标底座。Electron 迁移只替换桌面壳和前端到本地 daemon 的桥接层，不改变 Slei 的核心架构原则：业务逻辑、状态变更、路由决策、持久化、幂等、重置和数据恢复仍必须由 daemon 负责。

## 目标

V1 目标是完成 Electron 核心闭环：

- `pnpm --filter @slei/desktop desktop` 启动 Electron 主路径。
- Electron main 自动拉起或连接本地 `slei-daemon`。
- renderer 通过 typed RPC client 调用 daemon。
- daemon events 能转发到 renderer 并驱动 UI 刷新。
- 基础产品路径能完成真实 daemon 读写，例如频道列表、发送消息、任务或会话数据刷新。
- frontend crash/event logging 可用。
- 头像或本地受控资源协议可用。
- Tauri 不再作为启动 fallback。

## 非目标

V1 不承诺完成以下事项：

- Electron 生产打包、签名、自动更新。
- macOS 透明窗口、毛玻璃、traffic light 精细位置等视觉 polish 完全等价。
- Windows/Linux 平台窗口 polish。
- 删除全部 Tauri 文件和依赖的最终清扫。
- 新增业务功能或修改 daemon 业务规则。

这些事项进入 V2 或后续阶段。

## 进程架构

V1 进程结构如下：

```text
Electron main
  - 创建 BrowserWindow
  - 启动并监控本地 slei-daemon
  - 持有 daemon endpoint/token
  - 提供 typed RPC IPC handler
  - 转发 daemon event batch 到 renderer
  - 处理少量桌面壳能力：本地协议、日志、受控打开动作

Electron preload
  - contextIsolation=true
  - 暴露 window.slei.api
  - 只暴露白名单 typed 方法
  - 不暴露 ipcRenderer、Node、daemon token、daemon endpoint

Renderer React/Vite
  - 继续以 daemon 数据为 source of truth
  - 只调用 typed desktop client
  - 不直接访问 daemon HTTP/WebSocket
  - 不生成生产业务状态

Rust daemon
  - 保持独立可启动
  - 继续负责 SQLite、agents、channels、messages、tasks、cards、runtime workers
  - 对 Electron main 提供 HTTP/event replay 能力

Workers / CLI
  - 仍由 daemon 管理
  - Electron 不直接 spawn runtime worker
```

Electron main 替代的是现有 Tauri Rust broker，不替代 daemon。renderer 不应持有 daemon token 或 endpoint，也不应直接连接 daemon。

## Typed RPC / IPC 合同

迁移时引入新的 typed RPC client，不复刻 Tauri `invoke("xxx_command")` 字符串接口。

调用链：

```text
renderer feature code
  -> DaemonBridge interface
  -> desktop typed client
  -> window.slei.rpc.call(method, payload)
  -> preload whitelist
  -> Electron main ipcMain.handle(method)
  -> daemon HTTP / event replay
```

前端消费侧保留现有 `DaemonBridge` 方法形状，例如 `listChannels()`、`sendChannelMessage()`、`listenDaemonEvents()`。React 页面不直接感知底层从 Tauri 迁移到 Electron。变化集中在 `createDaemonBridge()` 内部。

RPC method 使用领域命名。下面列表是合同命名示例，不代表 V1 必须一次迁移全部业务面：

```ts
type DesktopRpcMethod =
  | "daemon.status"
  | "diagnostics.list"
  | "nodes.list"
  | "channels.list"
  | "channels.create"
  | "channels.messages.list"
  | "channels.messages.send"
  | "tasks.list"
  | "tasks.thread.get"
  | "conversations.messages.send"
  | "frontend.crash.log"
  | "frontend.event.log";
```

V1 必须迁移的最小 method 集合由验收闭环决定：`daemon.status`、基础 diagnostics 或 node 状态、频道列表、频道消息列表、发送频道消息、事件 reconnect/subscribe、frontend logging。任务、会话、成员、设置等 method 可以在同一 typed RPC 框架下继续迁移，但不应因为示例列表而扩大 V1 必交范围。

request/response 类型优先复用 `@slei/protocol-client` 和当前 bridge DTO。新增类型集中放在 desktop client 合同文件中，避免散落在 React 组件里。

事件合同单独处理：

```ts
window.slei.events.subscribe("daemon.events", handler);
window.slei.events.subscribe("daemon.state", handler);
window.slei.events.reconnect(after);
```

`daemon.state` 用于 Electron main 异步启动或连接 daemon 后通知 renderer。renderer 初始业务 RPC 如果遇到 `starting/offline`，应展示离线或加载状态；当 `daemon.state` 进入 `connected` 后，前端重新执行初始化数据加载或核心 refresh。

IPC 设计要求：

- preload 只暴露 `call`、`subscribe`、`unsubscribe` 等窄 API。
- Electron main 内部维护 RPC method 到 daemon HTTP/event replay 的映射表。
- 映射表必须可测试。
- 错误统一包装为 typed desktop error，例如 `daemon_offline`、`daemon_http_error`、`invalid_payload`、`permission_denied`。
- renderer 只根据 typed error 呈现 loading/error/offline/empty 状态，不推导业务状态。
- crash logging 和 frontend event logging 也走 RPC，避免保留 Tauri-only 特例。

## Daemon 启动与生命周期

Electron main 负责确保本地 daemon 可用，但只管理进程生命周期。

启动流程：

```text
pnpm --filter @slei/desktop desktop
  -> 构建/检查必要 worker 与 CLI
  -> 启动 Electron
  -> 创建 BrowserWindow
  -> preload 注入 typed RPC API
  -> renderer bootstrap，先展示 starting/loading/offline 兼容状态
  -> Electron main 异步检查 127.0.0.1:4319
     - 已有 daemon：连接并校验 status/protocol
     - 没有 daemon：spawn cargo run -p slei-daemon
  -> 等待 daemon ready
  -> 通过 RPC status/event 通知 renderer 进入 connected 或 error 状态
  -> event forwarder 开始轮询/订阅 daemon events
```

V1 保持本地 daemon 监听 `127.0.0.1:4319`。token 和 endpoint 只存在 Electron main。生产打包时再设计把 `slei-daemon` binary 作为资源分发。

V1 的 daemon auth 规则：

- 开发期沿用现有 daemon 静态 token：`desktop-session-token`。
- Electron main 启动自己拥有的 daemon 时，使用该 token 配置 RPC client，并确保子进程环境包含 `SLEI_DAEMON_TOKEN=desktop-session-token`。
- 如果 `127.0.0.1:4319` 已有 daemon，Electron main 不做 token discovery，也不从 renderer 或外部文件读取 token；它使用同一 dev token 调用 status/protocol 校验。
- 如果校验返回 unauthorized、protocol 不兼容或 status 不可用，该 daemon 视为不兼容的外部进程。V1 不强杀该进程，不抢占端口，而是返回 `daemon_auth_failed` 或 `daemon_unavailable`，让 renderer 展示离线/错误状态。
- 生产期如果需要随机 session token 或 token handoff，必须在 V2/打包设计中单独定义，不混入 V1。

生命周期规则：

- 如果端口已有 daemon，Electron 不强杀，不抢所有权，记录 `owned=false`。
- 如果 Electron main 自己 spawn daemon，记录 `owned=true`，App 退出时优雅终止。
- daemon ready 等待必须有超时，例如 30 秒后返回 `daemon_start_timeout`；超时不能阻止窗口渲染，renderer 必须能看到离线或错误状态。
- daemon 崩溃时，Electron main 记录退出码，并通过事件或 RPC 状态让 renderer 展示离线/错误状态。
- V1 可以不实现无限自动重启；最多提供一次可控重启或重新连接 RPC。
- 子进程环境必须保留 worker/CLI 所需约束：`SLEI_DAEMON_URL`、`SLEI_DAEMON_TOKEN`、repo `target/debug` PATH、worker build 输出路径。
- `desktop` 脚本仍需先执行 `pnpm --filter @slei/claude-agent build`、`cargo build -p slei-cli`、`cargo build -p slei-daemon`，再启动 Electron。

## 事件转发

Electron main 启动 daemon event forwarder，按 `after` sequence 调用 daemon replay。

- 有事件时立即推给 renderer。
- 无事件时指数退避，沿用当前 Tauri forwarder 的行为思路。
- renderer reconnect 时通过 `events.reconnect(after)` 补齐遗漏事件。
- forwarder 不解释业务 payload，只负责顺序、补齐和传递。
- unsubscribe 后不再向对应 renderer handler 推送事件。

## 桌面能力替换范围

V1 只迁移核心闭环必需的桌面能力。

### 窗口

- Electron main 创建单个主窗口，加载 Vite dev URL。
- 初始尺寸沿用 `1280x800`。
- V1 可以先使用标准窗口装饰。
- 透明背景、macOS sidebar effect、traffic light 位置后置到 V2。

### 头像和本地资源协议

现有 Tauri 使用 `slei-avatar://` 协议读取 profile avatar。Electron 需要注册等价安全协议，或提供受控资源访问 token。

V1 推荐保留协议思路：

- 支持 `slei-avatar:///<hash>.<ext>`。
- main 只允许读取 daemon data root 下 `profile/avatars`。
- 保留 hash、扩展名、canonicalize 校验。
- 不允许 renderer 任意读取本地路径。

### 打开 agent workspace/memory/docs

路径打开继续经 daemon command/RPC 触发，由 daemon 决定可打开路径。Electron main 只能执行 daemon 授权后的 shell/open 动作，renderer 不能直接传任意 path 给 Electron 打开。

### Frontend logging

`log_frontend_crash_command` 和 `log_frontend_event_command` 迁移为：

- `frontend.crash.log`
- `frontend.event.log`

V1 至少保持开发 stderr 日志可见。后续可接入 daemon diagnostics。

## V1 测试矩阵

必须覆盖：

- `pnpm --filter @slei/desktop typecheck`
- `pnpm --filter @slei/desktop test`
- Electron preload/RPC/main lifecycle 单元测试。
- daemon bridge 适配测试。
- DOM 渲染与关键交互测试：启动状态、频道列表、发送消息、事件刷新、离线状态。
- 手工验收脚本：启动 App、确认 daemon status、创建或查看频道、发送消息、看到事件或消息刷新。

重点测试项：

- main lifecycle：已有 daemon 不 spawn；无 daemon 时 spawn；owned daemon 在退出时清理。
- ready 超时：daemon 不可用时返回 typed error。
- env：spawn daemon 时带齐 URL/token/PATH。
- event forwarder：sequence 前进、空轮询退避、renderer unsubscribe 后不再推送。
- preload 安全：只暴露白名单 API，不泄漏 token、endpoint、ipcRenderer 或 Node 能力。
- RPC contract：每个 V1 启用 method 的 request/response 映射和 handler 存在。
- DaemonBridge：前端方法调用正确 RPC method 和 payload。

## V1 验收标准

V1 通过需要同时满足：

- `desktop` 命令启动的是 Electron。
- UI 不依赖 Tauri runtime。
- renderer 不直接持有 daemon token/endpoint。
- daemon 仍是业务 source of truth。
- 至少一条核心路径能完成真实 daemon 读写和事件刷新。
- 测试覆盖 IPC、preload 安全边界、daemon lifecycle、关键 DOM 交互。
- Tauri 不作为启动 fallback。

## V2 迁移事项

V2 在 V1 验收后启动，范围包括：

- 物理删除或归档 `apps/desktop/src-tauri`。
- 移除 `@tauri-apps/api`、`@tauri-apps/cli`、Tauri Cargo workspace member、Tauri 配置和旧脚本。
- 选择并接入 Electron 打包方案，例如 `electron-builder`、`electron-forge` 或等价方案。
- 生产分发 daemon binary：把 `slei-daemon`、`slei-cli`、worker build 作为 Electron 资源打包。
- macOS polish：透明窗口、titlebar overlay、traffic light 位置、背景效果。
- 应用图标、应用名、bundle id、安装包元信息。
- CI 更新：Electron build/test/package jobs。
- dev reset 和启动文档更新。
- 安全审计：CSP、protocol 权限、preload 暴露面、IPC schema 校验。
- 错误恢复增强：daemon crash 自动重启策略、用户可见重连动作、diagnostics 页面联动。
- 多平台验证：macOS 优先，之后处理 Windows/Linux 差异。
- 如果需要自动更新，单独设计 updater，不混入 V1。

## 风险与约束

- 最大风险不是窗口能否打开，而是 daemon 子进程、CLI env、worker build、事件转发、diagnostics 是否保持闭环。
- 不能为了迁移方便在 Electron main/preload 中生成 mock、demo 或 production fallback 数据。
- 不能让 renderer 绕过 main 直接连接 daemon。
- 新 typed RPC client 不能把业务规则从 daemon 搬到桌面壳。
- 新增或迁移 product tool/card/task/channel 行为时，必须覆盖 daemon、worker、desktop bridge 和 UI 渲染测试。

## 参考

- Electron 43.0.0 release: https://releases.electronjs.org/
- Electron Process Model: https://electronjs.org/docs/latest/tutorial/process-model
- Electron Context Isolation: https://electronjs.org/docs/latest/tutorial/context-isolation
- `docs/architecture/0001-runtime-adapter-and-process-boundaries.md`
- `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- `docs/architecture/0006-task-source-message-card.md`
- `docs/knowledge/runtime-errors/channel-agent-broadcast-no-reply-20260617.md`
- `docs/knowledge/runtime-errors/createchannel-product-tool-card-rejected-20260624.md`
