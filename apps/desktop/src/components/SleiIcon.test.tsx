import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiIcon } from "./SleiIcon";

describe("SleiIcon", () => {
  it("renders decorative product icons as hidden svg elements", () => {
    const html = renderToStaticMarkup(<SleiIcon name="chat" />);

    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("data-slei-icon=\"chat\"");
    expect(html).toContain("<svg");
  });

  it("allows labelled icons when the icon is the accessible content", () => {
    const html = renderToStaticMarkup(<SleiIcon decorative={false} label="搜索" name="search" />);

    expect(html).toContain("aria-label=\"搜索\"");
    expect(html).not.toContain("aria-hidden=\"true\"");
  });
});
