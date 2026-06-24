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

  it("uses a soft panel when the framed shell is requested", () => {
    const html = renderToStaticMarkup(<Empty framed title="暂无数据" />);

    expect(html).toContain("data-slei-panel");
    expect(html).toContain('data-variant="surface"');
    expect(html).toContain("暂无数据");
  });
});
