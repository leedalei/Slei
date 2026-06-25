import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SoftPanel } from "./SoftPanel";

const legacyInsetClassPrefix = ["slei", "inset"].join("-");

describe("SoftPanel", () => {
  it("renders a soft panel with stable semantic attributes", () => {
    const html = renderToStaticMarkup(
      <SoftPanel variant="raised">面板内容</SoftPanel>,
    );

    expect(html).toContain("data-slei-panel");
    expect(html).toContain('data-variant="raised"');
    expect(html).toContain("面板内容");
  });

  it("can render an outline-only panel without a filled background", () => {
    const html = renderToStaticMarkup(
      <SoftPanel variant="outline">资料</SoftPanel>,
    );

    expect(html).toContain('data-variant="outline"');
    expect(html).toContain("border-border/60");
    expect(html).not.toContain("bg-card");
    expect(html).not.toContain("bg-muted");
  });

  it("normalizes requested inset sizes to the small inset shadow", () => {
    const html = renderToStaticMarkup(
      <SoftPanel insetSize="small" variant="inset">搜索栏</SoftPanel>,
    );

    expect(html).toContain('data-variant="inset"');
    expect(html).toContain("shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]");
    expect(html).not.toContain(legacyInsetClassPrefix);
  });

  it("uses the small inset size by default", () => {
    const html = renderToStaticMarkup(
      <SoftPanel variant="inset">默认凹陷面板</SoftPanel>,
    );

    expect(html).toContain("shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]");
    expect(html).not.toContain(legacyInsetClassPrefix);
  });
});
