import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const desktopRoot = new URL("..", import.meta.url).pathname;
const repoRoot = join(desktopRoot, "../..");

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function expectInOrder(source: string, orderedSnippets: string[]) {
  let previousIndex = -1;

  for (const snippet of orderedSnippets) {
    const index = source.indexOf(snippet);
    expect(index, `${snippet} should exist`).toBeGreaterThanOrEqual(0);
    expect(index, `${snippet} should appear after the previous startup step`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

function expectYamlValue(source: string, key: string, expectedValue: string) {
  expect(source).toContain(`${key}: ${expectedValue}`);
}

function expectYamlListContains(source: string, parentKey: string, expectedItems: string[]) {
  const parentIndex = source.indexOf(`${parentKey}:`);
  expect(parentIndex, `${parentKey} should exist`).toBeGreaterThanOrEqual(0);

  const nextTopLevelKey = source.slice(parentIndex + parentKey.length + 1).search(/\n\S[^:\n]*:/);
  const section =
    nextTopLevelKey === -1
      ? source.slice(parentIndex)
      : source.slice(parentIndex, parentIndex + parentKey.length + 1 + nextTopLevelKey);

  for (const item of expectedItems) {
    expect(section).toContain(`- ${item}`);
  }
}

async function icnsPngHashes(path: string) {
  const icon = await readFile(path);
  expect(icon.subarray(0, 4).toString("latin1")).toBe("icns");

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const hashes: string[] = [];
  let offset = 8;

  while (offset + 8 <= icon.length) {
    const length = icon.readUInt32BE(offset + 4);
    const data = icon.subarray(offset + 8, offset + length);

    if (data.subarray(0, pngSignature.length).equals(pngSignature)) {
      hashes.push(createHash("sha256").update(data).digest("hex"));
    }

    offset += length;
  }

  return hashes;
}

function runMacosPackageVerifier(cwd: string) {
  return spawnSync("bash", ["scripts/verify-macos-package.sh"], {
    cwd,
    encoding: "utf8",
  });
}

function runMacosPackageScriptWithArch(arch: string) {
  return spawnSync("bash", ["scripts/package-macos.sh", "dir"], {
    cwd: desktopRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      SLEI_PACKAGE_ARCH: arch,
    },
  });
}

async function createBoundaryFixture(options: { omitWorkflowDirectory?: boolean } = {}) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "slei-macos-boundary-"));
  const directories = [
    "apps/desktop/src",
    "apps/desktop/scripts",
    "scripts",
    "workers/claude-agent",
    "crates/slei-daemon/src/services",
  ];
  if (!options.omitWorkflowDirectory) {
    directories.push(".github/workflows");
  }

  for (const directory of directories) {
    await mkdir(join(fixtureRoot, directory), { recursive: true });
  }

  await copyFile(join(repoRoot, "scripts/verify-macos-package.sh"), join(fixtureRoot, "scripts/verify-macos-package.sh"));
  await writeFile(join(fixtureRoot, "Cargo.toml"), "[workspace]\nmembers = []\n");
  await mkdir(join(fixtureRoot, "apps/desktop/build"), { recursive: true });
  await writeFile(
    join(fixtureRoot, "apps/desktop/package.json"),
    JSON.stringify(
      {
        version: "0.1.0",
        scripts: {
          "package:mac": "scripts/package-macos.sh dmg zip",
          "package:mac:dir": "scripts/package-macos.sh dir",
          "prepare:package-resources": "node scripts/prepare-package-resources.mjs",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(fixtureRoot, "apps/desktop/electron-builder.yml"),
    [
      "appId: ai.slei.desktop",
      "productName: Slei",
      "directories:",
      "  output: release",
      "files:",
      "  - dist/**",
      "  - dist-electron/**",
      "  - package.json",
      "extraResources:",
      "  - from: dist-native/darwin-arm64",
      "    to: native/darwin-arm64",
      "asar: true",
      "mac:",
      "  category: public.app-category.productivity",
      "  icon: build/icon.icns",
      "  hardenedRuntime: true",
      "  entitlements: build/entitlements.mac.plist",
      "  entitlementsInherit: build/entitlements.mac.plist",
      "  target:",
      "    - dmg",
      "    - zip",
      "artifactName: Slei-${version}-${arch}.${ext}",
      "",
    ].join("\n"),
  );
  await writeFile(join(fixtureRoot, "apps/desktop/build/icon.icns"), "icns");
  await writeFile(join(fixtureRoot, "apps/desktop/build/entitlements.mac.plist"), "<plist />\n");
  await writeFile(join(fixtureRoot, "apps/desktop/scripts/package-macos.sh"), "#!/usr/bin/env bash\n");
  await chmod(join(fixtureRoot, "apps/desktop/scripts/package-macos.sh"), 0o755);
  await writeFile(join(fixtureRoot, "apps/desktop/src/index.ts"), "export const desktopShell = 'electron';\n");
  await writeFile(join(fixtureRoot, "apps/desktop/scripts/desktop-dev.sh"), "electron dist-electron/electron/main.js\n");
  await writeFile(join(fixtureRoot, "workers/claude-agent/package.json"), "{}\n");
  await writeFile(join(fixtureRoot, "crates/slei-daemon/src/services/worker_launch.rs"), "pub fn worker_launch_guard() {}\n");
  await writeFile(join(fixtureRoot, "scripts/verify-architecture-guardrails.mjs"), "const legacyPath = 'apps/desktop/src-tauri/src';\n");
  if (!options.omitWorkflowDirectory) {
    await writeFile(join(fixtureRoot, ".github/workflows/desktop.yml"), "name: desktop\n");
  }

  return fixtureRoot;
}

describe("desktop startup contract", () => {
  it("exposes a Vite dev entry that matches the Electron dev URL", async () => {
    const packageJson = JSON.parse(
      await readFile(join(desktopRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const electronConstants = await readFile(join(desktopRoot, "src/electron/constants.ts"), "utf8");
    const indexHtml = await readFile(join(desktopRoot, "index.html"), "utf8");

    expect(packageJson.scripts?.dev).toContain("vite");
    expect(packageJson.scripts?.dev).toContain("1420");
    expect(electronConstants).toContain('export const VITE_DEV_URL = "http://127.0.0.1:1420"');
    expect(indexHtml).toContain("/src/web.ts");
  });

  it("starts Vite and then launches Electron in dev", async () => {
    const packageJson = JSON.parse(
      await readFile(join(desktopRoot, "package.json"), "utf8"),
    ) as {
      main?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const desktopDevScript = await readFile(join(desktopRoot, "scripts/desktop-dev.sh"), "utf8");
    const electronEntry = "dist-electron/electron/main.js";
    const viteStart = 'node "$DESKTOP_ROOT/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 1420 --strictPort';
    const viteReadyPortCheck = "if nc -z 127.0.0.1 1420 2>/dev/null; then";
    const stalePortGuard = 'sleep 0.2\n    if ! kill -0 "$VITE_PID" 2>/dev/null; then';

    expect(packageJson.devDependencies?.electron).toBe("43.0.0");
    expect(packageJson.main).toBe(electronEntry);
    expect(packageJson.scripts?.desktop).toBe("scripts/desktop-dev.sh");
    expect(packageJson.scripts?.["build:electron"]).toBe(
      "tsc -p tsconfig.electron.json && node scripts/assert-sandbox-preload.mjs",
    );
    expect(desktopDevScript).toContain("hydrate_user_shell_path");
    expect(desktopDevScript).toContain("__SLEI_PATH__");
    expectInOrder(desktopDevScript, [
      "hydrate_user_shell_path",
      "pnpm --filter @slei/claude-agent build",
      "cargo build -p slei-cli",
      "cargo build -p slei-daemon",
      viteStart,
      "pnpm build:electron",
      `electron ${electronEntry}`,
    ]);
    expectInOrder(desktopDevScript, [viteStart, "while true; do", viteReadyPortCheck, stalePortGuard, "break"]);
    expect(desktopDevScript).toContain("terminate_process_tree");
    expect(desktopDevScript).toContain("DAEMON_WAS_FREE=");
    expect(desktopDevScript).toContain("DAEMON_PID_FILE=");
    expect(desktopDevScript).toContain("record_owned_daemon_pid");
    expect(desktopDevScript).toContain("daemon_pid_is_owned_listener");
    expect(desktopDevScript).toContain("cleanup_owned_daemon");
    const electronLaunchIndex = desktopDevScript.indexOf(`electron ${electronEntry} &`);
    const recordDaemonCallIndex = desktopDevScript.indexOf("\nrecord_owned_daemon_pid\n", electronLaunchIndex);
    expect(recordDaemonCallIndex).toBeGreaterThan(electronLaunchIndex);
    expectInOrder(desktopDevScript, [
      'if ! nc -z 127.0.0.1 4319 2>/dev/null; then',
      'DAEMON_WAS_FREE="1"',
      `electron ${electronEntry} &`,
      'wait "$ELECTRON_PID"',
    ]);
    expectInOrder(desktopDevScript, [
      'if [ "$DAEMON_WAS_FREE" = "1" ]; then',
      'daemon_pid=$(sed -n \'1p\' "$DAEMON_PID_FILE" 2>/dev/null || true)',
      'if daemon_pid_is_owned_listener "$daemon_pid"; then',
      'terminate_process_tree "$daemon_pid"',
      'pkill -f "$REPO_ROOT/workers/claude-agent"',
    ]);
    expect(desktopDevScript).toContain("lsof -nP -iTCP:4319 -sTCP:LISTEN -Fp");
    expect(desktopDevScript).toContain('lsof -a -p "$pid" -d cwd -Fn');
    expect(desktopDevScript).not.toContain("lsof -ti tcp:4319");
    expect(desktopDevScript).not.toContain("lsof -ti -iTCP:4319");
    expect(desktopDevScript).not.toContain("tauri dev");
    expect(desktopDevScript).not.toContain("pnpm dev &");
    expect(desktopDevScript).not.toContain("cargo run -p slei-daemon");
    expect(desktopDevScript).not.toContain("SLEI_DAEMON_PID");
  });

  it("passes the real repo macOS package guardrail after active Tauri code is removed", () => {
    const result = runMacosPackageVerifier(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("macOS package boundary verified");
    expect(result.stderr).toBe("");
  });

  it("declares the Electron Builder macOS package contract", async () => {
    const packageJson = JSON.parse(
      await readFile(join(desktopRoot, "package.json"), "utf8"),
    ) as {
      version?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const builderConfig = await readFile(join(desktopRoot, "electron-builder.yml"), "utf8");
    const packageScript = await readFile(join(desktopRoot, "scripts/package-macos.sh"), "utf8");
    const packageVerifier = await readFile(join(repoRoot, "scripts/verify-macos-package.sh"), "utf8");

    expectYamlValue(builderConfig, "appId", "ai.slei.desktop");
    expectYamlValue(builderConfig, "productName", "Slei");
    expect(builderConfig).toContain("directories:\n  output: release");
    expect(builderConfig).toContain(["files:", "  - dist/**", "  - dist-electron/**", "  - package.json"].join("\n"));
    expectYamlValue(builderConfig, "asar", "true");
    expect(builderConfig).toContain("mac:\n");
    expect(builderConfig).toContain("category: public.app-category.productivity");
    expect(builderConfig).toContain("icon: build/icon.icns");
    expect(builderConfig).toContain("hardenedRuntime: true");
    expect(builderConfig).toContain("entitlements: build/entitlements.mac.plist");
    expect(builderConfig).toContain("entitlementsInherit: build/entitlements.mac.plist");
    expectYamlListContains(builderConfig, "target", ["dmg", "zip"]);
    expect(builderConfig).toContain(
      ["extraResources:", "  - from: dist-native/darwin-arm64", "    to: native/darwin-arm64"].join("\n"),
    );
    expectYamlValue(builderConfig, "artifactName", "Slei-${version}-${arch}.${ext}");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.scripts?.["package:mac"]).toBe("scripts/package-macos.sh dmg zip");
    expect(packageJson.scripts?.["package:mac:dir"]).toBe("scripts/package-macos.sh dir");
    expect(packageJson.scripts?.["prepare:package-resources"]).toBe("node scripts/prepare-package-resources.mjs");
    expect(packageJson.devDependencies?.["electron-builder"]).toBe("26.15.3");
    expect(packageScript).toContain('PACKAGE_ARCH="${SLEI_PACKAGE_ARCH:-arm64}"');
    expect(packageScript).toContain("x64|universal)");
    expect(packageScript).toContain("uname -m");
    expect(packageVerifier).toContain("SLEI_VERIFY_MACOS_ARM64");
    expect(packageVerifier).toContain("uname -m");
    expect(packageScript).toContain("cargo build --release -p slei-daemon -p slei-cli");
    expectInOrder(packageScript, [
      "pnpm build",
      "pnpm build:electron",
      "cargo build --release -p slei-daemon -p slei-cli",
      "node scripts/bundle-claude-worker.mjs",
      "node scripts/prepare-node-runtime.mjs",
      "node scripts/prepare-package-resources.mjs --skip-build",
      "node scripts/package-resource-check.mjs --root .",
      'pnpm exec electron-builder --config electron-builder.yml --mac "${targets[@]}" --arm64',
    ]);
  });

  it("declares a real CI macOS arm64 Electron package dry run", async () => {
    const ciWorkflow = await readFile(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const packageJob = ciWorkflow.slice(ciWorkflow.indexOf("package-macos-arm64:"));

    expect(packageJob).toContain("package-macos-arm64:");
    expect(packageJob).toContain("runs-on: macos-15-xlarge");
    expect(packageJob).toContain("SLEI_VERIFY_MACOS_ARM64: \"1\"");
    expectInOrder(packageJob, [
      "package-macos-arm64:",
      "uses: actions/checkout@v4",
      "uses: pnpm/action-setup@v4",
      "uses: actions/setup-node@v4",
      "uses: dtolnay/rust-toolchain@stable",
      "pnpm install --frozen-lockfile",
      "Verify Electron macOS package boundary",
      "bash scripts/verify-macos-package.sh",
      "Build Electron macOS app directory",
      "pnpm --filter @slei/desktop package:mac:dir",
    ]);
    expect(ciWorkflow).not.toContain("SLEI_PACKAGE_ARCH: x64");
    expect(ciWorkflow).not.toContain("package:mac:dir || true");
  });

  it.each([
    ["x64", "SLEI_PACKAGE_ARCH=x64 is reserved for a later packaging task; only arm64 is supported now."],
    ["universal", "SLEI_PACKAGE_ARCH=universal is reserved for a later packaging task; only arm64 is supported now."],
    ["riscv64", "unsupported SLEI_PACKAGE_ARCH=riscv64; only arm64 is supported now."],
  ])("rejects unsupported package architecture %s before running package builds", (arch, expectedMessage) => {
    const result = runMacosPackageScriptWithArch(arch);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe(expectedMessage);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("No such file or directory");
  });

  it("allows verifier-only Tauri references after the active Tauri source directory is gone", async () => {
    const fixtureRoot = await createBoundaryFixture();
    try {
      const result = runMacosPackageVerifier(fixtureRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("macOS package boundary verified");
      expect(result.stderr).toBe("");
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("fails the macOS package guardrail when an active-reference scan path is missing", async () => {
    const fixtureRoot = await createBoundaryFixture({ omitWorkflowDirectory: true });
    try {
      const result = runMacosPackageVerifier(fixtureRoot);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("active Tauri reference scan failed");
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("creates the standard Electron BrowserWindow shell", async () => {
    const mainSource = await readFile(join(desktopRoot, "src/electron/main.ts"), "utf8");
    const windowOptionsSource = await readFile(join(desktopRoot, "src/electron/window-options.ts"), "utf8");

    expect(mainSource).toContain("new BrowserWindow({");
    expect(mainSource).toContain("createWindowVisualOptions({");
    expect(windowOptionsSource).toContain("width: 1280");
    expect(windowOptionsSource).toContain("height: 800");
    expect(mainSource).toContain('title: ""');
    expect(mainSource).toContain("contextIsolation: true");
    expect(mainSource).toContain("nodeIntegration: false");
    expect(mainSource).toContain("sandbox: true");
    expect(mainSource).toContain('preload: join(electronDirname, "preload.cjs")');
    expect(mainSource).toContain("resolveRendererEntry({");
    expect(mainSource).toContain("devUrl: VITE_DEV_URL");
    expect(mainSource).toContain('if (rendererEntry.kind === "url")');
    expect(mainSource).toContain("window.loadURL(rendererEntry.value)");
    expect(mainSource).toContain("window.loadFile(rendererEntry.value)");
  });

  it("preserves the macOS app icon outside the deleted Tauri tree", async () => {
    const iconPath = join(desktopRoot, "build/icon.icns");

    await expect(sha256(iconPath)).resolves.toBe("78a7ada8ebf2a911b97f4586d244c8d54769a597811116501bf202ba6e4d0bd9");
    await expect(icnsPngHashes(iconPath)).resolves.toEqual(
      expect.arrayContaining([
        "a337720e8e7c81196a9d78420c51a50f361ba65c1a6e70106e805f391d1ec968",
        "4e40025b8db4a30745ef222be57703ae278d75c58ce69a2ab3a978f6171d48d8",
        "a88b5d871ed31f039ffb09cd9ffe8e4af1a422ea8aa343bcbe63c1eac53c9a0d",
        "c0d98caec33b78739f66e6b8788a09fd5777edb06a62464cb0f7a8f364724ba5",
        "109430bea765f82d4f015a417029579bc5864180ab6aefff39dce838b7f42e8f",
        "7b95f2f6c6d38d1b038d08400b1b2705a59041a79b9b140feb7438f081a69d75",
      ]),
    );
  });
});
