import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SoftPanel } from "./SoftPanel";

describe("SoftPanel", () => {
  it("renders a soft panel with stable semantic attributes", () => {
    const html = renderToStaticMarkup(
      <SoftPanel variant="raised">面板内容</SoftPanel>,
    );

    expect(html).toContain("data-slei-panel");
    expect(html).toContain('data-variant="raised"');
    expect(html).toContain("面板内容");
  });
});
