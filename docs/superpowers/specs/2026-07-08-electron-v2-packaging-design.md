# Slei Electron V2 打包与收口设计

## 背景

Slei Electron V1 已经完成桌面底座核心闭环：`pnpm --filter @slei/desktop desktop` 启动 Electron，Electron main 连接或拉起本地 daemon，renderer 通过 typed RPC 访问 daemon，daemon events 能转发到 UI，头像协议、开发启动 cleanup、Claude runtime path 继承和基础活动状态问题已经验证。

V2 的目标不是新增业务功能，而是把 V1 的 Electron 基础收口为可分享的 macOS 安装包，并移除旧 Tauri 底座带来的双维护成本。业务逻辑、状态变更、路由、持久化、幂等、重置和数据恢复仍必须在 daemon 中处理；Electron main 只负责桌面壳、生产资源定位、daemon 生命周期、IPC/RPC、窗口体验和受控本地能力。

## 用户确认的范围

本轮 V2 覆盖三个方向：

1. Electron-only 收口：彻底删除 Tauri 代码、依赖、workspace member、fallback adapter 和旧命名。
2. macOS 可分享安装包：接入 `electron-builder`，产出可分享 `.dmg` / `.zip`，CI 至少跑 package dry-run。
3. macOS polish 与应用元信息：应用名、bundle id、图标、透明窗口、vibrancy、titlebar 和 traffic light 精调。

本轮明确不做：

- 自动更新。
- Windows/Linux 打包。
- x64/universal 实际构建；本轮 arm64 先行，配置和脚本预留后续入口。
- 正式签名/公证跑通；只预留配置、环境变量和 CI hook。
- 完整安全审计和 daemon crash 自动恢复增强。
- 复杂数据自动迁移；生产包默认独立数据目录，开发环境继续使用现有开发数据。

## 总体推进方式

采用“顺序收口”：

1. 先清理 Tauri 和旧命名。
2. 再接入 Electron 打包配置。
3. 再处理随包 daemon、CLI、worker 资源分发。
4. 再切换生产启动和数据目录。
5. 最后做 macOS polish 和 CI dry-run。

这样可以避免 Tauri fallback、生产资源路径和窗口视觉改造互相掩盖问题。每个阶段都必须能单独测试和提交。

## Electron-only 收口

V2 第一阶段将代码库切到单一 Electron 底座：

- 删除 `apps/desktop/src-tauri` 整个目录。
- 从根 `Cargo.toml` workspace members 移除 `apps/desktop/src-tauri`。
- 从 `apps/desktop/package.json` 移除 `@tauri-apps/api` 和 `@tauri-apps/cli`，同步更新 `pnpm-lock.yaml`。
- `apps/desktop/src/lib/daemon-bridge.ts` 删除 Tauri `invoke` / `listen` adapter，只保留 Electron `window.slei` adapter、offline/noop bridge 和测试 mock bridge。
- `apps/desktop/src/lib/frontend-crash-logging.ts` 删除动态 import `@tauri-apps/api/core`，统一走 Electron desktop RPC 或 console fallback。
- `scripts/verify-macos-package.sh` 改为 Electron package boundary 验证，不再读取 `src-tauri/tauri.conf.json`。
- UI 中 `data-tauri-drag-region` 统一改为 `data-desktop-drag-region`，测试同步更新。这个命名只表达桌面拖拽语义，不再绑定底层框架。
- README 和当前 Electron 文档更新为 Electron-only 状态。历史 specs/plans 可以保留 Tauri 记录，但新文档不能把 Tauri 描述成活跃路径。

收口验收：

- production 代码、package、Cargo workspace、脚本中没有 `@tauri`、`src-tauri`、`tauri dev` 活跃命中。
- `cargo metadata` 不再包含 Tauri workspace member 或 Tauri crate。
- `pnpm install --frozen-lockfile` 不再安装 Tauri npm 包。
- desktop DOM/SSR 测试中的 drag region 断言全部使用 `data-desktop-drag-region`。

## 打包工具与产物

V2 使用 `electron-builder`。

目标：

- 本机命令能产出 macOS arm64 `.dmg` 和 `.zip`。
- CI 能跑 macOS package dry-run 或 `.app` directory build，不要求上传 artifact。
- 签名/公证配置预留，但证书缺失时不阻塞本轮验收。

建议文件结构：

```text
apps/desktop/
  build/
    icon.icns
    entitlements.mac.plist
  electron-builder.yml
  scripts/
    package-macos.sh
    prepare-package-resources.mjs
  dist/
  dist-electron/
  dist-native/
    darwin-arm64/
      node/
        bin/
          node
      slei-daemon
      slei-cli
      workers/
        claude-agent/
          local-runner.js
          package.json
```

Package scripts：

- `pnpm --filter @slei/desktop package:mac`
  - 构建 renderer。
  - 构建 Electron main/preload。
  - 构建 `slei-daemon` 和 `slei-cli` release binary。
  - 构建 worker 单文件 artifact。
  - 准备 darwin-arm64 Node.js runtime。
  - 复制资源到 `apps/desktop/dist-native/darwin-arm64`。
  - 调用 `electron-builder --mac dmg zip --arm64`。
- `pnpm --filter @slei/desktop package:mac:dir`
  - 使用同一资源准备流程。
  - 调用 `electron-builder --mac dir --arm64` 或等价 dry-run，用于 CI。

renderer 资源加载：

- 开发模式继续加载 `VITE_DEV_URL`。
- 生产模式必须加载随包 renderer build，例如 `BrowserWindow.loadFile(path.join(app.getAppPath(), "dist/index.html"))` 或等价 asar 安全路径。
- `createMainWindow` 需要把 dev/prod renderer 入口解析抽成可测试 helper，确保 packaged App 不再尝试连接 `127.0.0.1:1420`。
- 打包测试必须覆盖 `app.isPackaged=true` 时的 renderer 入口。

`electron-builder.yml` 关键配置：

- `appId: ai.slei.desktop`
- `productName: Slei`
- `directories.output: release`
- `files` 包含 `dist/**`、`dist-electron/**` 和必要 package metadata。
- `extraResources` 将 `dist-native/darwin-arm64/**` 复制到 `native/darwin-arm64`。
- `asar: true`，但 native binary 和 worker dist 必须通过 `extraResources` 留在 asar 外。
- `mac.target` 包含 `dmg` 和 `zip`。
- `mac.category: public.app-category.productivity`。
- `artifactName: Slei-${version}-${arch}.${ext}`。

签名和公证：

- 预留 `APPLE_ID`、`APPLE_TEAM_ID`、`CSC_LINK`、`CSC_KEY_PASSWORD` 等环境变量。
- 默认无证书时跳过签名/公证，CI dry-run 不依赖 Apple Developer 凭据。
- 不引入自动更新配置。

架构策略：

- 本轮实际支持 `darwin-arm64`。
- 脚本可预留 `SLEI_PACKAGE_ARCH=arm64|x64|universal`，但 x64/universal 必须明确退出并提示“该架构留待后续支持”，或只做 dry-run，不假装可用。

## 随包 native resources

生产包必须包含：

- `slei-daemon` release binary。
- `slei-cli` release binary。
- darwin-arm64 Node.js runtime，至少包含可执行 `node`。
- `workers/claude-agent/local-runner.js` 单文件 worker artifact。
- worker 所需最小 metadata，例如 `package.json`，用于 health/diagnostic 校验。

Electron main 在生产模式下从 `process.resourcesPath/native/darwin-arm64/` 定位这些资源。缺少资源时返回 typed error，例如 `daemon_resource_missing`，renderer 展示清晰的本地 daemon/runtime 不可用状态，不 fallback 到 mock 或开发路径。

worker 分发策略：

- 不把裸 `workers/claude-agent/dist` 视为完整生产 artifact，因为它依赖 npm runtime dependencies。
- 本轮打包前必须把 `workers/claude-agent/src/local-runner.ts` 及其运行依赖 bundle 成单文件 Node artifact，例如 `dist-package/local-runner.js`。
- bundle 目标可以是 Node ESM 或 CJS，但必须能由 daemon 当前 `Command::new("node").arg(runner_path)` 模型直接执行。
- Node.js runtime 随包分发，并通过 PATH 注入让 daemon 的 `Command::new("node")` 命中随包 node，而不是依赖用户系统 Node。
- `@anthropic-ai/sdk`、`@modelcontextprotocol/sdk`、`zod` 等 worker 运行依赖应进入 bundle；Node 内置模块和外部 `claude` CLI 不进入 bundle。
- 打包验证需要在清空用户 Node PATH 的环境下执行 worker health 或最小 spawn 测试，证明随包 node + worker artifact 足够启动。

资源准备脚本必须可测试：

- 验证 release binary 存在且可执行。
- 验证随包 node 存在且可执行。
- 验证 worker 单文件 artifact 存在，并且不依赖 production `node_modules`。
- 验证资源复制后目录结构和 `electron-builder.yml` 的 `extraResources` 匹配。
- 验证 `@tauri` 依赖和 `src-tauri` 不参与打包。

## 生产启动与数据目录

Electron main 根据 `app.isPackaged` 区分开发和生产：

开发模式：

- 继续使用 `apps/desktop/scripts/desktop-dev.sh`。
- 构建 worker、CLI、daemon debug binary。
- Electron main 使用 repo 下 `target/debug/slei-daemon`、`target/debug/slei-cli`、`workers/claude-agent/dist`。
- 数据目录继续沿用开发数据，保持现有开发验收体验。

生产模式：

- Electron main 使用随包 `native/darwin-arm64` 资源。
- 生产应用数据根使用 Electron `app.getPath("userData")`，例如 macOS 上通常是 `~/Library/Application Support/Slei`。
- daemon 产品数据根使用 `path.join(app.getPath("userData"), "data")`，并作为 `SLEI_DATA_ROOT` 传给 daemon，避免出现 `Slei/Slei` 嵌套。
- 生产数据不自动读取或污染开发 `~/.slei`。
- 本轮只在文档中说明导入/迁移属于后续设计范围，不做自动迁移。

daemon env：

- `SLEI_DAEMON_TOKEN`：生产模式由 Electron main 为每次 App 启动生成随机 session token，不暴露给 renderer。daemon 需要支持用该 env 覆盖当前静态 token。
- `SLEI_DATA_ROOT`：指向 `path.join(app.getPath("userData"), "data")`。
- `SLEI_CLAUDE_AGENT_RUNNER`：指向随包 `native/darwin-arm64/workers/claude-agent/local-runner.js`。
- `PATH`：前置随包 `native/darwin-arm64/node/bin` 和 `native/darwin-arm64`，再追加用户 shell PATH。这样 daemon 能找到随包 `node`、随包 `slei-cli` 和用户环境里的 `claude`。
- `SLEI_DAEMON_URL`：供 daemon/worker 回连本地 daemon。

端口策略：

- 开发模式保持 `127.0.0.1:4319`，继续允许连接已有兼容 daemon。
- 生产模式不连接已有 4319 daemon，必须启动自己 owned 的随包 daemon，使用随机 session token 和生产 `SLEI_DATA_ROOT`。
- 生产 daemon 应绑定到 loopback 上的动态端口，推荐 `SLEI_DAEMON_ADDR=127.0.0.1:0` 并由 Electron main 从 daemon stdout/ready handshake 读取实际地址；也可以由 Electron main 选择空闲端口并传入，但必须测试端口冲突处理。
- 生产模式如果随包 daemon 无法启动，显示不可用和重试入口，不强杀未知进程。
- Electron main 只清理由自己启动的 owned daemon 和 worker 子进程。

生产验收：

- 打包 `.app` 启动后能拉起随包 daemon。
- `/v1/nodes` 能检查 Claude runtime；用户机器已有 Claude Code 时应显示 ready。
- 频道列表和发送消息仍通过 daemon 完成。
- 重启 App 后数据落在 `path.join(app.getPath("userData"), "data")`，而不是开发 `~/.slei`。
- 如果开发 daemon 正在 4319 运行，生产 `.app` 仍启动自己的 owned daemon，并使用生产 data root。
- renderer 无法读取 daemon token 或 endpoint。

## macOS polish 与应用元信息

应用元信息：

- 应用名：`Slei`。
- bundle id：`ai.slei.desktop`。
- 图标：从旧 Tauri `icon.icns` 迁移到 `apps/desktop/build/icon.icns`，再删除 `src-tauri`。
- mac category：`public.app-category.productivity`。

窗口配置：

- `width: 1280`
- `height: 800`
- 合理 `minWidth` / `minHeight`
- `titleBarStyle: "hiddenInset"` 或等价 macOS 原生标题栏隐藏方案
- `trafficLightPosition` 精调，匹配当前左侧 chrome 顶部留白
- `transparent: true`
- `backgroundColor: "#00000000"`
- `vibrancy` 使用 `sidebar`、`under-window` 或测试后最接近现有视觉的效果
- `visualEffectState: "active"`

非 macOS 或 Electron 不支持时，窗口配置必须回退到安全默认背景，不影响业务功能。

前端配合：

- 现有 frosted/glass shell 继续由 CSS 和 app frame 控制。
- 根节点和主要 workspace 页面保持透明背景的测试继续保留。
- `data-desktop-drag-region` 映射 `-webkit-app-region: drag`。
- 按钮、输入、菜单、可滚动交互区域显式 `-webkit-app-region: no-drag` 或不继承 drag。

回退策略：

- 提取 `createWindowVisualOptions(platform, packaged)` 或等价 helper，集中控制透明、vibrancy、titlebar 和 traffic light。
- 测试覆盖 macOS 透明/vibrancy 配置和非 macOS 安全默认。
- 如果透明/vibrancy 导致 UI 不可读，回退到不透明窗口也不能影响 daemon 闭环。

## CI 与验证矩阵

CI 更新：

- 保留现有 lint、typecheck、test、locale、contract、Rust fmt/clippy/test。
- 将 `scripts/verify-macos-package.sh` 改为 Electron package boundary guardrail。
- 在 macOS CI 上增加 `pnpm --filter @slei/desktop package:mac:dir` 或等价 dry-run。
- 不上传 artifact，不要求证书。

验证矩阵：

- JS/TS：
  - `pnpm --filter @slei/desktop typecheck`
  - `pnpm --filter @slei/desktop test`
  - Electron main/lifecycle/rpc/preload/window visual/package scripts/daemon bridge 相关测试。
- Rust：
  - `cargo test -p slei-daemon`
  - `cargo test -p slei-cli`
  - `cargo metadata` guardrail 确认无 Tauri workspace member。
- Package：
  - `bash scripts/verify-macos-package.sh`
  - `pnpm --filter @slei/desktop package:mac:dir`
  - 随包 node + worker artifact 在清空用户 Node PATH 后的最小启动检查。
  - 本机完整包：`pnpm --filter @slei/desktop package:mac`
- 手工验收：
  - 打开 `.app`。
  - 本地 daemon ready。
  - ClaudeCode runtime ready 或显示清晰中文不可用原因。
  - 频道列表和消息发送可用。
  - 退出 App 后 owned daemon 被清理。
  - production data 写入 `path.join(app.getPath("userData"), "data")`，不污染开发 `~/.slei`。

## 实施阶段

1. Tauri 删除与命名收口。
2. Electron package 配置。
3. 随包 native resources。
4. 生产 daemon 启动与 userData。
5. macOS polish。
6. CI dry-run 和文档验收。

每个阶段都需要使用 TDD 或先写 guardrail，再实施，再验证。每个阶段都应形成独立提交，方便回滚和 review。

## 风险

- 生产 daemon 找不到随包 CLI 或 worker，导致频道 agent 无法 claim/send。
- 用户 shell PATH 与 packaged App 环境不同，导致 Claude Code 检测不到。
- 生产包缺少 Node runtime 或 worker bundle，导致 daemon 无法启动 JS worker。
- `asar` 错误打包 native binary 或 worker dist，导致运行时不可执行。
- 生产包误连开发 daemon，导致 production data 隔离失效。
- Tauri 删除不彻底，测试或 bridge fallback 仍引用旧 API。
- 透明/vibrancy 导致文字不可读或交互区域误变成 draggable。
- 生产数据目录切换导致用户误以为数据丢失，需要清晰文档说明。

## 成功标准

V2 完成时必须满足：

- Slei desktop 代码库不再有活跃 Tauri 底座。
- 本机能产出 macOS arm64 `.dmg` / `.zip`。
- CI 能跑 Electron package dry-run。
- 打包 `.app` 从随包 `dist/index.html` 加载 renderer，不依赖 Vite dev server。
- 打包 `.app` 使用随包 daemon、CLI、Node runtime 和 worker artifact 启动。
- 生产 `.app` 不连接开发 4319 daemon；它启动 owned daemon、随机 token 和生产 data root。
- Electron renderer 仍只通过 typed RPC 访问 daemon。
- 生产数据目录与开发数据隔离。
- 应用名、bundle id、图标和 macOS 窗口体验符合正式桌面 App 预期。
- 核心产品路径：启动、runtime readiness、频道列表、发送消息、事件刷新、退出 cleanup 均可验收。
