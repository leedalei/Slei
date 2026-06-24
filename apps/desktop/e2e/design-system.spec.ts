import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shadcn design system wiring", () => {
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

  it("uses near-white light neumorphic tokens with compatibility aliases", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");

    expect(tokenValue(appCss, "--background")).toMatch(/^oklch\(0\.99[0-9] 0\.00[0-9] 190\)$/);
    expect(tokenValue(appCss, "--card")).toMatch(/^oklch\(0\.98[0-9] 0\.00[0-9] 190\)$/);
    expect(tokenValue(appCss, "--popover")).toMatch(/^oklch\(0\.99[0-9] 0\.00[0-9] 190\)$/);

    for (const token of [
      "--slei-shadow-inner-shade",
      "--slei-shadow-outer-glow",
      "--slei-shadow-soft-xs",
      "--slei-shadow-soft-sm",
      "--slei-shadow-soft-md",
      "--slei-shadow-soft-lg",
      "--slei-shadow-tooltip",
    ]) {
      expect(appCss).toContain(`${token}:`);
    }

    expect(tokenValue(appCss, "--slei-shadow-raised")).toBe("var(--slei-shadow-soft-md)");
    expect(tokenValue(appCss, "--shadow-sm")).toBe("var(--slei-shadow-soft-xs)");
    expect(tokenValue(appCss, "--shadow-md")).toBe("var(--slei-shadow-soft-sm)");
    expect(tokenValue(appCss, "--shadow-lg")).toBe("var(--slei-shadow-soft-md)");
    expect(tokenValue(appCss, "--slei-shadow-soft-md")).toContain("inset 3px 3px");
    expect(tokenValue(appCss, "--slei-shadow-soft-md")).toContain("10px 10px");
    expect(tokenValue(appCss, "--slei-shadow-tooltip")).toContain("8px");
  });
});
