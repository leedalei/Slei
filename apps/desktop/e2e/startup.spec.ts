import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  await writeFile(join(fixtureRoot, "apps/desktop/package.json"), "{}\n");
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

    expect(mainSource).toContain("new BrowserWindow({");
    expect(mainSource).toContain("width: 1280");
    expect(mainSource).toContain("height: 800");
    expect(mainSource).toContain('title: ""');
    expect(mainSource).toContain("contextIsolation: true");
    expect(mainSource).toContain("nodeIntegration: false");
    expect(mainSource).toContain("sandbox: true");
    expect(mainSource).toContain('preload: join(electronDirname, "preload.cjs")');
    expect(mainSource).toContain("window.loadURL(VITE_DEV_URL)");
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
