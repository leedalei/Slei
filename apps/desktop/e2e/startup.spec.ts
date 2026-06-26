import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const desktopRoot = new URL("..", import.meta.url).pathname;

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
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
    expect(desktopDevScript).toContain("cargo build -p slei-cli");
    expect(desktopDevScript).toContain("cargo run -p slei-daemon");
    expect(desktopDevScript.indexOf("cargo build -p slei-cli")).toBeLessThan(
      desktopDevScript.indexOf("cargo run -p slei-daemon"),
    );
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

  it("uses slei as the native app executable name", async () => {
    const cargoToml = await readFile(join(desktopRoot, "src-tauri/Cargo.toml"), "utf8");

    expect(cargoToml).toContain('name = "slei"');
    expect(cargoToml).not.toContain('name = "slei-desktop"');
  });

  it("allows only the window permission needed by overlay drag regions", async () => {
    const capability = JSON.parse(
      await readFile(join(desktopRoot, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { permissions?: string[] };

    expect(capability.permissions).toEqual([
      "core:window:allow-start-dragging",
      "core:window:allow-internal-toggle-maximize",
    ]);
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
    const sourceIcon = await readFile(join(iconRoot, "slei-icon.svg"), "utf8");

    expect(sourceIcon).toContain('stop-color="#0B9C67"');
    expect(sourceIcon).toContain('stop-color="#16C78A"');
    expect(sourceIcon).toContain('stroke="#FFFFFF"');
    expect(sourceIcon).toContain('stroke-opacity="0.62"');
    expect(sourceIcon).toContain('r="2.55"');
    expect(sourceIcon).toContain('fill-opacity="0.88"');
    expect(sourceIcon).not.toContain('r="3.05"');
    await expect(sha256(join(iconRoot, "slei-icon.svg"))).resolves.toBe("362ce08df11fe71bd6a1c69a64ccd53b0d231ad0359b2a528275914384310c3e");
    await expect(sha256(join(iconRoot, "icon.png"))).resolves.toBe("4d186b83834748fd3305539e29480276471e3ce550f411cdbbfb0bc3416fbc7d");
    await expect(sha256(join(iconRoot, "icon.ico"))).resolves.toBe("e39158aa973ce8dd95dfa3ea6b2a7e3caaa8d82a47016d19271a13c42ff2f023");
    await expect(sha256(join(iconRoot, "32x32.png"))).resolves.toBe("1999254eced9f512326d46615f0afd46d95c1fe439f4cfeaac3a9394fff650ed");
    await expect(sha256(join(iconRoot, "128x128.png"))).resolves.toBe("e30988843d2253fab15c26e5b3fadc4a55a0778b2e85a551dbfd5dfff52a9700");
    await expect(sha256(join(iconRoot, "128x128@2x.png"))).resolves.toBe("280bd0dcd391d3ef4eb048c171f1de1dd49402869c4d251deed85141304d2770");
    await expect(icnsPngHashes(join(iconRoot, "icon.icns"))).resolves.toEqual(
      expect.arrayContaining([
        "1999254eced9f512326d46615f0afd46d95c1fe439f4cfeaac3a9394fff650ed",
        "e30988843d2253fab15c26e5b3fadc4a55a0778b2e85a551dbfd5dfff52a9700",
        "280bd0dcd391d3ef4eb048c171f1de1dd49402869c4d251deed85141304d2770",
        "4d186b83834748fd3305539e29480276471e3ce550f411cdbbfb0bc3416fbc7d",
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
