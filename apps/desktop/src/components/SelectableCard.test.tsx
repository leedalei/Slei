/* @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SelectableCard,
  selectableCardCheckboxFieldSelectedClassName,
  selectableCardFlatSelectedClassName,
  selectableCardSelectedClassName,
} from "./SelectableCard";

describe("SelectableCard", () => {
  it("centralizes the sidebar selected-card visual treatment", () => {
    const html = renderToStaticMarkup(
      <SelectableCard selected>
        <span>Selected</span>
      </SelectableCard>,
    );

    expect(html).toContain('data-slot="selectable-card"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-accent-foreground");
    expect(html).toContain("shadow-none");
    expect(html).not.toContain("bg-white/20");
    expect(html).not.toContain("backdrop-blur-xl");
    expect(html).not.toContain("bg-linear");
    expect(selectableCardSelectedClassName).toContain("bg-accent");
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

  it("supports shadcn checkbox field styling for selectable form rows", () => {
    const idleHtml = renderToStaticMarkup(<SelectableCard selectedVariant="checkboxField">Idle</SelectableCard>);
    const selectedHtml = renderToStaticMarkup(
      <SelectableCard selected selectedVariant="checkboxField">
        Selected
      </SelectableCard>,
    );

    expect(idleHtml).toContain("hover:border-input");
    expect(idleHtml).toContain("hover:bg-muted/30");
    expect(selectedHtml).toContain("border-input");
    expect(selectedHtml).toContain("bg-muted/30");
    expect(selectedHtml).toContain("text-foreground");
    expect(selectedHtml).toContain("shadow-none");
    expect(selectedHtml).not.toContain("bg-accent");
    expect(selectableCardCheckboxFieldSelectedClassName).toContain("bg-muted/30");
  });
});
