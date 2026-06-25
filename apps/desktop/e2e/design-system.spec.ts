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

  const legacyThemeLeakagePattern = /--slei-|var\(--slei-|@utility\s+slei-|slei-(?:raised|inset|hover-transition)/;

  it("uses desktop-local shadcn configuration and EinUI theme tokens", () => {
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
    expect(appCss).not.toContain("Temporary legacy app compatibility styles");
    expect(appCss).not.toMatch(legacyThemeLeakagePattern);
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
      expect(source).toContain("text-lg");
      expect(source).toContain("font-semibold");
      expect(source).toContain("text-white");
      expect(source).not.toContain("font-heading text-base font-medium");
      expect(source).not.toContain("font-heading text-base leading-none font-medium");
    }
  });

  it("uses neutral EinUI radius tokens and Tailwind v4 mappings", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const rootTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");
    const lightTokens = cssBlock(appCss, ".light");
    const themeTokens = cssBlock(appCss, "@theme inline");

    expect(tokenValue(rootTokens, "--radius-xs")).toBe("6px");
    expect(tokenValue(rootTokens, "--radius-sm")).toBe("6px");
    expect(tokenValue(rootTokens, "--radius-base")).toBe("8px");
    expect(tokenValue(rootTokens, "--radius-md")).toBe("8px");
    expect(tokenValue(rootTokens, "--radius-lg")).toBe("10px");
    expect(tokenValue(rootTokens, "--radius-xl")).toBe("12px");
    expect(tokenValue(rootTokens, "--radius")).toBe("var(--radius-base)");
    expect(darkTokens).not.toContain("--radius-");
    expect(appCss).not.toContain("--slei-radius");

    expect(tokenValue(lightTokens, "--background")).toBe("oklch(0.985 0.006 220)");
    expect(tokenValue(lightTokens, "--foreground")).toBe("oklch(0.22 0.035 250)");
    expect(tokenValue(themeTokens, "--radius-sm")).toBe("var(--radius-xs)");
    expect(tokenValue(themeTokens, "--radius-md")).toBe("var(--radius-base)");
    expect(tokenValue(themeTokens, "--radius-lg")).toBe("var(--radius-md)");
    expect(tokenValue(themeTokens, "--radius-xl")).toBe("var(--radius-lg)");
    expect(tokenValue(themeTokens, "--radius-2xl")).toBe("var(--radius-xl)");
    expect(tokenValue(themeTokens, "--radius-3xl")).toBe("var(--radius-xl)");
    expect(tokenValue(themeTokens, "--radius-4xl")).toBe("var(--radius-xl)");
    expect(tokenValue(themeTokens, "--radius")).toBe("var(--radius-base)");
  });

  it("uses dark-first EinUI glass surface tokens with light overrides", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const rootTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");
    const lightTokens = cssBlock(appCss, ".light");

    for (const tokens of [rootTokens, darkTokens]) {
      for (const token of [
        "--glass-bg",
        "--glass-border",
        "--glass-blur",
        "--glow-cyan",
        "--glow-purple",
        "--glow-pink",
        "--text-primary",
        "--text-secondary",
        "--text-muted",
      ]) {
        expect(tokens).toContain(`${token}:`);
      }
    }

    expect(tokenValue(rootTokens, "--glass-bg")).toBe("rgba(255, 255, 255, 0.05)");
    expect(tokenValue(rootTokens, "--glass-border")).toBe("rgba(255, 255, 255, 0.1)");
    expect(tokenValue(rootTokens, "--glow-cyan")).toBe("rgba(6, 182, 212, 0.3)");
    expect(tokenValue(rootTokens, "--glass-nav-bg")).toContain("var(--glass-bg)");
    expect(tokenValue(rootTokens, "--glass-sidebar-bg")).toContain("var(--glass-bg)");
    expect(tokenValue(rootTokens, "--glass-surface-filter")).toBe("blur(var(--glass-blur)) saturate(145%)");
    expect(tokenValue(rootTokens, "--glass-button-border")).toBe("var(--glass-border)");
    expect(tokenValue(rootTokens, "--glass-button-hover-border")).toContain("var(--glow-cyan)");
    expect(tokenValue(rootTokens, "--glass-button-shadow")).toContain("var(--overlay-shadow-color)");
    expect(tokenValue(rootTokens, "--glass-button-primary-gradient-bg")).toContain("var(--glow-cyan)");
    expect(tokenValue(rootTokens, "--glass-button-primary-gradient-bg")).toContain("var(--glow-purple)");

    expect(tokenValue(lightTokens, "--glass-bg")).toBe("rgba(0, 0, 0, 0.03)");
    expect(tokenValue(lightTokens, "--glass-border")).toBe("rgba(0, 0, 0, 0.08)");
    expect(tokenValue(lightTokens, "--glow-cyan")).toBe("rgba(6, 182, 212, 0.15)");
    expect(tokenValue(lightTokens, "--glow-purple")).toBe("rgba(147, 51, 234, 0.15)");
    expect(tokenValue(darkTokens, "--glass-bg")).toBe("rgba(255, 255, 255, 0.05)");
    expect(tokenValue(darkTokens, "--glass-border")).toBe("rgba(255, 255, 255, 0.1)");
    expect(tokenValue(darkTokens, "--glow-cyan")).toBe("rgba(6, 182, 212, 0.3)");
  });

  it("uses neutral overlay shadows and dark-first body background", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const rootTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");
    const lightTokens = cssBlock(appCss, ".light");

    expect(tokenValue(rootTokens, "--background")).toBe("oklch(0.18 0.045 255)");
    expect(tokenValue(rootTokens, "--foreground")).toBe("oklch(0.96 0.018 230)");
    expect(tokenValue(rootTokens, "--card")).toBe("oklch(0.24 0.045 255 / 0.72)");
    expect(tokenValue(darkTokens, "--background")).toBe(tokenValue(rootTokens, "--background"));
    expect(tokenValue(darkTokens, "--foreground")).toBe(tokenValue(rootTokens, "--foreground"));
    expect(tokenValue(lightTokens, "--background")).toBe("oklch(0.985 0.006 220)");

    expect(tokenValue(rootTokens, "--overlay-shadow-color")).toBe("rgb(0 0 0 / 0.54)");
    expect(tokenValue(rootTokens, "--overlay-shadow-xs")).toContain("var(--overlay-shadow-color)");
    expect(tokenValue(rootTokens, "--overlay-shadow-sm")).toContain("var(--overlay-shadow-color)");
    expect(tokenValue(rootTokens, "--overlay-shadow-md")).toContain("var(--overlay-shadow-color)");
    expect(tokenValue(lightTokens, "--overlay-shadow-color")).toBe("rgb(15 23 42 / 0.20)");
    expect(appCss).toContain(`body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background:
    linear-gradient(to bottom right, #0f172a, #1e1b4b, #0f172a);`);
  });
});
