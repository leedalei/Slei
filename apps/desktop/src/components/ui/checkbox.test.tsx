// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountCheckbox(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(element);
  });

  return { host, root };
}

function cleanupCheckbox(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

describe("Checkbox", () => {
  it("uses EinUI glass checkbox defaults", () => {
    const html = renderToStaticMarkup(<Checkbox aria-label="选择 Agent" />);

    expect(html).toContain('data-slot="checkbox"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain("size-5");
    expect(html).toContain("rounded-[4px]");
    expect(html).toContain("border-white/20");
    expect(html).toContain("bg-white/10");
    expect(html).toContain("backdrop-blur-xl");
    expect(html).toContain("shadow-[0_2px_4px_rgba(0,0,0,0.16)]");
    expect(html).not.toContain("shadow-[0_4px_16px");
    expect(html).toContain("hover:bg-white/15");
    expect(html).toContain("focus-visible:border-white/40");
    expect(html).not.toContain("focus-visible:ring-cyan-400/30");
    expect(html).not.toContain("bg-transparent");
    expect(html).not.toContain("border-input");
    expect(html).not.toContain("dark:bg-input/30");
  });

  it("keeps checked state styling aligned with the EinUI switch gradient", () => {
    const html = renderToStaticMarkup(<Checkbox aria-label="选择 Agent" checked />);

    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-state="checked"');
    expect(html).toContain("data-[state=checked]:border-cyan-400/40");
    expect(html).toContain("data-[state=checked]:bg-linear-to-r");
    expect(html).toContain("data-[state=checked]:from-cyan-500/60");
    expect(html).toContain("data-[state=checked]:to-blue-500/60");
    expect(html).not.toContain("data-[state=checked]:bg-primary");
  });

  it("notifies callers when toggled from the rendered DOM", () => {
    const onCheckedChange = vi.fn();
    const { host, root } = mountCheckbox(<Checkbox aria-label="选择 Agent" onCheckedChange={onCheckedChange} />);

    try {
      act(() => {
        host.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click();
      });

      expect(onCheckedChange).toHaveBeenCalledWith(true);
    } finally {
      cleanupCheckbox(root, host);
    }
  });
});
