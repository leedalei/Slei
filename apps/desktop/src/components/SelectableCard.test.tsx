/* @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SelectableCard, selectableCardFlatSelectedClassName, selectableCardSelectedClassName } from "./SelectableCard";

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
    expect(html).toContain("shadow-[0_2px_4px");
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

  it("uses the shared flat sidebar colors for compact channel and dm rows", () => {
    const idleHtml = renderToStaticMarkup(<SelectableCard selectedVariant="flat">Idle</SelectableCard>);
    const selectedHtml = renderToStaticMarkup(
      <SelectableCard selected selectedVariant="flat">
        Selected
      </SelectableCard>,
    );

    expect(idleHtml).toContain("hover:bg-[var(--workspace-sidebar-hover-bg)]");
    expect(selectedHtml).toContain("bg-[var(--workspace-sidebar-active-bg)]");
    expect(selectedHtml).toContain("shadow-none");
    expect(selectedHtml).toContain("backdrop-blur-none");
    expect(selectableCardFlatSelectedClassName).toContain("bg-[var(--workspace-sidebar-active-bg)]");
  });
});
