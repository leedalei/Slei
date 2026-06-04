import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shadcn design system wiring", () => {
  it("uses desktop-local shadcn configuration and tweakcn theme tokens", () => {
    const appCss = readFileSync("src/app/app.css", "utf8");
    const componentsJson = readFileSync("components.json", "utf8");

    expect(existsSync("src/components/ui/button.tsx")).toBe(true);
    expect(existsSync("src/lib/utils.ts")).toBe(true);
    expect(componentsJson).toContain('"ui"');
    expect(componentsJson).toContain('"@/components/ui"');
    expect(appCss).toContain("--background: oklch(");
    expect(appCss).toContain("--font-sans: Outfit");
    expect(appCss).toContain("@theme inline");
    expect(appCss).toContain("@layer base");
  });
});
