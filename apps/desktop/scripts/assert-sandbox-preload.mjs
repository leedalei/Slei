import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const preloadPath = resolve(desktopRoot, "dist-electron/electron/preload.cjs");
const mainPath = resolve(desktopRoot, "dist-electron/electron/main.js");

const [preload, main] = await Promise.all([readFile(preloadPath, "utf8"), readFile(mainPath, "utf8")]);

if (/^\s*(import|export)\s/m.test(preload)) {
  throw new Error("Sandboxed Electron preload output must not contain top-level ESM import/export syntax.");
}

if (!/\brequire\(["']electron["']\)/.test(preload)) {
  throw new Error('Sandboxed Electron preload output must load Electron APIs with require("electron").');
}

if (!main.includes('"preload.cjs"') && !main.includes("'preload.cjs'")) {
  throw new Error("Electron main output must point BrowserWindow preload to preload.cjs.");
}
