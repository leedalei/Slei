import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sleiIcons } from "./icons";
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

  it("renders the optional icon without the old muted surface treatment", () => {
    const html = renderToStaticMarkup(<PageHeader icon={sleiIcons.settings} title="设置" />);

    expect(html).toContain("data-slei-page-header-icon");
    expect(html).not.toContain("bg-muted/40");
  });
});
