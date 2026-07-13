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

CI dry-run 使用标准 arm64 macOS runner `macos-15`，其用量优先计入 GitHub 套餐包含的 Actions 分钟；超出额度后可能产生费用。也可以使用仓库等价配置的自托管 arm64 macOS runner。若 runner 权限或资源不可用，应先配置 CI runner，不应把 `package:mac:dir` 静默跳过后报告成功。

## GitHub Release 自动发布

正式发布默认从 `master` 分支执行：

```bash
pnpm release:desktop 0.1.1
```

该命令会检查工作区是否干净、当前分支是否为 `master`、本地和 `origin` 是否已存在同名 tag，然后更新 `apps/desktop/package.json` 的版本号，创建 `chore(release): v0.1.1` 提交，创建并推送 `v0.1.1` tag。

tag 推送后，GitHub Actions 会在 macOS arm64 runner 上构建 `.dmg` 和 `.zip`，生成 `SHA256SUMS.txt`，并使用 GitHub 自动生成的 release notes 创建 Release。该流程仍不包含签名、公证、自动更新或多平台产物。

若 tag 已存在、但对应 Release 因 Actions runner 或外部服务故障而未创建，可以在 GitHub Actions 中手动运行 Release workflow，并把既有 tag（例如 `v0.1.0`）作为 `tag` 输入。工作流会检出该 tag、校验其版本并创建 Release，不移动或覆盖 tag。

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
