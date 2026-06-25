import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Empty } from "./Empty";

describe("Empty", () => {
  it("keeps the default empty state unframed", () => {
    const html = renderToStaticMarkup(<Empty title="暂无数据" />);

    expect(html).toContain('role="status"');
    expect(html).toContain("暂无数据");
    expect(html).not.toContain("data-slei-panel");
  });

  it("uses an EinUI card when the framed shell is requested", () => {
    const html = renderToStaticMarkup(<Empty framed title="暂无数据" />);

    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-empty-size="md"');
    expect(html).toContain('data-empty-variant="nodata"');
    expect(html).not.toContain("data-slei-panel");
    expect(html).toContain("暂无数据");
  });
});
