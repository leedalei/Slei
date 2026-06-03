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

  it("uses a frameless opaque Tauri window without native operation controls", async () => {
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
          transparent?: boolean;
        }>;
      };
    };
    const windowConfig = tauriConfig.app?.windows?.[0];

    expect(windowConfig?.decorations).toBe(false);
    expect(windowConfig).not.toHaveProperty("transparent");
    expect(windowConfig).not.toHaveProperty("backgroundColor");
    expect(windowConfig).not.toHaveProperty("shadow");
    expect(windowConfig?.acceptFirstMouse).toBe(true);
    expect(tauriConfig.app).not.toHaveProperty("macOSPrivateApi");
  });

  it("allows only the window permissions needed by custom chrome controls", async () => {
    const capability = JSON.parse(
      await readFile(join(desktopRoot, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { permissions?: string[] };

    expect(capability.permissions).toContain("core:window:allow-start-dragging");
    expect(capability.permissions).toContain("core:window:allow-internal-toggle-maximize");
    expect(capability.permissions).toContain("core:window:allow-close");
    expect(capability.permissions).toContain("core:window:allow-minimize");
    expect(capability.permissions).toContain("core:window:allow-toggle-maximize");
  });
});
