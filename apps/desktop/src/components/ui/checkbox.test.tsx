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
  it("uses default shadcn checkbox defaults", () => {
    const html = renderToStaticMarkup(<Checkbox aria-label="选择 Agent" />);

    expect(html).toContain('data-slot="checkbox"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain("size-4");
    expect(html).toContain("rounded-[4px]");
    expect(html).toContain("border-input");
    expect(html).toContain("dark:bg-input/30");
    expect(html).toContain("shadow-xs");
    expect(html).toContain("focus-visible:border-ring");
    expect(html).toContain("focus-visible:ring-[3px]");
    expect(html).toContain("aria-invalid:border-destructive");
    expect(html).not.toContain("bg-transparent");
    expect(html).not.toContain("border-white/20");
    expect(html).not.toContain("bg-white/10");
    expect(html).not.toContain("backdrop-blur-xl");
    expect(html).not.toContain("hover:bg-white/15");
  });

  it("uses default shadcn checked state styling", () => {
    const html = renderToStaticMarkup(<Checkbox aria-label="选择 Agent" checked />);

    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-state="checked"');
    expect(html).toContain("data-[state=checked]:bg-primary");
    expect(html).toContain("data-[state=checked]:border-primary");
    expect(html).toContain("data-[state=checked]:text-primary-foreground");
    expect(html).not.toContain("data-[state=checked]:bg-linear-to-r");
    expect(html).not.toContain("data-[state=checked]:from-cyan-500/60");
    expect(html).not.toContain("data-[state=checked]:to-blue-500/60");
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
