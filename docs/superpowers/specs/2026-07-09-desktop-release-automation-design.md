# Slei Desktop Release 自动化设计

## 背景

Slei Electron V2 已经完成 macOS arm64 打包基础链路：`pnpm --filter @slei/desktop package:mac` 可以构建 `.dmg` 和 `.zip`，CI 中已有 macOS arm64 package dry-run。下一步需要把“本地改版本、打 tag、GitHub Release 上传安装包”收口成一个小而稳的发布流程，降低手工发布时漏改版本、漏传资产或 tag/release 不一致的风险。

本设计只覆盖 GitHub Release 自动化，不改变 daemon、renderer、Electron main、生产数据目录或打包资源解析逻辑。

## 目标

- 提供一条本地一键发布命令：`pnpm release:desktop 0.1.1`。
- 推送 `v*.*.*` tag 后，GitHub Actions 自动构建 macOS arm64 `.dmg` 和 `.zip`。
- GitHub Release 页面自动包含安装包、`SHA256SUMS.txt` 和自动生成的 release notes。
- 发布流程复用现有 V2 打包脚本和 package boundary guardrail。
- 避免覆盖已有 Release 或在版本/tag 不一致时发布错误产物。

## 非目标

- 不做 Windows/Linux 打包。
- 不做 x64/universal macOS 产物。
- 不做 Apple Developer ID 签名、公证或 keychain 配置。
- 不做自动更新客户端逻辑，也不生成自动更新 metadata 合同。
- 不维护自定义 changelog 解析器或 release notes 模板。
- 不自动覆盖已有 GitHub Release。

## 用户流程

开发者完成准备发布的代码后，在本地运行：

```bash
pnpm release:desktop 0.1.1
```

脚本会更新 `apps/desktop/package.json` 的 `version`，提交版本变更，创建 `v0.1.1` tag，并 push 当前分支和 tag。GitHub Actions 收到 tag 后创建 Release，自动生成 release notes，并上传 macOS arm64 安装包和校验和。

发布默认从 `master` 分支执行，避免从临时工作分支打出正式 tag。如果当前分支不是 `master`，脚本应失败并提示先合并或切回 `master` 后发布。

如果工作区不干净、版本号不合法、本地 tag 已存在、`origin` 远端 tag 已存在、当前分支没有 upstream 或 push 失败，脚本应失败并保留清晰错误信息。本轮固定使用 `origin` 作为 tag 查询和 tag push 远端。

## 本地发布脚本

新增 `scripts/release-desktop.mjs`，根 `package.json` 增加：

```json
"release:desktop": "node scripts/release-desktop.mjs"
```

脚本职责：

1. 接收一个必填版本号参数，格式为 `x.y.z`。
2. 检查 git 工作区干净，避免把用户未完成改动混入 release commit。
3. 检查当前目录在 git 仓库内，并确认当前分支是 `master`。
4. 检查本地和 `origin` 远端不存在 `v<version>` tag。
5. 用 JSON 解析/序列化方式更新 `apps/desktop/package.json` 的 `version`，保持文件末尾换行。
6. 运行轻量 guardrail：
   - `bash scripts/verify-macos-package.sh`
   - `node scripts/verify-release-workflow.mjs`
   - `node --test scripts/verify-release-workflow.test.mjs`
7. 创建提交：`chore(release): v<version>`。
8. 创建 tag：`v<version>`。
9. push 当前分支到其 upstream，并 push tag 到 `origin`。

脚本不在本地执行完整 macOS 打包，正式产物由 GitHub Actions 构建，保证发布资产来自干净 CI 环境。

## GitHub Release Workflow

新增 `.github/workflows/release.yml`。

触发条件：

```yaml
on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      tag:
        description: Existing release tag to publish
        required: true
        type: string
```

权限：

```yaml
permissions:
  contents: write
```

Job 使用标准 arm64 runner `macos-15`，其用量优先计入 GitHub 套餐包含的 Actions 分钟；超出额度后可能产生费用。工作流把 tag push 的 ref 或手动输入的既有 tag 统一映射为 `RELEASE_TAG`。步骤：

1. checkout。
2. 使用与 CI 一致的 setup action：`pnpm/action-setup@v4` 配置 pnpm 10、`actions/setup-node@v4` 配置 Node 22、`dtolnay/rust-toolchain@stable` 配置 Rust stable。
3. `pnpm install --frozen-lockfile`。
4. 检出 `RELEASE_TAG`，并校验其去掉 `v` 后等于 `apps/desktop/package.json` 的 `version`。
5. 运行 `bash scripts/verify-macos-package.sh`。
6. 运行 `pnpm --filter @slei/desktop package:mac`。
7. 在 `apps/desktop/release` 生成 `SHA256SUMS.txt`：

   ```bash
   shasum -a 256 Slei-* > SHA256SUMS.txt
   ```

8. 使用 GitHub CLI 创建 Release 并上传资产：

   ```yaml
   - name: Create GitHub Release
     env:
       GH_TOKEN: ${{ github.token }}
     run: |
       gh release create "$RELEASE_TAG" \
         --verify-tag \
         --fail-on-no-commits \
         --generate-notes \
         apps/desktop/release/Slei-*.dmg \
         apps/desktop/release/Slei-*.zip \
         apps/desktop/release/SHA256SUMS.txt
   ```

该步骤必须设置 `GH_TOKEN: ${{ github.token }}`，让 GitHub CLI 使用 workflow 的 `contents: write` 权限创建 Release 和上传资产。

`--verify-tag` 确保 Release 绑定已存在的远端 tag；`--fail-on-no-commits` 避免重复空发布；`--generate-notes` 使用 GitHub Release Notes API 自动生成说明。

## Guardrail

新增 `scripts/verify-release-workflow.mjs` 和 `scripts/verify-release-workflow.test.mjs`。

`verify-release-workflow.mjs` 检查 `.github/workflows/release.yml` 的关键发布约束：

- 文件存在。
- 监听 `v*.*.*` tag。
- 支持通过 `workflow_dispatch` 输入既有 tag 重试失败的发布。
- 使用标准 arm64 runner `macos-15`。
- 配置 `contents: write`。
- 检出 `RELEASE_TAG`，并包含 tag 与 `apps/desktop/package.json` version 一致性校验。
- 执行 `bash scripts/verify-macos-package.sh`。
- 执行 `pnpm --filter @slei/desktop package:mac`。
- 生成 `SHA256SUMS.txt`。
- 使用 `gh release create`。
- release 创建步骤设置 `GH_TOKEN: ${{ github.token }}`。
- 使用 `--verify-tag`、`--fail-on-no-commits` 和 `--generate-notes`。
- 上传 `.dmg`、`.zip` 和 `SHA256SUMS.txt`。

根 `package.json` 的 `test:guardrails` 应纳入 release workflow guardrail 测试，避免 CI 默认测试遗漏发布配置回归。

## 错误处理

- 本地脚本在任何 git、JSON、guardrail 或 push 步骤失败时退出非零，并打印失败步骤。
- 如果 commit 创建后 tag 或 push 失败，脚本不自动回滚 commit/tag，避免误删用户状态；错误信息提示开发者检查后手工处理。
- Release workflow 中如果 GitHub Release 已存在，`gh release create` 失败；本轮不自动覆盖资产。
- 如果 GitHub runner 不满足 arm64 macOS，现有 `verify-macos-package.sh` 的 arm64 校验继续负责阻断。

## 测试

新增测试重点覆盖：

- `verify-release-workflow.mjs` 对完整 workflow 通过。
- 缺少 tag trigger、macOS arm64 runner、版本校验、`package:mac`、SHA256、`GH_TOKEN` 或 `--generate-notes` 时失败。
- `release-desktop.mjs` 的纯 helper 可测试部分，例如版本号校验、tag 名生成、package version 更新逻辑。

不在单元测试中真实创建 git tag、push 或 GitHub Release；这些动作通过脚本结构、guardrail 和手工 dry-run 验证。

## 验收

实施完成后至少运行：

```bash
node scripts/verify-release-workflow.mjs
node --test scripts/verify-release-workflow.test.mjs
bash scripts/verify-macos-package.sh
pnpm test:guardrails
pnpm --filter @slei/desktop typecheck
```

发布前手工验证：

```bash
pnpm release:desktop 0.1.1
```

预期结果是 GitHub Actions 在 tag 上生成 Release，Release 页面包含 `.dmg`、`.zip`、`SHA256SUMS.txt` 和自动生成的 release notes。

## 后续工作

- Apple Developer ID 签名和 notarization。
- 自动更新及更新状态 UI。
- Windows/Linux 打包和 Release 资产。
- 自定义 release notes 模板或 changelog 策略。
