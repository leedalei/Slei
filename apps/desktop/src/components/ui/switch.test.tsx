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
  it("preserves the shared switch DOM contract", () => {
    const html = renderToStaticMarkup(<Switch aria-label="通知" checked />);

    expect(html).toContain('data-slot="switch"');
    expect(html).toContain('data-slot="switch-thumb"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-state="checked"');
  });

  it("passes disabled state through to the rendered switch", () => {
    const html = renderToStaticMarkup(<Switch aria-label="紧凑通知" disabled />);

    expect(html).toContain('data-slot="switch"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="紧凑通知"');
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
