# Slei Desktop Release Automation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, stable desktop release path where `pnpm release:desktop 0.1.1` updates the desktop version, commits, tags, pushes, and GitHub Actions publishes macOS arm64 `.dmg`/`.zip` assets with checksums and generated release notes.

**Architecture:** Keep release automation outside product runtime code. A root release script owns local version/tag/push orchestration; a dedicated GitHub Actions workflow owns CI packaging and Release asset upload; a focused guardrail script verifies the release workflow structure without calling GitHub. Existing Electron V2 package scripts remain the source of truth for building artifacts.

**Tech Stack:** Node.js ESM scripts, `node:test`, Git CLI, GitHub Actions, GitHub CLI (`gh`), pnpm 10, Node 22, Rust stable, Electron Builder.

---

## Scope Check

The approved spec is a single release-automation feature:

- Local one-command version/tag/push helper.
- Tag-triggered GitHub Release workflow for macOS arm64.
- Release workflow guardrail and tests.

Do not add signing, notarization, auto-update, Windows/Linux packaging, changelog parsing, or runtime UI changes.

## Relevant References

- Spec: `docs/superpowers/specs/2026-07-09-desktop-release-automation-design.md`
- Current package boundary guardrail: `scripts/verify-macos-package.sh`
- Existing guardrail test style: `scripts/verify-architecture-guardrails.test.mjs`
- Root scripts: `package.json`
- Current CI setup: `.github/workflows/ci.yml`
- Desktop package scripts: `apps/desktop/package.json`
- Desktop builder config: `apps/desktop/electron-builder.yml`

## File Structure

- Create: `.github/workflows/release.yml`
  - Tag-triggered macOS arm64 GitHub Release workflow.
- Create: `scripts/verify-release-workflow.mjs`
  - Pure-ish workflow text guardrail with exported helpers for tests and a CLI entry point.
- Create: `scripts/verify-release-workflow.test.mjs`
  - `node:test` coverage for valid workflow and missing critical constraints.
- Create: `scripts/release-desktop.mjs`
  - Local release command with exported helper functions plus side-effectful CLI path.
- Create: `scripts/release-desktop.test.mjs`
  - Unit tests for semver/tag/package-json helper behavior; no real tag, push, or GitHub calls.
- Modify: `package.json`
  - Add `release:desktop`.
  - Include new release tests in `test:guardrails`.
- Modify: `docs/desktop/electron-v2-packaging.md`
  - Add short Chinese notes for the new release command and tag-triggered Release assets.

## Task 1: Release Workflow Guardrail Tests

**Files:**
- Create: `scripts/verify-release-workflow.test.mjs`
- Create: `scripts/verify-release-workflow.mjs`

- [ ] **Step 1: Create failing guardrail tests**

Create `scripts/verify-release-workflow.test.mjs` with `node:test`.

Use a valid workflow fixture string and mutate it for missing constraints. Keep tests text-based, matching the repository's existing guardrail style.

Required test shape:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReleaseWorkflow } from "./verify-release-workflow.mjs";

function messagesFor(content) {
  return analyzeReleaseWorkflow(content).map((violation) => violation.message);
}

const VALID_WORKFLOW = String.raw`
name: Release

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: write

jobs:
  macos-arm64:
    runs-on: macos-15-xlarge
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.0.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: dtolnay/rust-toolchain@stable
      - run: pnpm install --frozen-lockfile
      - name: Verify tag matches desktop package version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PACKAGE_VERSION="$(node -p 'require("./apps/desktop/package.json").version')"
          test "$TAG_VERSION" = "$PACKAGE_VERSION"
      - name: Verify Electron macOS package boundary
        env:
          SLEI_VERIFY_MACOS_ARM64: "1"
        run: bash scripts/verify-macos-package.sh
      - name: Build macOS arm64 packages
        run: pnpm --filter @slei/desktop package:mac
      - name: Generate checksums
        run: |
          cd apps/desktop/release
          shasum -a 256 Slei-* > SHA256SUMS.txt
      - name: Create GitHub Release
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --verify-tag \
            --fail-on-no-commits \
            --generate-notes \
            apps/desktop/release/Slei-*.dmg \
            apps/desktop/release/Slei-*.zip \
            apps/desktop/release/SHA256SUMS.txt
`.replaceAll("\\${{", "${{");

test("accepts the expected release workflow", () => {
  assert.deepEqual(messagesFor(VALID_WORKFLOW), []);
});

test("flags missing critical release workflow constraints", () => {
  const cases = [
    ["tag trigger", VALID_WORKFLOW.replace('      - "v*.*.*"', '      - "main"'), "v*.*.*"],
    ["macOS arm64 runner", VALID_WORKFLOW.replace("macos-15-xlarge", "macos-latest"), "macos-15-xlarge"],
    ["contents write", VALID_WORKFLOW.replace("contents: write", "contents: read"), "contents: write"],
    ["version check", VALID_WORKFLOW.replace('test "$TAG_VERSION" = "$PACKAGE_VERSION"', "echo skip"), "version"],
    ["package command", VALID_WORKFLOW.replace("pnpm --filter @slei/desktop package:mac", "pnpm test"), "package:mac"],
    ["checksum generation", VALID_WORKFLOW.replace("shasum -a 256 Slei-* > SHA256SUMS.txt", "echo skip checksums"), "SHA256SUMS.txt"],
    ["GitHub CLI token", VALID_WORKFLOW.replace("GH_TOKEN: ${{ github.token }}", "GH_TOKEN: missing"), "GH_TOKEN"],
    ["generated notes", VALID_WORKFLOW.replace("--generate-notes", "--notes manual"), "--generate-notes"],
    ["dmg upload", VALID_WORKFLOW.replace("apps/desktop/release/Slei-*.dmg", ""), ".dmg"],
    ["zip upload", VALID_WORKFLOW.replace("apps/desktop/release/Slei-*.zip", ""), ".zip"],
  ];

  for (const [name, content, expected] of cases) {
    assert(
      messagesFor(content).some((message) => message.includes(expected)),
      `expected ${name} case to mention ${expected}`,
    );
  }
});
```

- [ ] **Step 2: Add a minimal stub so tests can run and fail meaningfully**

Create `scripts/verify-release-workflow.mjs` with exports but no full implementation yet:

```js
export function analyzeReleaseWorkflow() {
  return [{ message: "release workflow guardrail not implemented" }];
}
```

- [ ] **Step 3: Run the new tests and verify failure**

Run:

```bash
node --test scripts/verify-release-workflow.test.mjs
```

Expected: FAIL because the valid workflow still reports `release workflow guardrail not implemented`.

## Task 2: Implement Release Workflow Guardrail

**Files:**
- Modify: `scripts/verify-release-workflow.mjs`
- Modify: `scripts/verify-release-workflow.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement `analyzeReleaseWorkflow`**

Replace the stub with text checks and a CLI entry point.

Implementation requirements:

```js
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKFLOW_PATH = ".github/workflows/release.yml";

function hasAll(content, fragments) {
  return fragments.every((fragment) => content.includes(fragment));
}

function pushViolation(violations, message) {
  violations.push({ message });
}

export function analyzeReleaseWorkflow(content) {
  const violations = [];

  if (!hasAll(content, ["on:", "push:", "tags:", "v*.*.*"])) {
    pushViolation(violations, "release workflow must trigger on v*.*.* tags");
  }

  if (!content.includes("macos-15-xlarge")) {
    pushViolation(violations, "release workflow must use macos-15-xlarge");
  }

  if (!hasAll(content, ["permissions:", "contents: write"])) {
    pushViolation(violations, "release workflow must grant contents: write");
  }

  if (!hasAll(content, ["GITHUB_REF_NAME#v", "apps/desktop/package.json", "test \"$TAG_VERSION\" = \"$PACKAGE_VERSION\""])) {
    pushViolation(violations, "release workflow must verify tag version matches apps/desktop/package.json version");
  }

  if (!content.includes("bash scripts/verify-macos-package.sh")) {
    pushViolation(violations, "release workflow must run bash scripts/verify-macos-package.sh");
  }

  if (!content.includes("pnpm --filter @slei/desktop package:mac")) {
    pushViolation(violations, "release workflow must run pnpm --filter @slei/desktop package:mac");
  }

  if (!content.includes("shasum -a 256 Slei-* > SHA256SUMS.txt")) {
    pushViolation(violations, "release workflow must generate SHA256SUMS.txt");
  }

  if (!content.includes("gh release create")) {
    pushViolation(violations, "release workflow must create a GitHub Release with gh release create");
  }

  if (!hasAll(content, ["GH_TOKEN:", "github.token"])) {
    pushViolation(violations, "release workflow must set GH_TOKEN: ${{ github.token }} for gh release create");
  }

  for (const flag of ["--verify-tag", "--fail-on-no-commits", "--generate-notes"]) {
    if (!content.includes(flag)) {
      pushViolation(violations, `release workflow must pass ${flag}`);
    }
  }

  for (const asset of ["apps/desktop/release/Slei-*.dmg", "apps/desktop/release/Slei-*.zip", "apps/desktop/release/SHA256SUMS.txt"]) {
    if (!content.includes(asset)) {
      pushViolation(violations, `release workflow must upload ${asset}`);
    }
  }

  return violations;
}

export async function verifyReleaseWorkflow({
  workflowPath = DEFAULT_WORKFLOW_PATH,
  cwd = process.cwd(),
} = {}) {
  const absolutePath = path.resolve(cwd, workflowPath);
  let content;
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    return [{ message: `release workflow file missing: ${workflowPath}` }];
  }

  return analyzeReleaseWorkflow(content);
}

async function main() {
  const violations = await verifyReleaseWorkflow();
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(violation.message);
    }
    process.exit(1);
  }
  console.log("release workflow verified");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Add a missing-file CLI test**

Extend `scripts/verify-release-workflow.test.mjs` with a temp-directory test for `verifyReleaseWorkflow`:

```js
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyReleaseWorkflow } from "./verify-release-workflow.mjs";

test("reports missing release workflow file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slei-release-workflow-"));
  try {
    const violations = await verifyReleaseWorkflow({ cwd: directory });
    assert(violations.some((violation) => violation.message.includes("release workflow file missing")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run guardrail tests**

Run:

```bash
node --test scripts/verify-release-workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Wire new test into root guardrails**

Modify `package.json`:

```json
"test:guardrails": "node --test scripts/verify-architecture-guardrails.test.mjs scripts/verify-release-workflow.test.mjs"
```

- [ ] **Step 5: Run root guardrail tests**

Run:

```bash
pnpm test:guardrails
```

Expected: PASS.

- [ ] **Step 6: Commit guardrail**

```bash
git add package.json scripts/verify-release-workflow.mjs scripts/verify-release-workflow.test.mjs
git commit -m "test(desktop): guard release workflow contract"
```

## Task 3: GitHub Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `package.json`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: write

jobs:
  macos-arm64:
    runs-on: macos-15-xlarge
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.0.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - uses: dtolnay/rust-toolchain@stable

      - run: pnpm install --frozen-lockfile

      - name: Verify tag matches desktop package version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PACKAGE_VERSION="$(node -p 'require("./apps/desktop/package.json").version')"
          test "$TAG_VERSION" = "$PACKAGE_VERSION"

      - name: Verify Electron macOS package boundary
        env:
          SLEI_VERIFY_MACOS_ARM64: "1"
        run: bash scripts/verify-macos-package.sh

      - name: Build macOS arm64 packages
        run: pnpm --filter @slei/desktop package:mac

      - name: Generate checksums
        run: |
          cd apps/desktop/release
          shasum -a 256 Slei-* > SHA256SUMS.txt

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --verify-tag \
            --fail-on-no-commits \
            --generate-notes \
            apps/desktop/release/Slei-*.dmg \
            apps/desktop/release/Slei-*.zip \
            apps/desktop/release/SHA256SUMS.txt
```

- [ ] **Step 2: Run the workflow guardrail**

Run:

```bash
node scripts/verify-release-workflow.mjs
```

Expected: PASS with `release workflow verified`.

- [ ] **Step 3: Wire real workflow verification into root guardrails**

Now that `.github/workflows/release.yml` exists, update `package.json` so `test:guardrails` checks the real workflow file before running the unit tests:

```json
"test:guardrails": "node scripts/verify-release-workflow.mjs && node --test scripts/verify-architecture-guardrails.test.mjs scripts/verify-release-workflow.test.mjs"
```

Do not wire the CLI before this task; Task 2 intentionally existed before the workflow file.

- [ ] **Step 4: Run root guardrails**

Run:

```bash
pnpm test:guardrails
```

Expected: PASS.

- [ ] **Step 5: Commit workflow**

```bash
git add .github/workflows/release.yml package.json
git commit -m "ci(desktop): publish release assets on version tags"
```

## Task 4: Release Script Unit Tests

**Files:**
- Create: `scripts/release-desktop.test.mjs`
- Create: `scripts/release-desktop.mjs`

- [ ] **Step 1: Write failing helper tests**

Create `scripts/release-desktop.test.mjs`.

Required tests:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCleanWorkingTree,
  assertReleaseBranch,
  assertTagAvailable,
  desktopVersionJson,
  parseReleaseVersion,
  releaseTagForVersion,
  updateDesktopPackageJson,
} from "./release-desktop.mjs";

test("accepts simple semver release versions", () => {
  assert.equal(parseReleaseVersion("0.1.1"), "0.1.1");
  assert.equal(parseReleaseVersion("12.34.56"), "12.34.56");
});

test("rejects unsupported release versions", () => {
  for (const version of ["", "v0.1.1", "0.1", "0.1.1-beta.1", "latest", "1.2.3.4"]) {
    assert.throws(() => parseReleaseVersion(version), /version must use x\.y\.z/);
  }
});

test("builds v-prefixed release tag", () => {
  assert.equal(releaseTagForVersion("0.1.1"), "v0.1.1");
});

test("updates desktop package json version and preserves newline", () => {
  const input = JSON.stringify({ name: "@slei/desktop", version: "0.1.0", private: true }, null, 2) + "\n";
  const output = updateDesktopPackageJson(input, "0.1.1");
  assert.equal(JSON.parse(output).version, "0.1.1");
  assert(output.endsWith("\n"));
});

test("returns desktop version from package json", () => {
  assert.equal(desktopVersionJson('{"version":"0.1.1"}'), "0.1.1");
});

test("rejects package json without a string version", () => {
  assert.throws(() => desktopVersionJson("{}"), /missing version/);
  assert.throws(() => desktopVersionJson('{"version":1}'), /missing version/);
});

test("requires releases from master", () => {
  assert.doesNotThrow(() => assertReleaseBranch("master"));
  assert.throws(() => assertReleaseBranch("feature/release"), /must be created from master/);
  assert.throws(() => assertReleaseBranch(""), /detached/);
});

test("requires a clean working tree", () => {
  assert.doesNotThrow(() => assertCleanWorkingTree(""));
  assert.throws(() => assertCleanWorkingTree(" M package.json"), /working tree must be clean/);
});

test("rejects duplicate local or origin tags", () => {
  assert.doesNotThrow(() => assertTagAvailable("v0.1.1", { localExists: false, remoteOutput: "" }));
  assert.throws(() => assertTagAvailable("v0.1.1", { localExists: true, remoteOutput: "" }), /local tag already exists/);
  assert.throws(() => assertTagAvailable("v0.1.1", { localExists: false, remoteOutput: "abc refs/tags/v0.1.1" }), /origin tag already exists/);
});
```

- [ ] **Step 2: Add a minimal stub so tests fail meaningfully**

Create `scripts/release-desktop.mjs`:

```js
export function parseReleaseVersion() {
  throw new Error("release script helpers not implemented");
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
node --test scripts/release-desktop.test.mjs
```

Expected: FAIL because helper exports are missing or unimplemented.

## Task 5: Implement Local Release Script

**Files:**
- Modify: `scripts/release-desktop.mjs`
- Modify: `scripts/release-desktop.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement pure helpers**

Implement exported helpers:

```js
export function parseReleaseVersion(rawVersion) {
  if (typeof rawVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(rawVersion)) {
    throw new Error("version must use x.y.z");
  }
  return rawVersion;
}

export function releaseTagForVersion(version) {
  return `v${parseReleaseVersion(version)}`;
}

export function updateDesktopPackageJson(content, version) {
  const parsed = JSON.parse(content);
  parsed.version = parseReleaseVersion(version);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function desktopVersionJson(content) {
  const parsed = JSON.parse(content);
  if (typeof parsed.version !== "string") {
    throw new Error("desktop package.json missing version");
  }
  return parsed.version;
}

export function assertReleaseBranch(branch) {
  if (branch !== "master") {
    throw new Error(`desktop releases must be created from master; current branch is ${branch || "(detached)"}`);
  }
}

export function assertCleanWorkingTree(status) {
  if (status.length > 0) {
    throw new Error("working tree must be clean before releasing");
  }
}

export function assertTagAvailable(tag, { localExists, remoteOutput }) {
  if (localExists) {
    throw new Error(`local tag already exists: ${tag}`);
  }
  if (remoteOutput.length > 0) {
    throw new Error(`origin tag already exists: ${tag}`);
  }
}
```

- [ ] **Step 2: Implement command runner utilities**

In the same file, add private helpers:

```js
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_PACKAGE_JSON = path.join(REPO_ROOT, "apps/desktop/package.json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }

  return (result.stdout ?? "").trim();
}
```

- [ ] **Step 3: Implement side-effectful release flow**

Add `async function releaseDesktop(rawVersion)`:

```js
async function releaseDesktop(rawVersion) {
  const version = parseReleaseVersion(rawVersion);
  const tag = releaseTagForVersion(version);

  run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true });

  const branch = run("git", ["branch", "--show-current"], { capture: true });
  assertReleaseBranch(branch);

  const status = run("git", ["status", "--porcelain"], { capture: true });
  assertCleanWorkingTree(status);

  const localTagExists = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  }).status === 0;

  const remoteTag = run("git", ["ls-remote", "--tags", "origin", tag], { capture: true });
  assertTagAvailable(tag, { localExists: localTagExists, remoteOutput: remoteTag });

  const packageJson = await fs.readFile(DESKTOP_PACKAGE_JSON, "utf8");
  await fs.writeFile(DESKTOP_PACKAGE_JSON, updateDesktopPackageJson(packageJson, version));

  run("bash", ["scripts/verify-macos-package.sh"]);
  run("node", ["scripts/verify-release-workflow.mjs"]);
  run("node", ["--test", "scripts/verify-release-workflow.test.mjs"]);
  run("node", ["--test", "scripts/release-desktop.test.mjs"]);

  run("git", ["add", "apps/desktop/package.json"]);
  run("git", ["commit", "-m", `chore(release): ${tag}`]);
  run("git", ["tag", tag]);
  run("git", ["push"]);
  run("git", ["push", "origin", tag]);

  console.log(`Release ${tag} pushed. GitHub Actions will publish desktop assets.`);
}
```

Do not add automatic rollback. The approved spec says failures after commit/tag should leave state for manual inspection.

- [ ] **Step 4: Implement CLI entry point**

Add:

```js
async function main() {
  const version = process.argv[2];
  if (!version) {
    throw new Error("usage: pnpm release:desktop <x.y.z>");
  }
  await releaseDesktop(version);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run release script unit tests**

Run:

```bash
node --test scripts/release-desktop.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Wire root script and guardrail tests**

Modify root `package.json`:

```json
"release:desktop": "node scripts/release-desktop.mjs",
"test:guardrails": "node scripts/verify-release-workflow.mjs && node --test scripts/verify-architecture-guardrails.test.mjs scripts/verify-release-workflow.test.mjs scripts/release-desktop.test.mjs"
```

- [ ] **Step 7: Run all guardrails**

Run:

```bash
pnpm test:guardrails
```

Expected: PASS.

- [ ] **Step 8: Commit release script**

```bash
git add package.json scripts/release-desktop.mjs scripts/release-desktop.test.mjs
git commit -m "feat(desktop): add one-command release script"
```

## Task 6: Documentation And Final Verification

**Files:**
- Modify: `docs/desktop/electron-v2-packaging.md`

- [ ] **Step 1: Document release flow in Chinese**

Add a short section after the macOS packaging commands:

```markdown
## GitHub Release 自动发布

正式发布从 `master` 执行：

```bash
pnpm release:desktop 0.1.1
```

该命令会更新 `apps/desktop/package.json` 的版本号，创建 `chore(release): v0.1.1` 提交，创建并推送 `v0.1.1` tag。tag 推送后 GitHub Actions 会构建 macOS arm64 `.dmg` / `.zip`，生成 `SHA256SUMS.txt`，并使用 GitHub 自动生成的 release notes 创建 Release。

V2 自动发布仍不包含签名、公证、自动更新或多平台产物。
```

- [ ] **Step 2: Run targeted verification**

Run:

```bash
node scripts/verify-release-workflow.mjs
node --test scripts/verify-release-workflow.test.mjs
node --test scripts/release-desktop.test.mjs
bash scripts/verify-macos-package.sh
pnpm test:guardrails
pnpm --filter @slei/desktop typecheck
```

Expected: all PASS.

- [ ] **Step 3: Inspect release workflow without publishing**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files modified before commit.

- [ ] **Step 4: Commit documentation and any final guardrail wiring**

```bash
git add docs/desktop/electron-v2-packaging.md package.json
git commit -m "docs(desktop): document release automation workflow"
```

Only include `package.json` if Task 5 did not already commit the final `test:guardrails`/`release:desktop` scripts.

## Final Acceptance

Before reporting completion, run:

```bash
git status --short
node scripts/verify-release-workflow.mjs
node --test scripts/verify-release-workflow.test.mjs
node --test scripts/release-desktop.test.mjs
bash scripts/verify-macos-package.sh
pnpm test:guardrails
pnpm --filter @slei/desktop typecheck
```

Do not run `pnpm release:desktop <version>` as part of normal verification because it creates commits, tags, and pushes. Mention it as the manual release command once the user is ready to publish.

Completion criteria:

- `pnpm release:desktop <x.y.z>` is available from the repo root.
- Release script rejects non-`master`, dirty worktrees, invalid versions, and duplicate local/origin tags.
- `.github/workflows/release.yml` triggers only on `v*.*.*` tags.
- Release workflow builds macOS arm64 via `pnpm --filter @slei/desktop package:mac`.
- Release workflow creates `SHA256SUMS.txt`.
- Release workflow calls `gh release create` with `GH_TOKEN`, `--verify-tag`, `--fail-on-no-commits`, and `--generate-notes`.
- Release workflow uploads `.dmg`, `.zip`, and `SHA256SUMS.txt`.
- Guardrail tests cover missing `GH_TOKEN` and other critical workflow constraints.
