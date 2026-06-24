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

  it("owns accessibility and semantic identity attributes", () => {
    const html = renderToStaticMarkup(
      <SleiIcon
        aria-hidden="false"
        aria-label="Should not leak"
        data-slei-icon="wrong"
        name="chat"
      />,
    );

    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("data-slei-icon=\"chat\"");
    expect(html).not.toContain("aria-label=\"Should not leak\"");
    expect(html).not.toContain("data-slei-icon=\"wrong\"");
  });
});

const decorativeIconTypeCheck = <SleiIcon name="chat" />;
const labelledIconTypeCheck = <SleiIcon decorative={false} label="Search" name="search" />;

// @ts-expect-error Non-decorative icons must provide an accessible label.
const missingLabelTypeCheck = <SleiIcon decorative={false} name="search" />;

void decorativeIconTypeCheck;
void labelledIconTypeCheck;
void missingLabelTypeCheck;
