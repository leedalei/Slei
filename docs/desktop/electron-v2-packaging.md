# Electron V2 打包与迁移说明

本文记录 Slei Desktop Electron V2 的 macOS 打包命令、数据目录边界和后续迁移事项。V2 目标是完成 Electron-only 的 macOS arm64 可分享包基础链路，不包含自动数据导入、自动更新、x64/universal 实际发布或正式签名公证闭环。

## 开发启动

开发 App 命令保持不变：

```bash
pnpm --filter @slei/desktop desktop
```

该命令仍用于本地开发和日常调试。开发模式继续沿用现有开发数据目录 `~/.slei`，方便开发环境反复启动、reset 和验证。

当用户说「启动APP」或「启动 App」时，默认也应启动这个桌面 App 命令，而不是启动网页/Vite dev server。

## macOS 打包命令

V2 使用 `electron-builder` 构建 macOS arm64 产物。

用于 CI dry-run 或本地 smoke 的 `.app` 目录构建：

```bash
pnpm --filter @slei/desktop package:mac:dir
```

该命令会走同一套 renderer、Electron main/preload、Rust release binary、worker bundle、随包 Node runtime 和 native resource 准备流程，然后生成本地 `.app` 目录。它适合 CI 和 smoke 验证，不要求产出可分发压缩包。

用于本机完整可分享包构建：

```bash
pnpm --filter @slei/desktop package:mac
```

该命令构建 `.dmg` 和 `.zip`。签名和公证配置在 V2 中只做预留；没有 Apple Developer 凭据时，不应阻塞 V2 的本地目录包和基础打包验证。

CI dry-run 需要可用的 arm64 macOS runner，例如 `macos-15-xlarge`，或仓库等价配置的自托管 arm64 macOS runner。若 runner 权限或资源不可用，应先配置 CI runner，不应把 `package:mac:dir` 静默跳过后报告成功。

## 生产与开发数据目录

开发环境数据保持在：

```text
~/.slei
```

生产包数据根使用 Electron `app.getPath("userData")/data`。也就是说 Electron main 会把 daemon 产品数据根设置为：

```text
path.join(app.getPath("userData"), "data")
```

并通过 `SLEI_DATA_ROOT` 传给 daemon。不要在文档或业务逻辑中硬编码某一个绝对路径，因为 `userData` 目录会受 Electron app identity、平台和打包元信息影响。

V2 的生产包不会自动读取、导入或污染开发目录 `~/.slei`。生产数据和开发数据默认隔离；从开发数据导入生产包属于后续迁移设计范围。

## V2 不包含的迁移事项

以下能力属于 V3 或后续工作：

- x64 和 universal macOS 产物的实际构建与发布。
- 正式签名与 notarization 跑通。
- 自动更新。
- 开发数据到生产数据的导入、迁移 UI 或兼容策略。

在这些能力完成前，验收和用户说明都应避免暗示 V2 已支持自动数据导入或跨架构生产发布。

## 验收命令

文档或打包相关改动完成后，至少运行：

```bash
bash scripts/verify-macos-package.sh
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop typecheck
cargo test -p slei-daemon
cargo test -p slei-cli
```

如果在 Task 8 之后修改了 package script、resource path、Electron main、daemon startup 或 CI 文件，还需要重新运行：

```bash
pnpm --filter @slei/desktop package:mac:dir
```

仅修改本文档时，不需要额外重跑 `.app` 目录构建。
