import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const desktopRoot = new URL("..", import.meta.url).pathname;

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

  it("uses native macOS overlay titlebar controls integrated with the app shell", async () => {
    const tauriConfig = JSON.parse(
      await readFile(join(desktopRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as {
      app?: {
        macOSPrivateApi?: boolean;
        windows?: Array<{
          acceptFirstMouse?: boolean;
          backgroundColor?: string;
          decorations?: boolean;
          shadow?: boolean;
          title?: string;
          titleBarStyle?: string;
          trafficLightPosition?: { x?: number; y?: number };
          transparent?: boolean;
        }>;
      };
    };
    const windowConfig = tauriConfig.app?.windows?.[0];

    expect(windowConfig?.title).toBe("");
    expect(windowConfig?.decorations).toBe(true);
    expect(windowConfig?.titleBarStyle).toBe("Overlay");
    expect(windowConfig?.trafficLightPosition).toEqual({ x: 10, y: 18 });
    expect(windowConfig).not.toHaveProperty("transparent");
    expect(windowConfig).not.toHaveProperty("backgroundColor");
    expect(windowConfig).not.toHaveProperty("shadow");
    expect(windowConfig?.acceptFirstMouse).toBe(true);
    expect(tauriConfig.app).not.toHaveProperty("macOSPrivateApi");
  });

  it("allows only the window permission needed by overlay drag regions", async () => {
    const capability = JSON.parse(
      await readFile(join(desktopRoot, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { permissions?: string[] };

    expect(capability.permissions).toEqual(["core:window:allow-start-dragging"]);
  });
});
