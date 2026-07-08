# Slei Electron V2 Packaging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Slei desktop 从 V1 Electron 开发底座收口为 Electron-only macOS arm64 桌面 App：彻底移除活跃 Tauri 底座，接入 `electron-builder`，随包分发 daemon/CLI/Node/worker 资源，生产模式启动独立 owned daemon，并完成 macOS 元信息和窗口 polish。

**Architecture:** 业务逻辑、状态、路由、持久化、任务和 agent 协作仍全部在 daemon；Electron main 只负责桌面壳、生产资源定位、owned daemon 生命周期、受控 IPC/RPC、窗口选项和打包资源边界。Renderer 继续通过 typed daemon bridge 访问 daemon，不新增本地 mock 或 UI 侧业务规则。

**Tech Stack:** Electron 43, electron-builder, React 19, Vite 7, Vitest, Playwright, TypeScript, Rust daemon/CLI, pnpm workspace, macOS arm64.

---

## Scope Check

本计划只覆盖 V2 中用户确认的 1、2、4：

- Electron-only/Tauri cleanup。
- macOS 可分享安装包和随包 runtime resource。
- macOS polish、应用 metadata、CI package dry-run。

本计划不做自动更新、Windows/Linux 打包、x64/universal 实际支持、正式 Apple 签名/公证跑通、复杂数据迁移或 daemon crash-recovery 增强。x64/universal、签名/公证和开发数据导入只预留入口和文档。

## Relevant References

- 设计稿：`docs/superpowers/specs/2026-07-08-electron-v2-packaging-design.md`
- V1 计划：`docs/superpowers/plans/2026-07-07-electron-desktop-foundation.md`
- Runtime boundary：`docs/architecture/0001-runtime-adapter-and-process-boundaries.md`
- Channel routing：`docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Task/card：`docs/architecture/0006-task-source-message-card.md`
- 当前 package guardrail：`scripts/verify-macos-package.sh`

## File Structure

移除旧 Tauri 活跃路径：

- Delete: `apps/desktop/src-tauri/**`
- Modify: `Cargo.toml`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.test.ts`
- Modify: `apps/desktop/src/lib/frontend-crash-logging.ts`
- Modify: `apps/desktop/src/lib/frontend-crash-logging.test.ts`
- Modify: UI drag-region call sites under `apps/desktop/src/app/**` and `apps/desktop/src/features/**`

新增/更新 Electron packaging 文件：

- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/build/icon.icns`
- Create: `apps/desktop/build/entitlements.mac.plist`
- Create: `apps/desktop/scripts/package-macos.sh`
- Create: `apps/desktop/scripts/prepare-package-resources.mjs`
- Create: `apps/desktop/scripts/prepare-node-runtime.mjs`
- Create: `apps/desktop/scripts/bundle-claude-worker.mjs`
- Create: `apps/desktop/scripts/package-resource-check.mjs`
- Create: `apps/desktop/build/node-runtime-version.txt`
- Modify: `apps/desktop/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/verify-macos-package.sh`

新增/更新 Electron runtime 文件：

- Modify: `apps/desktop/src/electron/constants.ts`
- Modify: `apps/desktop/src/electron/main.ts`
- Modify: `apps/desktop/src/electron/daemon-lifecycle.ts`
- Modify: `apps/desktop/src/electron/daemon-lifecycle.test.ts`
- Create: `apps/desktop/src/electron/packaged-resources.ts`
- Create: `apps/desktop/src/electron/packaged-resources.test.ts`
- Create: `apps/desktop/src/electron/renderer-entry.ts`
- Create: `apps/desktop/src/electron/renderer-entry.test.ts`
- Create: `apps/desktop/src/electron/window-options.ts`
- Create: `apps/desktop/src/electron/window-options.test.ts`

更新 daemon/worker 支撑：

- Modify: `crates/slei-daemon/src/main.rs`
- Modify: `crates/slei-daemon/src/adapters/worker_rpc.rs` if needed for tests/diagnostics only; keep `Command::new("node")` unless package validation proves config is required.
- Modify/Add Rust tests near daemon startup/token/env behavior.
- Modify: `workers/claude-agent/src/local-runner.ts`
- Modify: `workers/claude-agent/package.json`

文档：

- Modify: `docs/superpowers/specs/2026-07-08-electron-v2-packaging-design.md` only if implementation changes DTO/UX/compat assumptions.
- Create or update a short Chinese acceptance note under `docs/desktop/` if an existing desktop doc location is present.

## Task 1: Tauri Boundary Guardrail And Drag Region Rename

**Files:**
- Modify: `scripts/verify-macos-package.sh`
- Modify: `apps/desktop/e2e/startup.spec.ts`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- Modify: `apps/desktop/src/features/tasks/TasksPageView.test.tsx`
- Modify: `apps/desktop/src/features/computers/ComputersPageView.test.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.test.tsx`
- Modify: `apps/desktop/src/features/members/MembersPageView.test.tsx`
- Modify/Add: `apps/desktop/src/features/search/SearchPageView.test.tsx`
- Modify: `apps/desktop/e2e/react-shell.spec.tsx`
- Modify: all active UI files using `data-tauri-drag-region`

- [ ] **Step 1: Add failing active-Tauri guardrails**

Update `scripts/verify-macos-package.sh` so it validates Electron package boundaries instead of reading `apps/desktop/src-tauri/tauri.conf.json`.

The script must fail on active code/config/package references:

```sh
if test -d apps/desktop/src-tauri; then
  echo "active Tauri source directory must not exist" >&2
  exit 1
fi

rg -n "@tauri-apps|src-tauri|tauri dev" \
  Cargo.toml apps/desktop/package.json apps/desktop/src apps/desktop/scripts scripts .github/workflows \
  && exit 1
```

Do not scan historical `docs/superpowers/specs` or `docs/superpowers/plans`; old documents may mention Tauri as history.

- [ ] **Step 2: Update DOM tests before implementation**

Change tests to expect `data-desktop-drag-region` and to assert no `data-tauri-drag-region` appears in rendered shell/page DOM.

Run:

```bash
pnpm --filter @slei/desktop exec vitest run \
  src/app/SleiAppFrame.test.tsx \
  src/features/chat/ChatPageView.test.tsx \
  src/features/tasks/TasksPageView.test.tsx \
  src/features/computers/ComputersPageView.test.tsx \
  src/features/settings/SettingsPageView.test.tsx \
  src/features/members/MembersPageView.test.tsx \
  e2e/react-shell.spec.tsx \
  --reporter=verbose
```

Expected before implementation: FAIL on missing `data-desktop-drag-region`.

If `SearchPageView` has no current DOM test, add one that renders the search header/form and asserts the new drag attribute plus no drag attribute on the input.

- [ ] **Step 3: Rename active UI drag attributes**

Replace `data-tauri-drag-region` with `data-desktop-drag-region` in active renderer files. Preserve CSS behavior by mapping the new attribute to `-webkit-app-region: drag`; interactive controls must remain no-drag.

- [ ] **Step 4: Verify guardrail fails before Tauri deletion**

Run:

```bash
bash scripts/verify-macos-package.sh
```

Expected: FAIL while `apps/desktop/src-tauri` still exists. This proves the guardrail catches the old active path.

- [ ] **Step 5: Commit only the guardrail and rename**

Run the DOM test command from Step 2 again. Expected: PASS.

Commit:

```bash
git add scripts/verify-macos-package.sh apps/desktop/e2e/startup.spec.ts apps/desktop/src
git commit -m "test(desktop): guard electron-only desktop boundary"
```

## Task 2: Delete Tauri Active Code And Dependencies

**Files:**
- Delete: `apps/desktop/src-tauri/**`
- Modify: `Cargo.toml`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.test.ts`
- Modify: `apps/desktop/src/lib/frontend-crash-logging.ts`
- Modify: `apps/desktop/src/lib/frontend-crash-logging.test.ts`

- [ ] **Step 1: Preserve icon before deletion**

Copy the existing icon out of the Tauri tree:

```bash
mkdir -p apps/desktop/build
cp apps/desktop/src-tauri/icons/icon.icns apps/desktop/build/icon.icns
```

Do this before deleting `apps/desktop/src-tauri`.

- [ ] **Step 2: Remove Tauri from package and workspace**

Remove `apps/desktop/src-tauri` from root `Cargo.toml` workspace members.

Remove from `apps/desktop/package.json`:

- `@tauri-apps/api`
- `@tauri-apps/cli`

Run:

```bash
pnpm install --lockfile-only
```

- [ ] **Step 3: Remove Tauri bridge fallback**

In `apps/desktop/src/lib/daemon-bridge.ts`, delete imports and branches using `@tauri-apps/api/core` and `@tauri-apps/api/event`. The production-capable bridge choices after this task should be:

- Electron `window.slei` bridge.
- Offline/noop bridge for daemon-unavailable UI state.
- Test mock bridge under test-only utilities.

Do not add a local mock production bridge.

- [ ] **Step 4: Remove Tauri crash logging fallback**

In `apps/desktop/src/lib/frontend-crash-logging.ts`, remove dynamic `@tauri-apps/api/core` import. Crash/event logs should use the Electron bridge when present and console fallback when unavailable.

- [ ] **Step 5: Delete Tauri source tree**

Delete `apps/desktop/src-tauri`.

- [ ] **Step 6: Verify deletion and package lock**

Run:

```bash
bash scripts/verify-macos-package.sh
cargo metadata --format-version 1 >/tmp/slei-cargo-metadata.json
pnpm --filter @slei/desktop exec vitest run \
  src/lib/daemon-bridge.test.ts \
  src/lib/frontend-crash-logging.test.ts \
  --reporter=verbose
pnpm --filter @slei/desktop typecheck
```

Expected:

- `verify-macos-package.sh` passes active Tauri checks after later Electron package files exist; if it also checks files not created yet, it may fail on those expected package prerequisites. Do not weaken the no-Tauri checks.
- `cargo metadata` output has no `src-tauri` package.
- Vitest and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml apps/desktop/build/icon.icns apps/desktop/package.json pnpm-lock.yaml apps/desktop/src scripts/verify-macos-package.sh
git add -u apps/desktop/src-tauri
git commit -m "refactor(desktop): remove active tauri runtime"
```

## Task 3: Production Renderer Entry And Window Options

**Files:**
- Create: `apps/desktop/src/electron/renderer-entry.ts`
- Create: `apps/desktop/src/electron/renderer-entry.test.ts`
- Create: `apps/desktop/src/electron/window-options.ts`
- Create: `apps/desktop/src/electron/window-options.test.ts`
- Modify: `apps/desktop/src/electron/main.ts`

- [ ] **Step 1: Test renderer entry behavior**

Create tests for a helper like:

```ts
resolveRendererEntry({
  isPackaged,
  devUrl,
  appPath,
})
```

Required cases:

- dev returns `{ kind: "url", value: "http://127.0.0.1:1420" }`.
- packaged returns `{ kind: "file", value: "<appPath>/dist/index.html" }`.
- packaged never returns `127.0.0.1:1420`.

Run:

```bash
pnpm --filter @slei/desktop exec vitest run src/electron/renderer-entry.test.ts --reporter=verbose
```

Expected before implementation: FAIL.

- [ ] **Step 2: Implement renderer entry helper and use it**

Update `createMainWindow` so development calls `window.loadURL(...)` and production calls `window.loadFile(...)` with the packaged renderer path.

Do not pass the daemon token or daemon endpoint through renderer query params.

- [ ] **Step 3: Test macOS visual options**

Create tests for a helper like:

```ts
createWindowVisualOptions({
  platform,
  isPackaged,
})
```

Required macOS assertions:

- `titleBarStyle` is `hiddenInset` or equivalent chosen value.
- `trafficLightPosition` is set.
- `transparent: true`.
- `backgroundColor: "#00000000"`.
- `vibrancy` and `visualEffectState: "active"` are set.
- Width/height/min sizes are stable.

Required non-macOS assertion:

- Transparent/vibrancy options are omitted or safely disabled.

- [ ] **Step 4: Implement visual options in `main.ts`**

Apply the helper to `BrowserWindow` options. Preserve security options:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- preload path unchanged

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @slei/desktop exec vitest run \
  src/electron/renderer-entry.test.ts \
  src/electron/window-options.test.ts \
  src/electron/main.test.ts \
  --reporter=verbose
pnpm --filter @slei/desktop typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/electron
git commit -m "feat(desktop): load packaged renderer and polish mac window"
```

## Task 4: Electron Builder Config And Package Scripts

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/build/entitlements.mac.plist`
- Create: `apps/desktop/scripts/package-macos.sh`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/e2e/startup.spec.ts`
- Modify: `scripts/verify-macos-package.sh`

- [ ] **Step 1: Write package config tests**

Extend `apps/desktop/e2e/startup.spec.ts` or create a package config test that reads `apps/desktop/electron-builder.yml` and `apps/desktop/package.json`.

Assertions:

- `appId: ai.slei.desktop`
- `productName: Slei`
- `directories.output: release`
- `asar: true`
- `mac.target` includes `dmg` and `zip`
- `mac.category: public.app-category.productivity`
- `extraResources` copies `dist-native/darwin-arm64` to `native/darwin-arm64`
- scripts include `package:mac` and `package:mac:dir`

Run:

```bash
pnpm --filter @slei/desktop exec vitest run e2e/startup.spec.ts --reporter=verbose
```

Expected before implementation: FAIL.

- [ ] **Step 2: Add `electron-builder` dependency and scripts**

Update `apps/desktop/package.json`:

```json
{
  "scripts": {
    "package:mac": "scripts/package-macos.sh dmg zip",
    "package:mac:dir": "scripts/package-macos.sh dir",
    "prepare:package-resources": "node scripts/prepare-package-resources.mjs"
  },
  "devDependencies": {
    "electron-builder": "26.15.3"
  }
}
```

Use the exact version in `package.json`; do not use a range.

Run:

```bash
pnpm install
```

- [ ] **Step 3: Add builder config**

Create `apps/desktop/electron-builder.yml`:

```yaml
appId: ai.slei.desktop
productName: Slei
directories:
  output: release
files:
  - dist/**
  - dist-electron/**
  - package.json
extraResources:
  - from: dist-native/darwin-arm64
    to: native/darwin-arm64
asar: true
mac:
  category: public.app-category.productivity
  icon: build/icon.icns
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  target:
    - dmg
    - zip
artifactName: Slei-${version}-${arch}.${ext}
```

Leave signing/notarization credentials optional; missing credentials must not block `package:mac:dir`.

- [ ] **Step 4: Add package script shell**

Create `apps/desktop/scripts/package-macos.sh`:

- Accept targets `dir`, `dmg`, `zip`.
- Default architecture is `arm64`.
- Allow `SLEI_PACKAGE_ARCH=arm64`.
- Exit clearly for `x64` or `universal`: this plan reserves those for later and must not fake support.
- Run renderer build, Electron build, release Rust builds, worker bundle, Node runtime prep, resource prep, package resource check, then `electron-builder`.

Expected dry-run command inside script:

```bash
electron-builder --config electron-builder.yml --mac dir --arm64
```

- [ ] **Step 5: Update guardrail**

Update `scripts/verify-macos-package.sh` to check:

- Tauri active paths absent.
- `apps/desktop/electron-builder.yml` exists.
- package scripts exist.
- icon and entitlements exist.
- `electron-builder.yml` has the expected `appId`, `productName`, `asar`, mac targets, and `extraResources`.

- [ ] **Step 6: Verify**

Run:

```bash
bash scripts/verify-macos-package.sh
pnpm --filter @slei/desktop exec vitest run e2e/startup.spec.ts --reporter=verbose
pnpm --filter @slei/desktop typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/build apps/desktop/scripts/package-macos.sh apps/desktop/package.json apps/desktop/e2e/startup.spec.ts scripts/verify-macos-package.sh pnpm-lock.yaml
git commit -m "build(desktop): add electron mac packaging config"
```

## Task 5: Bundle Worker And Node Runtime Resources

**Files:**
- Create: `apps/desktop/scripts/bundle-claude-worker.mjs`
- Create: `apps/desktop/scripts/prepare-node-runtime.mjs`
- Create: `apps/desktop/scripts/prepare-package-resources.mjs`
- Create: `apps/desktop/scripts/package-resource-check.mjs`
- Create: `apps/desktop/build/node-runtime-version.txt`
- Modify: `workers/claude-agent/src/local-runner.ts`
- Modify: `workers/claude-agent/package.json`
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Pin Node runtime version for packaging**

Create `apps/desktop/build/node-runtime-version.txt` with one exact Node 22 LTS version. The implementation may choose the exact patch version after checking official Node release availability, but the checked-in file must contain only the version string, for example:

```text
22.18.0
```

The package script must use this file, not “latest”.

- [ ] **Step 2: Write package resource check first**

Create `apps/desktop/scripts/package-resource-check.mjs` and tests or self-check mode that verifies:

- `dist-native/darwin-arm64/slei-daemon` exists and is executable.
- `dist-native/darwin-arm64/slei-cli` exists and is executable.
- `dist-native/darwin-arm64/node/bin/node` exists and is executable.
- `dist-native/darwin-arm64/workers/claude-agent/local-runner.js` exists.
- `dist-native/darwin-arm64/workers/claude-agent/package.json` exists and includes the worker metadata needed for health/diagnostics.
- The worker artifact does not require production `node_modules`.
- `electron-builder.yml` `extraResources` source matches `dist-native/darwin-arm64`.

Run:

```bash
node apps/desktop/scripts/package-resource-check.mjs --root apps/desktop
```

Expected before implementation: FAIL.

- [ ] **Step 3: Add worker health flag before bundling**

Modify `workers/claude-agent/src/local-runner.ts` so it handles `--slei-worker-health` before reading stdin:

```ts
if (process.argv.includes("--slei-worker-health")) {
  process.stdout.write(JSON.stringify({ ok: true, worker: "claude-agent" }) + "\n");
  process.exit(0);
}
```

Keep the normal stdin JSON protocol unchanged for daemon-run worker jobs.

Add or update a worker test if there is an existing worker test harness. At minimum, package resource check in Step 7 must execute the built artifact with this flag and require exit code 0.

- [ ] **Step 4: Bundle `claude-agent` worker into one file**

Create `apps/desktop/scripts/bundle-claude-worker.mjs` using a proven bundler already available or add `esbuild` as an exact devDependency if none exists.

Bundle target:

- Entry: `workers/claude-agent/src/local-runner.ts`
- Output: `apps/desktop/dist-native/darwin-arm64/workers/claude-agent/local-runner.js`
- Platform: `node`
- Node target compatible with the pinned runtime.
- Include runtime dependencies such as `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, and `zod`.
- Externalize only Node built-ins and external user tools like `claude`.

Update `workers/claude-agent/package.json` with a package script if useful, but the desktop package script must be able to call the bundler directly.

- [ ] **Step 5: Prepare pinned Node runtime**

Create `apps/desktop/scripts/prepare-node-runtime.mjs`:

- Read `apps/desktop/build/node-runtime-version.txt`.
- Download the official `node-v<version>-darwin-arm64.tar.gz` into a cache directory such as `apps/desktop/.cache/node-runtime/`.
- Verify the archive extracts a `bin/node`.
- Copy the minimal runtime into `apps/desktop/dist-native/darwin-arm64/node`.
- Make `node/bin/node` executable.
- Print the copied version by running `node/bin/node -v`.

Do not rely on the user's system Node at runtime.

- [ ] **Step 6: Prepare native resources**

Create `apps/desktop/scripts/prepare-package-resources.mjs`:

- Run `cargo build --release -p slei-daemon -p slei-cli` itself unless an explicit `--skip-build` flag is passed. This makes `pnpm --filter @slei/desktop prepare:package-resources` independently usable in verification.
- Copy `target/release/slei-daemon` to `apps/desktop/dist-native/darwin-arm64/slei-daemon`.
- Copy `target/release/slei-cli` to `apps/desktop/dist-native/darwin-arm64/slei-cli`.
- Ensure both binaries are executable.
- Call or validate the worker bundle and Node runtime prep.
- Copy `workers/claude-agent/package.json` to `apps/desktop/dist-native/darwin-arm64/workers/claude-agent/package.json`.
- Write a small manifest JSON under `dist-native/darwin-arm64/resource-manifest.json` with versions and relative paths for diagnostics.

JSON manifest is allowed here because it is build metadata, not production mutable product state.

- [ ] **Step 7: Add PATH-isolated worker health check**

Add a check mode to `package-resource-check.mjs` that runs with a minimal PATH containing only bundled `node/bin` and native dir, then executes:

```bash
dist-native/darwin-arm64/node/bin/node \
  dist-native/darwin-arm64/workers/claude-agent/local-runner.js \
  --slei-worker-health
```

Expected output should confirm worker health exits 0. The exact health output should match the worker's existing behavior.

- [ ] **Step 8: Wire scripts into package flow**

Update `apps/desktop/scripts/package-macos.sh` to call, in order:

```bash
pnpm build
pnpm build:electron
cargo build --release -p slei-daemon -p slei-cli
node scripts/bundle-claude-worker.mjs
node scripts/prepare-node-runtime.mjs
node scripts/prepare-package-resources.mjs --skip-build
node scripts/package-resource-check.mjs --root .
electron-builder ...
```

The script runs from `apps/desktop`, so use repo-root detection for cargo and worker paths.

- [ ] **Step 9: Verify**

Run:

```bash
pnpm --filter @slei/desktop prepare:package-resources
node apps/desktop/scripts/package-resource-check.mjs --root apps/desktop
apps/desktop/dist-native/darwin-arm64/node/bin/node \
  apps/desktop/dist-native/darwin-arm64/workers/claude-agent/local-runner.js \
  --slei-worker-health
pnpm --filter @slei/desktop typecheck
```

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/scripts apps/desktop/build/node-runtime-version.txt apps/desktop/package.json workers/claude-agent/src/local-runner.ts workers/claude-agent/package.json pnpm-lock.yaml
git commit -m "build(desktop): prepare packaged daemon and worker resources"
```

## Task 6: Packaged Resource Resolution And Production Daemon Lifecycle

**Files:**
- Create: `apps/desktop/src/electron/packaged-resources.ts`
- Create: `apps/desktop/src/electron/packaged-resources.test.ts`
- Modify: `apps/desktop/src/electron/constants.ts`
- Modify: `apps/desktop/src/electron/daemon-lifecycle.ts`
- Modify: `apps/desktop/src/electron/daemon-lifecycle.test.ts`
- Modify: `apps/desktop/src/electron/main.ts`

- [ ] **Step 1: Test packaged resource paths**

Create `packaged-resources.test.ts` for a helper like:

```ts
resolveNativeResources({
  isPackaged,
  resourcesPath,
  repoRoot,
  platform,
  arch,
})
```

Required cases:

- Packaged darwin/arm64 returns `process.resourcesPath/native/darwin-arm64/...`.
- Dev returns repo `target/debug` and worker dev build paths.
- x64/universal packaged paths throw typed unsupported architecture errors.
- Missing daemon/CLI/node/worker files produce typed `daemon_resource_missing` errors.

Run:

```bash
pnpm --filter @slei/desktop exec vitest run src/electron/packaged-resources.test.ts --reporter=verbose
```

Expected before implementation: FAIL.

- [ ] **Step 2: Test production lifecycle does not probe dev daemon**

Add `daemon-lifecycle.test.ts` coverage:

- Dev mode can still probe/connect existing `127.0.0.1:4319` daemon.
- Packaged mode never connects to existing 4319 daemon.
- Packaged mode spawns the bundled daemon with `SLEI_DAEMON_ADDR=127.0.0.1:0`.
- Packaged mode generates a random `SLEI_DAEMON_TOKEN`.
- Packaged mode sets `SLEI_DATA_ROOT` to `<userData>/data`.
- Packaged mode sets `SLEI_CLAUDE_AGENT_RUNNER` to bundled worker.
- Packaged PATH prepends bundled `node/bin` and native dir.
- Packaged mode parses daemon stdout `slei-daemon listening on 127.0.0.1:<port>` and builds the actual endpoint.
- Electron must not pass or rely on `http://127.0.0.1:0` as a usable endpoint.

- [ ] **Step 3: Implement resource resolver**

Implement `packaged-resources.ts` with no renderer imports. It should return absolute paths and typed errors for missing resources.

- [ ] **Step 4: Refactor `ensureDaemon` for dev vs packaged modes**

Update `ensureDaemon` inputs to include:

- `isPackaged`
- `resourcesPath`
- `userDataPath`
- `platform`
- `arch`

Dev behavior remains compatible with V1. Production behavior must always start owned daemon from bundled binary.

Use `crypto.randomBytes` or `randomUUID` for session token generation in main process. Do not expose token to renderer.

- [ ] **Step 5: Implement stdout ready handshake**

Packaged daemon readiness should read the actual bound address from stdout. If daemon exits before readiness, return a typed error with recent stderr/stdout lines.

Keep cleanup limited to owned child processes.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @slei/desktop exec vitest run \
  src/electron/packaged-resources.test.ts \
  src/electron/daemon-lifecycle.test.ts \
  src/electron/main.test.ts \
  --reporter=verbose
pnpm --filter @slei/desktop typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/electron
git commit -m "feat(desktop): start packaged owned daemon"
```

## Task 7: Daemon Token Env And Dynamic Port Support

**Files:**
- Modify: `crates/slei-daemon/src/main.rs`
- Modify/Add: daemon tests near startup/env behavior

- [ ] **Step 1: Add failing Rust tests**

Add tests for pure helpers if they do not exist yet:

- Auth token reads `SLEI_DAEMON_TOKEN` when present and falls back to the dev static token.
- Bind address reads `SLEI_DAEMON_ADDR`, including `127.0.0.1:0`.
- Child CLI environment exports `SLEI_DAEMON_URL` using the actual `local_addr` after bind.
- Child CLI environment exports the same daemon token that server auth uses.
- PATH augmentation preserves bundled PATH entries passed by Electron.

Prefer extracting small helper functions over spawning full daemon in unit tests.

Run:

```bash
cargo test -p slei-daemon
```

Expected before implementation: FAIL for token/env override tests.

- [ ] **Step 2: Implement token override**

In daemon startup:

- Read `SLEI_DAEMON_TOKEN`.
- If absent, use existing `desktop-session-token` for dev compatibility.
- Use that token for `AppState::for_desktop(...)`.
- Use the same token in `configure_child_cli_environment`.

- [ ] **Step 3: Preserve actual daemon URL behavior**

Ensure the daemon binds before exporting child env. The daemon may accept `SLEI_DAEMON_ADDR=127.0.0.1:0`, but it must set `SLEI_DAEMON_URL=http://<actual local_addr>` after bind.

- [ ] **Step 4: Verify**

Run:

```bash
cargo test -p slei-daemon
pnpm --filter @slei/desktop exec vitest run src/electron/daemon-lifecycle.test.ts --reporter=verbose
```

- [ ] **Step 5: Commit**

```bash
git add crates/slei-daemon/src/main.rs
git commit -m "feat(daemon): support packaged session token and dynamic bind"
```

## Task 8: Package Dry Run, CI, And Production Smoke Validation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/verify-macos-package.sh`
- Modify: `apps/desktop/e2e/startup.spec.ts` if package command assertions need final names

- [ ] **Step 1: Update CI**

In `.github/workflows/ci.yml`, keep existing lint/typecheck/test/Rust checks and add a real macOS arm64 packaging dry-run job. Use an arm64 macOS runner label such as `macos-15-xlarge` or the repository's configured equivalent arm64 runner. GitHub documents `macos-15-xlarge` as an arm64 macOS larger runner label; if the repo cannot access larger runners, configure a self-hosted arm64 macOS runner before merging V2.

```yaml
jobs:
  package-macos-arm64:
    runs-on: macos-15-xlarge
    steps:
      # checkout/setup/pnpm/rust setup matching the main CI job
      - name: Verify Electron macOS package boundary
        run: bash scripts/verify-macos-package.sh

      - name: Build Electron macOS app directory
        run: pnpm --filter @slei/desktop package:mac:dir
```

Do not satisfy V2 by silently skipping `package:mac:dir` on x64. If an arm64 runner is unavailable, CI should fail with a clear setup message rather than reporting a false package success.

- [ ] **Step 2: Run full local verification**

Run:

```bash
bash scripts/verify-macos-package.sh
pnpm --filter @slei/desktop exec vitest run \
  src/app/SleiApp.test.ts \
  src/app/SleiAppFrame.test.tsx \
  src/features/chat/ChatPageView.test.tsx \
  src/features/tasks/TasksPageView.test.tsx \
  src/features/computers/ComputersPageView.test.tsx \
  src/features/settings/SettingsPageView.test.tsx \
  src/lib/daemon-bridge.test.ts \
  src/lib/frontend-crash-logging.test.ts \
  src/electron/renderer-entry.test.ts \
  src/electron/window-options.test.ts \
  src/electron/packaged-resources.test.ts \
  src/electron/daemon-lifecycle.test.ts \
  src/electron/main.test.ts \
  e2e/startup.spec.ts \
  --reporter=verbose
pnpm --filter @slei/desktop typecheck
cargo test -p slei-daemon
cargo test -p slei-cli
cargo metadata --format-version 1 >/tmp/slei-cargo-metadata.json
pnpm --filter @slei/desktop package:mac:dir
```

Expected:

- All listed tests pass.
- `package:mac:dir` creates a `.app` directory under `apps/desktop/release/`.
- No active Tauri boundary hits.

- [ ] **Step 3: Optional full local `.dmg`/`.zip` build**

Run on local macOS arm64:

```bash
pnpm --filter @slei/desktop package:mac
```

Expected:

- `apps/desktop/release/Slei-<version>-arm64.dmg`
- `apps/desktop/release/Slei-<version>-arm64.zip`

If signing is unavailable, unsigned local artifacts are acceptable for this V2.

- [ ] **Step 4: Manual App smoke**

Open the generated `.app` and verify:

- Renderer loads without Vite dev server.
- Owned daemon starts from bundled resources.
- `/v1/nodes` shows ClaudeCode ready when local `claude -v` is available, or shows a clear Chinese unavailable reason.
- Channel list loads.
- Sending a channel message goes through daemon.
- Closing App cleans up the owned daemon.
- Production data writes to Electron `userData/data`, not development `~/.slei`.
- If a dev daemon is already listening on `127.0.0.1:4319`, packaged App still starts its own dynamic-port daemon.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/verify-macos-package.sh apps/desktop/e2e/startup.spec.ts
git commit -m "ci(desktop): verify electron mac package dry run"
```

## Task 9: Documentation And Migration Notes

**Files:**
- Create/Modify: an existing desktop doc under `docs/desktop/` if present, otherwise create `docs/desktop/electron-v2-packaging.md`
- Modify: `docs/superpowers/specs/2026-07-08-electron-v2-packaging-design.md` only if implementation changed an accepted assumption

- [ ] **Step 1: Add Chinese acceptance notes**

Document:

- `pnpm --filter @slei/desktop desktop` remains the dev App command.
- `pnpm --filter @slei/desktop package:mac:dir` builds a local `.app` directory for CI/smoke.
- `pnpm --filter @slei/desktop package:mac` builds `.dmg` and `.zip`.
- Production data root is Electron `userData/data`.
- Development data remains `~/.slei`.
- Production package does not auto-import development data in V2.
- x64/universal, signing/notarization, auto-update, and data import are V3/future work.

- [ ] **Step 2: Final verification**

Run:

```bash
bash scripts/verify-macos-package.sh
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop typecheck
cargo test -p slei-daemon
cargo test -p slei-cli
```

Run `pnpm --filter @slei/desktop package:mac:dir` again if any package script, resource path, Electron main, daemon startup, or CI file changed after Task 8.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs(desktop): document electron v2 packaging workflow"
```

## Final Acceptance

Before reporting completion, run:

```bash
git status --short
bash scripts/verify-macos-package.sh
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop typecheck
cargo test -p slei-daemon
cargo test -p slei-cli
pnpm --filter @slei/desktop package:mac:dir
```

If local machine is macOS arm64, also run:

```bash
pnpm --filter @slei/desktop package:mac
```

Completion criteria:

- Active code/config/package/script paths no longer contain Tauri.
- Root Cargo workspace no longer includes `apps/desktop/src-tauri`.
- Electron packaged renderer loads `dist/index.html`, not Vite.
- `electron-builder` config produces arm64 `.app` dry-run and local `.dmg`/`.zip`.
- Production mode uses bundled daemon, CLI, Node runtime, and worker artifact.
- Production mode starts owned daemon on dynamic loopback port with random token.
- Daemon exports actual bound `SLEI_DAEMON_URL` to child CLI/worker environment.
- Production data root is Electron `userData/data`; dev data remains `~/.slei`.
- macOS app name, bundle id, icon, category, titlebar, transparency, vibrancy, and traffic lights are configured and tested.
- Renderer cannot read daemon token or endpoint directly.
- ClaudeCode unavailable state has clear Chinese copy.
- All tests and package dry-run pass.

After code completion, because this is a Slei code task, ask the user whether to merge this branch into `master` or another branch.
