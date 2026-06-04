import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Toast } from "../src/components";

describe("shared toast feedback", () => {
  it("renders polite live-region feedback", () => {
    const html = renderToStaticMarkup(<Toast text="复制成功" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("fixed");
    expect(html).toContain("bg-popover");
    expect(html).toContain("复制成功");
  });

  it("does not render an empty status region", () => {
    const html = renderToStaticMarkup(<Toast text="" />);

    expect(html).toBe("");
  });
});
