// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RadioGroup, RadioGroupItem } from "./radio";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountRadioGroup(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(element);
  });

  return { host, root };
}

function cleanupRadioGroup(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

describe("RadioGroupItem", () => {
  it("generates unique fallback ids for repeated values across groups", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <>
        <RadioGroup value="email">
          <RadioGroupItem label="Email" value="email" />
        </RadioGroup>
        <RadioGroup value="email">
          <RadioGroupItem label="Email" value="email" />
        </RadioGroup>
      </>,
    );

    const groups = Array.from(host.querySelectorAll<HTMLElement>('[data-slot="radio-group"]'));
    const items = groups.map((group) => group.querySelector<HTMLElement>('[data-slot="radio-group-item"]'));
    const labels = groups.map((group) => group.querySelector<HTMLLabelElement>("label"));
    const ids = items.map((item) => item?.id);

    expect(groups).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const [index, item] of items.entries()) {
      expect(item?.id).toBeTruthy();
      expect(labels[index]?.htmlFor).toBe(item?.id);
      expect(groups[index]?.contains(labels[index] ?? null)).toBe(true);
    }
  });

  it("preserves explicit ids for label binding", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <RadioGroup value="manual">
        <RadioGroupItem id="manual-radio" label="Manual" value="manual" />
      </RadioGroup>,
    );

    expect(host.querySelector('[data-slot="radio-group-item"]')?.id).toBe("manual-radio");
    expect(host.querySelector("label")?.htmlFor).toBe("manual-radio");
  });

  it("uses the shadcn hollow selected radio styling", () => {
    const html = renderToStaticMarkup(
      <RadioGroup value="comfortable">
        <RadioGroupItem label="Default" value="default" />
        <RadioGroupItem label="Comfortable" value="comfortable" />
      </RadioGroup>,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const indicatorIconClasses = host.querySelector('[data-slot="radio-group-indicator"] svg')?.getAttribute("class")?.split(/\s+/) ?? [];

    expect(html).toContain('data-state="checked"');
    expect(html).toContain("data-[state=checked]:bg-primary");
    expect(html).toContain("data-[state=checked]:border-primary");
    expect(indicatorIconClasses).toContain("fill-primary-foreground");
    expect(indicatorIconClasses).toContain("text-primary-foreground");
    expect(indicatorIconClasses).not.toContain("fill-primary");
  });

  it("notifies callers when an item is selected from the rendered DOM", () => {
    const onValueChange = vi.fn();
    const { host, root } = mountRadioGroup(
      <RadioGroup defaultValue="default" onValueChange={onValueChange}>
        <RadioGroupItem label="Default" value="default" />
        <RadioGroupItem label="Comfortable" value="comfortable" />
      </RadioGroup>,
    );

    try {
      act(() => {
        host.querySelector<HTMLButtonElement>('[data-slot="radio-group-item"][value="comfortable"]')?.click();
      });

      expect(onValueChange).toHaveBeenCalledWith("comfortable");
    } finally {
      cleanupRadioGroup(root, host);
    }
  });
});
