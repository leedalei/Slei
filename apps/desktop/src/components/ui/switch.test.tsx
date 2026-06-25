// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "./switch";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountSwitch(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(element);
  });

  return { host, root };
}

function cleanupSwitch(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

describe("Switch", () => {
  it("uses Ein UI glass-switch styling while preserving the shared switch contract", () => {
    const html = renderToStaticMarkup(<Switch aria-label="通知" checked />);

    expect(html).toContain('data-slot="switch"');
    expect(html).toContain('data-slot="switch-thumb"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("bg-white/10");
    expect(html).toContain("backdrop-blur-xl");
    expect(html).toContain("border-white/20");
    expect(html).toContain("data-[state=checked]:from-cyan-500/60");
    expect(html).toContain("data-[state=checked]:to-blue-500/60");
    expect(html).toContain("data-[state=checked]:shadow-[0_0_12px_rgba(6,182,212,0.4)]");
    expect(html).toContain("data-[state=checked]:translate-x-5");
  });

  it("keeps the registry switch dimensions stable for settings rows", () => {
    const html = renderToStaticMarkup(<Switch aria-label="紧凑通知" />);

    expect(html).toContain("h-6");
    expect(html).toContain("w-11");
    expect(html).toContain("h-5");
    expect(html).toContain("w-5");
    expect(html).toContain("data-[state=checked]:translate-x-5");
  });

  it("notifies callers when toggled from the rendered DOM", () => {
    const onCheckedChange = vi.fn();
    const { host, root } = mountSwitch(<Switch aria-label="通知" onCheckedChange={onCheckedChange} />);

    try {
      act(() => {
        host.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
      });

      expect(onCheckedChange).toHaveBeenCalledWith(true);
    } finally {
      cleanupSwitch(root, host);
    }
  });
});
