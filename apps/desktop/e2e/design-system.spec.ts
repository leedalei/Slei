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
      "--slei-shadow-raised-xs",
      "--slei-shadow-raised-sm",
      "--slei-shadow-raised-md",
      "--slei-shadow-raised-lg",
      "--slei-shadow-inset-xs",
      "--slei-shadow-inset-sm",
      "--slei-shadow-inset-md",
      "--slei-shadow-inset-lg",
      "--slei-shadow-overlay-xs",
      "--slei-shadow-overlay-sm",
      "--slei-shadow-overlay-md",
      "--slei-shadow-tooltip",
    ]) {
      expect(lightTokens).toContain(`${token}:`);
      expect(darkTokens).toContain(`${token}:`);
    }

    expect(tokenValue(lightTokens, "--slei-shadow-raised")).toBe("var(--slei-shadow-raised-md)");
    expect(tokenValue(lightTokens, "--slei-shadow-inset")).toBe("var(--slei-shadow-inset-md)");
    expect(tokenValue(lightTokens, "--slei-shadow-tooltip")).toBe("var(--slei-shadow-overlay-xs)");
    expect(tokenValue(darkTokens, "--slei-shadow-raised")).toBe("var(--slei-shadow-raised-md)");
    expect(tokenValue(darkTokens, "--slei-shadow-inset")).toBe("var(--slei-shadow-inset-md)");
    expect(tokenValue(darkTokens, "--slei-shadow-tooltip")).toBe("var(--slei-shadow-overlay-xs)");

    for (const tokens of [lightTokens, darkTokens]) {
      const raised = tokenValue(tokens, "--slei-shadow-raised-md");
      const inset = tokenValue(tokens, "--slei-shadow-inset-md");
      const overlay = tokenValue(tokens, "--slei-shadow-overlay-sm");

      expect(raised).not.toContain("inset");
      expect(inset).toContain("inset");
      expect(overlay).not.toContain("inset");
      expect(overlay).not.toContain("slei-shadow-raised");
      expect(overlay).not.toContain("slei-shadow-inset");
    }

    expect(tokenValue(lightTokens, "--slei-shadow-raised-glow")).toBe("oklch(1 0 0 / 1)");
    expect(tokenValue(darkTokens, "--slei-shadow-raised-glow")).toBe("oklch(0.88 0.012 190 / 0.52)");
    expect(tokenValue(lightTokens, "--slei-shadow-raised-sm")).toContain("-4px -4px 10px");
    expect(tokenValue(lightTokens, "--slei-shadow-raised-sm")).toContain("5px 5px 10px");
    expect(tokenValue(lightTokens, "--slei-shadow-raised-sm")).toContain("var(--slei-shadow-raised-shade)");
    expect(tokenValue(lightTokens, "--slei-shadow-raised-sm")).not.toContain("var(--slei-shadow-lowlight)");
    expect(tokenValue(lightTokens, "--slei-shadow-inset-sm")).toContain("inset 3px 3px 7px");
    expect(tokenValue(lightTokens, "--slei-shadow-inset-sm")).toContain("inset -3px -3px 7px");
    expect(tokenValue(lightTokens, "--slei-shadow-inset-sm")).toContain("var(--slei-shadow-inset-shade)");
    expect(tokenValue(lightTokens, "--slei-shadow-inset-sm")).not.toContain("var(--slei-shadow-lowlight)");
  });
});
