import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync("src/styles/tokens.css", "utf8");
const globalsCss = readFileSync("src/styles/globals.css", "utf8");

describe("Slei Neo-Brutalism design tokens", () => {
  it("exposes the semantic token surface required by the desktop design system", () => {
    [
      "--color-bg",
      "--color-surface",
      "--color-surface-alt",
      "--color-surface-hover",
      "--color-text-primary",
      "--color-text-secondary",
      "--color-text-muted",
      "--color-text-inverse",
      "--color-accent",
      "--color-accent-subtle",
      "--color-success",
      "--color-warning",
      "--color-error",
      "--color-run-running",
      "--text-md",
      "--text-xl",
      "--text-2xl",
      "--weight-black",
      "--border-panel",
      "--radius-modal",
      "--radius-full",
      "--shadow-xl",
      "--padding-panel",
      "--padding-card",
      "--padding-message-y",
      "--duration-appear",
    ].forEach((token) => expect(tokensCss).toContain(token));
  });

  it("keeps component styles on semantic tokens only", () => {
    expect(globalsCss).not.toContain("var(--primitive-");
    expect(globalsCss).toContain("--border-panel");
    expect(globalsCss).toContain(".slei-select");
    expect(globalsCss).toContain(".slei-checkbox");
    expect(globalsCss).toContain("--shadow-lg");
    expect(globalsCss).toContain("prefers-reduced-motion");
  });

  it("keeps component radii square for the Neo-Brutalism surface", () => {
    expect(tokensCss).toContain("--radius-control: var(--radius-none);");
    expect(tokensCss).toContain("--radius-modal: var(--radius-none);");
    expect(tokensCss).toContain("--radius-badge: var(--radius-none);");
    expect(tokensCss).toContain("--radius-avatar: var(--radius-none);");
    expect(globalsCss).toMatch(/\.slei-input\s*\{[^}]*border-radius:\s*var\(--radius-none\);/s);
  });
});
