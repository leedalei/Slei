import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
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

async function readRgbaPng(path: string) {
  const png = await readFile(path);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  let offset = 8;

  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("latin1");
    const data = png.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    }

    offset += length + 12;
  }

  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6);

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = inflated.subarray(inputOffset, inputOffset + stride);
    inputOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= bytesPerPixel && y > 0 ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      let value = row[x];

      if (filter === 1) {
        value = (value + left) & 0xff;
      } else if (filter === 2) {
        value = (value + up) & 0xff;
      } else if (filter === 3) {
        value = (value + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
      } else {
        expect(filter).toBe(0);
      }

      pixels[y * stride + x] = value;
    }
  }

  return {
    alphaAt(x: number, y: number) {
      return pixels[(y * width + x) * bytesPerPixel + 3];
    },
    height,
    width,
  };
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

  it("fails the macOS package guardrail while the active Tauri source directory exists", () => {
    const result = runMacosPackageVerifier(repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("active Tauri source directory must not exist");
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

  it("bundles the generated external app icon set", async () => {
    const iconRoot = join(desktopRoot, "src-tauri/icons");

    const sourceIcon = await readFile(join(iconRoot, "slei-icon.svg"), "utf8");

    expect(sourceIcon).toContain('stop-color="#0B9C67"');
    expect(sourceIcon).toContain('stop-color="#16C78A"');
    expect(sourceIcon).toContain('stroke="#FFFFFF"');
    expect(sourceIcon).toContain('stroke-opacity="0.62"');
    expect(sourceIcon).toContain('r="2.55"');
    expect(sourceIcon).toContain('fill-opacity="0.88"');
    expect(sourceIcon).not.toContain('r="3.05"');
    await expect(sha256(join(iconRoot, "slei-icon.svg"))).resolves.toBe("362ce08df11fe71bd6a1c69a64ccd53b0d231ad0359b2a528275914384310c3e");
    await expect(sha256(join(iconRoot, "icon.png"))).resolves.toBe("a1c046ef5fe4637ce0e1c013d0bd0b455a71527d307e6bdf945808b8f1afb255");
    await expect(sha256(join(iconRoot, "icon.ico"))).resolves.toBe("aef0fbe8f94f0b3990d1a001cd7d12731b1cd678b4e4807a9ed727f8b9f597d0");
    await expect(sha256(join(iconRoot, "32x32.png"))).resolves.toBe("fc43016b0fc96906b56b28d4f2fdeadf2f67834cba34d3fa08ee5ebc9354468d");
    await expect(sha256(join(iconRoot, "128x128.png"))).resolves.toBe("39eb3e534556162eaf842367145fff46ba6810ef0d5c18371850770be30cd890");
    await expect(sha256(join(iconRoot, "128x128@2x.png"))).resolves.toBe("8186d818fa96551b3923c0df2b2774c8ccfd78b23ef6e906266515f0608aab63");
    await expect(icnsPngHashes(join(iconRoot, "icon.icns"))).resolves.toEqual(
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

  it("keeps app icon PNGs rounded with transparent corners", async () => {
    const iconRoot = join(desktopRoot, "src-tauri/icons");

    for (const fileName of ["icon.png", "128x128.png", "32x32.png"]) {
      const icon = await readRgbaPng(join(iconRoot, fileName));

      expect(icon.alphaAt(0, 0)).toBe(0);
      expect(icon.alphaAt(icon.width - 1, 0)).toBe(0);
      expect(icon.alphaAt(0, icon.height - 1)).toBe(0);
      expect(icon.alphaAt(icon.width - 1, icon.height - 1)).toBe(0);
      expect(icon.alphaAt(Math.floor(icon.width / 2), Math.floor(icon.height / 2))).toBe(255);
    }
  });
});
