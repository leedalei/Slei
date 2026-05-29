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
    expect(tauriConfig.build?.devUrl).toBe("http://localhost:1420");
    expect(indexHtml).toContain("/src/web.ts");
  });
});
