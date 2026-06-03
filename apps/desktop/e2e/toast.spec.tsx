import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { Toast } from "../src/components";

describe("shared toast feedback", () => {
  it("renders polite live-region feedback", () => {
    const html = renderToStaticMarkup(<Toast message="复制成功" />);

    expect(html).toContain("slei-toast");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("复制成功");
  });

  it("uses Animal Island warning surface with readable text", () => {
    const css = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const toastRule = css.match(/\.slei-toast\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(toastRule).toContain("background: var(--color-warning-bg)");
    expect(toastRule).toContain("border: var(--border-card) solid var(--color-warning)");
    expect(toastRule).toContain("border-radius: var(--radius-card)");
    expect(toastRule).toContain("color: var(--color-text-primary)");
    expect(toastRule).toContain("box-shadow: var(--shadow-lg)");
  });
});
