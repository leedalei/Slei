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
  const darkNeutralTokens = {
    "--n10": "#1F1F1F",
    "--n20": "#292929",
    "--n30": "#424242",
    "--n40": "#5C5C5C",
    "--n50": "#757575",
    "--n60": "#8F8F8F",
    "--n70": "#A8A8A8",
    "--n80": "#C2C2C2",
    "--n90": "#DBDBDB",
    "--n100": "#F5F5F5",
  };
  const lightNeutralTokens = {
    "--n10": "#FAFAFA",
    "--n20": "#F5F5F5",
    "--n30": "#E6E6E6",
    "--n40": "#D1D1D1",
    "--n50": "#ADADAD",
    "--n60": "#8A8A8A",
    "--n70": "#707070",
    "--n80": "#525252",
    "--n90": "#383838",
    "--n100": "#292929",
  };
  const vegaLightShadcnTokens = {
    "--background": "oklch(1 0 0)",
    "--foreground": "oklch(0.145 0 0)",
    "--card": "oklch(1 0 0)",
    "--card-foreground": "oklch(0.145 0 0)",
    "--popover": "oklch(1 0 0)",
    "--popover-foreground": "oklch(0.145 0 0)",
    "--primary": "oklch(0.205 0 0)",
    "--primary-foreground": "oklch(0.985 0 0)",
    "--secondary": "oklch(0.97 0 0)",
    "--secondary-foreground": "oklch(0.205 0 0)",
    "--muted": "oklch(0.97 0 0)",
    "--muted-foreground": "oklch(0.556 0 0)",
    "--accent": "oklch(0.97 0 0)",
    "--accent-foreground": "oklch(0.205 0 0)",
    "--destructive": "oklch(0.577 0.245 27.325)",
    "--border": "oklch(0.922 0 0)",
    "--input": "oklch(0.922 0 0)",
    "--ring": "oklch(0.708 0 0)",
    "--chart-1": "oklch(0.87 0 0)",
    "--chart-2": "oklch(0.556 0 0)",
    "--chart-3": "oklch(0.439 0 0)",
    "--chart-4": "oklch(0.371 0 0)",
    "--chart-5": "oklch(0.269 0 0)",
    "--sidebar": "oklch(0.985 0 0)",
    "--sidebar-foreground": "oklch(0.145 0 0)",
    "--sidebar-primary": "oklch(0.205 0 0)",
    "--sidebar-primary-foreground": "oklch(0.985 0 0)",
    "--sidebar-accent": "oklch(0.97 0 0)",
    "--sidebar-accent-foreground": "oklch(0.205 0 0)",
    "--sidebar-border": "oklch(0.922 0 0)",
    "--sidebar-ring": "oklch(0.708 0 0)",
  };
  const vegaDarkShadcnTokens = {
    "--background": "oklch(0.145 0 0)",
    "--foreground": "oklch(0.985 0 0)",
    "--card": "oklch(0.205 0 0)",
    "--card-foreground": "oklch(0.985 0 0)",
    "--popover": "oklch(0.205 0 0)",
    "--popover-foreground": "oklch(0.985 0 0)",
    "--primary": "oklch(0.922 0 0)",
    "--primary-foreground": "oklch(0.205 0 0)",
    "--secondary": "oklch(0.269 0 0)",
    "--secondary-foreground": "oklch(0.985 0 0)",
    "--muted": "oklch(0.269 0 0)",
    "--muted-foreground": "oklch(0.708 0 0)",
    "--accent": "oklch(0.269 0 0)",
    "--accent-foreground": "oklch(0.985 0 0)",
    "--destructive": "oklch(0.704 0.191 22.216)",
    "--border": "oklch(1 0 0 / 10%)",
    "--input": "oklch(1 0 0 / 15%)",
    "--ring": "oklch(0.556 0 0)",
    "--chart-1": "oklch(0.87 0 0)",
    "--chart-2": "oklch(0.556 0 0)",
    "--chart-3": "oklch(0.439 0 0)",
    "--chart-4": "oklch(0.371 0 0)",
    "--chart-5": "oklch(0.269 0 0)",
    "--sidebar": "oklch(0.205 0 0)",
    "--sidebar-foreground": "oklch(0.985 0 0)",
    "--sidebar-primary": "oklch(0.488 0.243 264.376)",
    "--sidebar-primary-foreground": "oklch(0.985 0 0)",
    "--sidebar-accent": "oklch(0.269 0 0)",
    "--sidebar-accent-foreground": "oklch(0.985 0 0)",
    "--sidebar-border": "oklch(1 0 0 / 10%)",
    "--sidebar-ring": "oklch(0.556 0 0)",
  };

  function expectTokens(block: string, tokens: Record<string, string>) {
    for (const [token, value] of Object.entries(tokens)) {
      expect(tokenValue(block, token)).toBe(value);
    }
  }

  it("uses desktop-local shadcn configuration and Vega theme tokens", () => {
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
    expect(appCss).toContain(".slei-app-shell");
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
      expect(source).not.toContain("text-popover-foreground");
      expect(source).not.toContain("font-heading text-base font-medium");
      expect(source).not.toContain("font-heading text-base leading-none font-medium");
    }
  });

  it("uses Vega shadcn radius tokens and Tailwind v4 mappings", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const rootTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");
    const lightTokens = cssBlock(appCss, ".light");
    const themeTokens = cssBlock(appCss, "@theme inline");

    expect(tokenValue(rootTokens, "--radius")).toBe("0.625rem");
    expect(tokenValue(darkTokens, "--radius")).toBe("");
    expect(tokenValue(lightTokens, "--radius")).toBe("");
    expect(appCss).not.toContain("--slei-radius");

    expect(tokenValue(lightTokens, "--background")).toBe(vegaLightShadcnTokens["--background"]);
    expect(tokenValue(lightTokens, "--foreground")).toBe(vegaLightShadcnTokens["--foreground"]);
    expect(tokenValue(themeTokens, "--radius-sm")).toBe("calc(var(--radius) - 4px)");
    expect(tokenValue(themeTokens, "--radius-md")).toBe("calc(var(--radius) - 2px)");
    expect(tokenValue(themeTokens, "--radius-lg")).toBe("var(--radius)");
    expect(tokenValue(themeTokens, "--radius-xl")).toBe("calc(var(--radius) + 4px)");
    expect(tokenValue(themeTokens, "--radius-2xl")).toBe("calc(var(--radius) + 8px)");
    expect(tokenValue(themeTokens, "--radius-3xl")).toBe("calc(var(--radius) + 12px)");
    expect(tokenValue(themeTokens, "--radius-4xl")).toBe("calc(var(--radius) + 16px)");
  });

  it("maps global text colors through four neutral depth tokens", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const rootTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");
    const lightTokens = cssBlock(appCss, ".light");
    const themeTokens = cssBlock(appCss, "@theme inline");

    for (const [token, value] of Object.entries(darkNeutralTokens)) {
      expect(tokenValue(rootTokens, token)).toBe(value);
      expect(tokenValue(darkTokens, token)).toBe(value);
    }

    for (const [token, value] of Object.entries(lightNeutralTokens)) {
      expect(tokenValue(lightTokens, token)).toBe(value);
    }

    for (const tokens of [rootTokens, darkTokens, lightTokens]) {
      expect(tokenValue(tokens, "--text-color-1")).toBe("var(--n100)");
      expect(tokenValue(tokens, "--text-color-2")).toBe("var(--n80)");
      expect(tokenValue(tokens, "--text-color-3")).toBe("var(--n60)");
      expect(tokenValue(tokens, "--text-color-4")).toBe("var(--n50)");
      expect(tokenValue(tokens, "--text-primary")).toBe("var(--text-color-1)");
      expect(tokenValue(tokens, "--text-secondary")).toBe("var(--text-color-2)");
      expect(tokenValue(tokens, "--text-muted")).toBe("var(--text-color-3)");
    }

    expect(tokenValue(themeTokens, "--color-foreground")).toBe("var(--foreground)");
    expect(tokenValue(themeTokens, "--color-card-foreground")).toBe("var(--card-foreground)");
    expect(tokenValue(themeTokens, "--color-muted-foreground")).toBe("var(--muted-foreground)");
    expect(appCss).toContain(`body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: transparent;
  color: var(--text-color-1);`);
  });

  it("keeps shell glass surface tokens with light overrides", () => {
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
    expect(tokenValue(rootTokens, "--glass-blur")).toBe("20px");
    expect(tokenValue(rootTokens, "--glass-surface-filter")).toBe("blur(20px) saturate(150%)");
    expect(tokenValue(rootTokens, "--glass-button-border")).toBe("var(--glass-border)");
    expect(tokenValue(rootTokens, "--glass-button-hover-border")).toContain("var(--glow-cyan)");
    expect(tokenValue(rootTokens, "--glass-button-shadow")).toContain("var(--overlay-shadow-color)");
    expect(tokenValue(rootTokens, "--glass-button-primary-bg")).toBe("var(--primary)");
    expect(tokenValue(rootTokens, "--glass-button-primary-gradient-bg")).toBe("");

    expect(tokenValue(lightTokens, "--glass-bg")).toBe("rgba(0, 0, 0, 0.03)");
    expect(tokenValue(lightTokens, "--glass-border")).toBe("rgba(0, 0, 0, 0.08)");
    expect(tokenValue(lightTokens, "--glow-cyan")).toBe("rgba(6, 182, 212, 0.15)");
    expect(tokenValue(lightTokens, "--glow-purple")).toBe("rgba(147, 51, 234, 0.15)");
    expect(tokenValue(darkTokens, "--glass-bg")).toBe("rgba(255, 255, 255, 0.05)");
    expect(tokenValue(darkTokens, "--glass-border")).toBe("rgba(255, 255, 255, 0.1)");
    expect(tokenValue(darkTokens, "--glow-cyan")).toBe("rgba(6, 182, 212, 0.3)");
  });

  it("uses Vega shadcn semantic tokens in root, dark, and light scopes", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const rootTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");
    const lightTokens = cssBlock(appCss, ".light");

    expectTokens(rootTokens, vegaLightShadcnTokens);
    expectTokens(darkTokens, vegaDarkShadcnTokens);
    expectTokens(lightTokens, vegaLightShadcnTokens);
  });

  it("uses neutral overlay shadows while keeping body and workspace backgrounds transparent", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const rootTokens = cssBlock(appCss, ":root");
    const darkTokens = cssBlock(appCss, ".dark");
    const lightTokens = cssBlock(appCss, ".light");

    expect(tokenValue(rootTokens, "--background")).toBe(vegaLightShadcnTokens["--background"]);
    expect(tokenValue(rootTokens, "--foreground")).toBe(vegaLightShadcnTokens["--foreground"]);
    expect(tokenValue(rootTokens, "--card")).toBe(vegaLightShadcnTokens["--card"]);
    expect(tokenValue(darkTokens, "--background")).toBe(vegaDarkShadcnTokens["--background"]);
    expect(tokenValue(darkTokens, "--foreground")).toBe(vegaDarkShadcnTokens["--foreground"]);
    expect(tokenValue(lightTokens, "--background")).toBe(vegaLightShadcnTokens["--background"]);

    expect(tokenValue(rootTokens, "--overlay-shadow-color")).toBe("rgb(0 0 0 / 0.14)");
    expect(tokenValue(rootTokens, "--overlay-shadow-xs")).toContain("var(--overlay-shadow-color)");
    expect(tokenValue(rootTokens, "--overlay-shadow-sm")).toContain("var(--overlay-shadow-color)");
    expect(tokenValue(rootTokens, "--overlay-shadow-md")).toContain("var(--overlay-shadow-color)");
    expect(tokenValue(lightTokens, "--overlay-shadow-color")).toBe("rgb(15 23 42 / 0.10)");
    expect(appCss).toContain(`body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: transparent;
  color: var(--text-color-1);`);
    expect(appCss).not.toContain("linear-gradient(to bottom right");
    expect(appCss).not.toContain("html.dark body");
    expect(appCss).not.toContain("html.light body");
    expect(appCss).not.toContain("::selection");
    expect(appCss).toContain(`.slei-glass-workspace {
  -webkit-backdrop-filter: var(--glass-surface-filter);
  backdrop-filter: var(--glass-surface-filter);
  background: var(--workspace-glass-bg);`);
  });
});
