import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const desktopRoot = new URL("..", import.meta.url).pathname;

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
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

describe("desktop startup contract", () => {
  it("exposes a Vite dev entry that matches the Tauri dev URL", async () => {
    const packageJson = JSON.parse(
      await readFile(join(desktopRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const tauriConfig = JSON.parse(
      await readFile(join(desktopRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as { build?: { devUrl?: string } };
    const indexHtml = await readFile(join(desktopRoot, "index.html"), "utf8");

    expect(packageJson.scripts?.dev).toContain("vite");
    expect(packageJson.scripts?.dev).toContain("1420");
    expect(tauriConfig.build?.devUrl).toBe("http://127.0.0.1:1420");
    expect(indexHtml).toContain("/src/web.ts");
  });

  it("starts the local daemon before launching the Tauri desktop in dev", async () => {
    const packageJson = JSON.parse(
      await readFile(join(desktopRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const desktopDevScript = await readFile(join(desktopRoot, "scripts/desktop-dev.sh"), "utf8");

    expect(packageJson.scripts?.desktop).toBe("scripts/desktop-dev.sh");
    expect(desktopDevScript).toContain("cargo run -p slei-daemon");
    expect(desktopDevScript).toContain("tauri dev");
  });

  it("uses transparent macOS sidebar material with native overlay titlebar controls", async () => {
    const tauriConfig = JSON.parse(
      await readFile(join(desktopRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as {
      app?: {
        macOSPrivateApi?: boolean;
        windows?: Array<{
          acceptFirstMouse?: boolean;
          backgroundColor?: [number, number, number, number];
          decorations?: boolean;
          shadow?: boolean;
          title?: string;
          titleBarStyle?: string;
          trafficLightPosition?: { x?: number; y?: number };
          transparent?: boolean;
          windowEffects?: { effects?: string[]; radius?: number; state?: string };
        }>;
      };
    };
    const windowConfig = tauriConfig.app?.windows?.[0];

    expect(windowConfig?.title).toBe("");
    expect(windowConfig?.decorations).toBe(true);
    expect(windowConfig?.titleBarStyle).toBe("Overlay");
    expect(windowConfig?.trafficLightPosition).toEqual({ x: 8, y: 18 });
    expect(windowConfig?.transparent).toBe(true);
    expect(windowConfig?.backgroundColor).toEqual([0, 0, 0, 0]);
    expect(windowConfig?.windowEffects).toEqual({
      effects: ["sidebar"],
      state: "active",
      radius: 0,
    });
    expect(windowConfig).not.toHaveProperty("shadow");
    expect(windowConfig?.acceptFirstMouse).toBe(true);
    expect(tauriConfig.app?.macOSPrivateApi).toBe(true);
  });

  it("allows only the window permission needed by overlay drag regions", async () => {
    const capability = JSON.parse(
      await readFile(join(desktopRoot, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { permissions?: string[] };

    expect(capability.permissions).toEqual(["core:window:allow-start-dragging"]);
  });

  it("bundles the generated external app icon set", async () => {
    const tauriConfig = JSON.parse(
      await readFile(join(desktopRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as { bundle?: { icon?: string[] } };
    const iconRoot = join(desktopRoot, "src-tauri/icons");

    expect(tauriConfig.bundle?.icon).toEqual([
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico",
    ]);
    await expect(sha256(join(iconRoot, "icon.png"))).resolves.toBe("85da67ea7fc3c939cc551871cfc4dbedff0ee88f9c946456f14144ea6167cb8d");
    await expect(sha256(join(iconRoot, "icon.ico"))).resolves.toBe("8b24ae6c9c5daa8a6d5834fdae0898a6cf9c1b04dca57f727f608815e80d574f");
    await expect(sha256(join(iconRoot, "32x32.png"))).resolves.toBe("59270eceb92a21d0fb06aa216899aee8c66fd7fde7790085bd0ad0033a7e0bca");
    await expect(sha256(join(iconRoot, "128x128.png"))).resolves.toBe("2ed557cecbc314ff8790a75107feabdac9926f05a890561bdec61a926e603c31");
    await expect(sha256(join(iconRoot, "128x128@2x.png"))).resolves.toBe("e3c5b43f001dbea6f725077cb31980fdc761373e6688ed732fecf74ca49dd560");
    await expect(icnsPngHashes(join(iconRoot, "icon.icns"))).resolves.toEqual(
      expect.arrayContaining([
        "59270eceb92a21d0fb06aa216899aee8c66fd7fde7790085bd0ad0033a7e0bca",
        "2ed557cecbc314ff8790a75107feabdac9926f05a890561bdec61a926e603c31",
        "e3c5b43f001dbea6f725077cb31980fdc761373e6688ed732fecf74ca49dd560",
        "85da67ea7fc3c939cc551871cfc4dbedff0ee88f9c946456f14144ea6167cb8d",
      ]),
    );
  });
});
