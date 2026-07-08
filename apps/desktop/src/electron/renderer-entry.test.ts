import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRendererEntry } from "./renderer-entry";

describe("resolveRendererEntry", () => {
  it("returns the dev server URL while the app is unpackaged", () => {
    expect(
      resolveRendererEntry({
        isPackaged: false,
        devUrl: "http://127.0.0.1:1420",
        appPath: "/Applications/Slei.app/Contents/Resources/app.asar",
      }),
    ).toEqual({ kind: "url", value: "http://127.0.0.1:1420" });
  });

  it("returns the packaged renderer file inside the app path", () => {
    const appPath = "/Applications/Slei.app/Contents/Resources/app.asar";

    expect(
      resolveRendererEntry({
        isPackaged: true,
        devUrl: "http://127.0.0.1:1420",
        appPath,
      }),
    ).toEqual({ kind: "file", value: join(appPath, "dist", "index.html") });
  });

  it("never returns the local dev server URL for packaged builds", () => {
    const entry = resolveRendererEntry({
      isPackaged: true,
      devUrl: "http://127.0.0.1:1420",
      appPath: "/Applications/Slei.app/Contents/Resources/app.asar",
    });

    expect(entry.value).not.toContain("127.0.0.1:1420");
  });
});
