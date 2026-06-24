import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the page title with a stable header attribute and action slot", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        actions={<button type="button">新建</button>}
        title="频道设置"
      />,
    );

    expect(html).toContain("data-slei-page-header");
    expect(html).toContain("频道设置");
    expect(html).toContain("新建");
  });
});
