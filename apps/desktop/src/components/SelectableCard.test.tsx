/* @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SelectableCard, selectableCardSelectedClassName } from "./SelectableCard";

describe("SelectableCard", () => {
  it("centralizes the sidebar selected-card visual treatment", () => {
    const html = renderToStaticMarkup(
      <SelectableCard selected>
        <span>Selected</span>
      </SelectableCard>,
    );

    expect(html).toContain('data-slot="selectable-card"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("bg-white/20");
    expect(html).toContain("backdrop-blur-xl");
    expect(html).toContain("shadow-[0_10px_28px");
    expect(selectableCardSelectedClassName).toContain("bg-white/20");
  });

  it("supports using an existing card or button element as the root", () => {
    const html = renderToStaticMarkup(
      <SelectableCard asChild selected>
        <button type="button">Open</button>
      </SelectableCard>,
    );

    expect(html).toContain("<button");
    expect(html).toContain('data-slot="selectable-card"');
    expect(html).toContain("Open");
  });
});
