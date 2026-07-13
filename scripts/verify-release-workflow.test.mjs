import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyzeReleaseWorkflow, verifyReleaseWorkflow } from "./verify-release-workflow.mjs";

function messagesFor(content) {
  return analyzeReleaseWorkflow(content).map((violation) => violation.message);
}

const VALID_WORKFLOW = String.raw`
name: Release

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

permissions:
  contents: write

env:
  RELEASE_TAG: \${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}

jobs:
  macos-arm64:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ env.RELEASE_TAG }}
      - uses: pnpm/action-setup@v4
        with:
          version: 10.0.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: dtolnay/rust-toolchain@stable
      - run: pnpm install --frozen-lockfile
      - name: Install verifier dependency for existing tags
        if: github.event_name == 'workflow_dispatch'
        run: command -v rg >/dev/null 2>&1 || brew install ripgrep
      - name: Verify tag matches desktop package version
        run: |
          TAG_VERSION="\${RELEASE_TAG#v}"
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
          gh release create "$RELEASE_TAG" \
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
    ["manual tag retry", VALID_WORKFLOW.replace("workflow_dispatch:", "manual_dispatch:"), "workflow_dispatch"],
    ["macOS arm64 runner", VALID_WORKFLOW.replace("macos-15", "macos-15-xlarge"), "macos-15"],
    ["manual checkout ref", VALID_WORKFLOW.replace("ref: ${{ env.RELEASE_TAG }}", "ref: master"), "RELEASE_TAG"],
    ["legacy tag verifier dependency", VALID_WORKFLOW.replace("brew install ripgrep", "echo skip"), "ripgrep"],
    ["contents write", VALID_WORKFLOW.replace("contents: write", "contents: read"), "contents: write"],
    ["version check", VALID_WORKFLOW.replace('test "$TAG_VERSION" = "$PACKAGE_VERSION"', "echo skip"), "version"],
    ["package command", VALID_WORKFLOW.replace("pnpm --filter @slei/desktop package:mac", "pnpm test"), "package:mac"],
    [
      "checksum generation",
      VALID_WORKFLOW.replace("shasum -a 256 Slei-* > SHA256SUMS.txt", "echo skip checksums"),
      "SHA256SUMS.txt",
    ],
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

test("reports missing release workflow file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slei-release-workflow-"));
  try {
    const violations = await verifyReleaseWorkflow({ cwd: directory });
    assert(violations.some((violation) => violation.message.includes("release workflow file missing")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
