import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders a filled task status badge with a semantic data attribute", () => {
    const html = renderToStaticMarkup(<StatusBadge label="运行中" status="running" />);

    expect(html).toContain('data-slei-status="running"');
    expect(html).toContain("运行中");
    expect(html).toContain("<svg");
  });
});
