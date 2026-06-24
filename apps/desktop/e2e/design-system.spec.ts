import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shadcn design system wiring", () => {
  function cssBlock(source: string, selector: string) {
    const start = source.indexOf(`${selector} {`);
    if (start === -1) return "";
    const bodyStart = source.indexOf("{", start) + 1;
    const bodyEnd = source.indexOf("\n}", bodyStart);
    return source.slice(bodyStart, bodyEnd);
  }

  function tokenValue(source: string, name: string) {
    return source.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? "";
  }

  it("uses desktop-local shadcn configuration and tweakcn theme tokens", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const webEntry = readFileSync("src/web.ts", "utf8");
    const componentsConfig = JSON.parse(readFileSync("components.json", "utf8"));
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(existsSync("src/components/ui/button.tsx")).toBe(true);
    expect(existsSync("src/lib/utils.ts")).toBe(true);
    expect(componentsConfig.tsx).toBe(true);
    expect(componentsConfig.rsc).toBe(false);
    expect(componentsConfig.tailwind.css).toBe("src/app/app.css");
    expect(componentsConfig.aliases.ui).toBe("@/components/ui");
    expect(componentsConfig.aliases.utils).toBe("@/lib/utils");
    expect(packageJson.dependencies["@fontsource-variable/outfit"]).toBeDefined();
    expect(packageJson.dependencies["@fontsource-variable/geist"]).toBeUndefined();
    expect(packageJson.dependencies.shadcn).toBeUndefined();
    expect(packageJson.devDependencies.shadcn).toBeDefined();
    expect(appCss).toContain("--background: oklch(");
    expect(appCss).toContain("--font-sans: Outfit");
    expect(appCss).toContain('@import "@fontsource-variable/outfit"');
    expect(appCss).not.toContain("@fontsource-variable/geist");
    expect(appCss).toContain("@theme inline");
    expect(appCss).toContain("@layer base");
    expect(appCss).toContain("Temporary legacy app compatibility styles");
    expect(appCss).toContain(".slei-shell");
    expect(appCss).not.toContain([".slei", "button"].join("-"));
    expect(webEntry).toContain('import "./app/app.css";');
    expect(webEntry).not.toContain(["animal", "island-ui/style"].join("-"));
    expect(webEntry).not.toContain(["@slei", "ui/styles/tokens.css"].join("/"));
    expect(webEntry).not.toContain(["@slei", "ui/styles/globals.css"].join("/"));
  });

  it("uses 16px bold titles across modal surfaces", () => {
    const titleSources = [
      readFileSync("src/components/ui/dialog.tsx", "utf8"),
      readFileSync("src/components/ui/alert-dialog.tsx", "utf8"),
      readFileSync("src/components/ui/sheet.tsx", "utf8"),
    ];

    for (const source of titleSources) {
      expect(source).toContain("text-[16px]");
      expect(source).toContain("font-bold");
      expect(source).not.toContain("font-heading text-base font-medium");
      expect(source).not.toContain("font-heading text-base leading-none font-medium");
    }
  });

  it("uses a compact three-step radius scale for neumorphic controls", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const lightTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");
    const themeTokens = cssBlock(appCss, "@theme inline");

    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokenValue(tokens, "--slei-radius-small")).toBe("6px");
      expect(tokenValue(tokens, "--slei-radius-medium")).toBe("8px");
      expect(tokenValue(tokens, "--slei-radius-large")).toBe("10px");
      expect(tokenValue(tokens, "--radius")).toBe("var(--slei-radius-medium)");
    }

    expect(tokenValue(themeTokens, "--radius-sm")).toBe("var(--slei-radius-small)");
    expect(tokenValue(themeTokens, "--radius-md")).toBe("var(--slei-radius-medium)");
    expect(tokenValue(themeTokens, "--radius-lg")).toBe("var(--slei-radius-medium)");
    expect(tokenValue(themeTokens, "--radius-xl")).toBe("var(--slei-radius-large)");
    expect(tokenValue(themeTokens, "--radius-2xl")).toBe("var(--slei-radius-large)");
    expect(tokenValue(themeTokens, "--radius-3xl")).toBe("var(--slei-radius-large)");
    expect(tokenValue(themeTokens, "--radius-4xl")).toBe("var(--slei-radius-large)");
  });

  it("uses semantic raised, inset, and overlay shadow tokens with compatibility aliases", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const lightTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");

    expect(tokenValue(lightTokens, "--background")).toMatch(/^oklch\(0\.99[0-9] 0\.00[0-9] 190\)$/);
    expect(tokenValue(lightTokens, "--card")).toMatch(/^oklch\(0\.98[0-9] 0\.00[0-9] 190\)$/);
    expect(tokenValue(lightTokens, "--popover")).toMatch(/^oklch\(0\.99[0-9] 0\.00[0-9] 190\)$/);

    for (const token of [
      "--slei-shadow-inner-shade",
      "--slei-shadow-outer-glow",
      "--slei-overlay-shadow-color",
      "--slei-shadow-raised-shade",
      "--slei-shadow-inset-shade",
      "--slei-raised-border",
      "--slei-shadow-raised-s",
      "--slei-shadow-raised-m",
      "--slei-shadow-raised-l",
      "--slei-shadow-raised-xl",
      "--slei-shadow-raised-xs",
      "--slei-shadow-raised-sm",
      "--slei-shadow-raised-md",
      "--slei-shadow-raised-lg",
      "--slei-shadow-raised-small",
      "--slei-shadow-raised-medium",
      "--slei-shadow-raised-large",
      "--slei-shadow-inset-s",
      "--slei-shadow-inset-m",
      "--slei-shadow-inset-l",
      "--slei-shadow-inset-xl",
      "--slei-shadow-inset-xs",
      "--slei-shadow-inset-sm",
      "--slei-shadow-inset-md",
      "--slei-shadow-inset-lg",
      "--slei-shadow-inset-small",
      "--slei-shadow-inset-medium",
      "--slei-shadow-inset-large",
      "--slei-shadow-overlay-xs",
      "--slei-shadow-overlay-sm",
      "--slei-shadow-overlay-md",
      "--slei-shadow-tooltip",
    ]) {
      expect(lightTokens).toContain(`${token}:`);
      expect(darkTokens).toContain(`${token}:`);
    }

    expect(tokenValue(lightTokens, "--slei-shadow-raised")).toBe("var(--slei-shadow-raised-s)");
    expect(tokenValue(lightTokens, "--slei-shadow-inset")).toBe("var(--slei-shadow-inset-s)");
    expect(tokenValue(lightTokens, "--slei-shadow-tooltip")).toBe("var(--slei-shadow-overlay-xs)");
    expect(tokenValue(darkTokens, "--slei-shadow-raised")).toBe("var(--slei-shadow-raised-s)");
    expect(tokenValue(darkTokens, "--slei-shadow-inset")).toBe("var(--slei-shadow-inset-s)");
    expect(tokenValue(darkTokens, "--slei-shadow-tooltip")).toBe("var(--slei-shadow-overlay-xs)");

    for (const tokens of [lightTokens, darkTokens]) {
      const raised = tokenValue(tokens, "--slei-shadow-raised-m");
      const inset = tokenValue(tokens, "--slei-shadow-inset-m");
      const overlay = tokenValue(tokens, "--slei-shadow-overlay-sm");

      expect(raised).not.toContain("inset");
      expect(inset).toContain("inset");
      expect(overlay).not.toContain("inset");
      expect(overlay).not.toContain("slei-shadow-raised");
      expect(overlay).not.toContain("slei-shadow-inset");
    }

    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokenValue(tokens, "--slei-shadow-highlight")).toMatch(/^rgb\(255 255 255 \/ 0\.\d+\)$/);
      expect(tokenValue(tokens, "--slei-shadow-lowlight")).toMatch(/^rgb\(0 0 0 \/ 0\.\d+\)$/);
      expect(tokenValue(tokens, "--slei-overlay-shadow-color")).toMatch(/^rgb\(0 0 0 \/ 0\.\d+\)$/);
      expect(tokenValue(tokens, "--slei-shadow-raised-glow")).toMatch(/^rgb\(255 255 255 \/ 0\.\d+\)$/);
      expect(tokenValue(tokens, "--slei-shadow-raised-shade")).toMatch(/^rgb\(0 0 0 \/ 0\.\d+\)$/);
      expect(tokenValue(tokens, "--slei-shadow-inset-shade")).toMatch(/^rgb\(0 0 0 \/ 0\.\d+\)$/);
    }

    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokenValue(tokens, "--slei-shadow-raised-small")).toBe("var(--slei-shadow-raised-s)");
      expect(tokenValue(tokens, "--slei-shadow-raised-medium")).toBe("var(--slei-shadow-raised-s)");
      expect(tokenValue(tokens, "--slei-shadow-raised-large")).toBe("var(--slei-shadow-raised-s)");
      expect(tokenValue(tokens, "--slei-shadow-raised-xs")).toBe("var(--slei-shadow-raised-s)");
      expect(tokenValue(tokens, "--slei-shadow-raised-sm")).toBe("var(--slei-shadow-raised-s)");
      expect(tokenValue(tokens, "--slei-shadow-raised-md")).toBe("var(--slei-shadow-raised-s)");
      expect(tokenValue(tokens, "--slei-shadow-raised-lg")).toBe("var(--slei-shadow-raised-s)");
      expect(tokenValue(tokens, "--slei-shadow-inset-small")).toBe("var(--slei-shadow-inset-s)");
      expect(tokenValue(tokens, "--slei-shadow-inset-medium")).toBe("var(--slei-shadow-inset-s)");
      expect(tokenValue(tokens, "--slei-shadow-inset-large")).toBe("var(--slei-shadow-inset-s)");
      expect(tokenValue(tokens, "--slei-shadow-inset-xs")).toBe("var(--slei-shadow-inset-s)");
      expect(tokenValue(tokens, "--slei-shadow-inset-sm")).toBe("var(--slei-shadow-inset-s)");
      expect(tokenValue(tokens, "--slei-shadow-inset-md")).toBe("var(--slei-shadow-inset-s)");
      expect(tokenValue(tokens, "--slei-shadow-inset-lg")).toBe("var(--slei-shadow-inset-s)");
    }

    for (const [size, px] of [["s", "2px"], ["m", "4px"], ["l", "6px"], ["xl", "8px"]] as const) {
      expect(tokenValue(lightTokens, `--slei-shadow-raised-${size}`)).toContain(`-${px} -${px} 2px`);
      expect(tokenValue(lightTokens, `--slei-shadow-raised-${size}`)).toContain(`${px} ${px} 2px`);
      expect(tokenValue(lightTokens, `--slei-shadow-raised-${size}`)).toContain("var(--slei-shadow-raised-shade)");
      expect(tokenValue(lightTokens, `--slei-shadow-raised-${size}`)).not.toContain("var(--slei-shadow-lowlight)");
      expect(tokenValue(lightTokens, `--slei-shadow-inset-${size}`)).toContain(`inset ${px} ${px} 2px`);
      expect(tokenValue(lightTokens, `--slei-shadow-inset-${size}`)).toContain(`inset -${px} -${px} 2px`);
      expect(tokenValue(lightTokens, `--slei-shadow-inset-${size}`)).toContain("var(--slei-shadow-inset-shade)");
      expect(tokenValue(lightTokens, `--slei-shadow-inset-${size}`)).not.toContain("var(--slei-shadow-lowlight)");
    }
  });
});
