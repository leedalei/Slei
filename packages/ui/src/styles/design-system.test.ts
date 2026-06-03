import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync("src/styles/tokens.css", "utf8");
const globalsCss = readFileSync("src/styles/globals.css", "utf8");

describe("Slei Animal Island design tokens", () => {
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
      "--color-accent-strong",
      "--color-accent-subtle",
      "--color-surface-pattern",
      "--color-theme-dark-accent",
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
      "--shadow-soft",
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

  it("uses rounded Animal Island component geometry", () => {
    expect(tokensCss).toContain("--radius-control: 999px;");
    expect(tokensCss).toContain("--radius-modal: var(--primitive-radius-24);");
    expect(tokensCss).toContain("--radius-badge: 999px;");
    expect(tokensCss).toContain("--radius-avatar: 50%;");
  });

  it("styles shared controls with Animal Island soft geometry", () => {
    expect(globalsCss).toMatch(/\.slei-button\s*\{[^}]*border-radius:\s*var\(--radius-control\);/s);
    expect(globalsCss).toMatch(/\.slei-button:hover\s*\{[^}]*transform:\s*translateY\(-1px\);/s);
    expect(globalsCss).toMatch(/\.slei-card\s*\{[^}]*border-radius:\s*var\(--radius-card\);/s);
    expect(globalsCss).toMatch(/\.slei-avatar\s*\{[^}]*border-radius:\s*var\(--radius-avatar\);/s);
  });
});
