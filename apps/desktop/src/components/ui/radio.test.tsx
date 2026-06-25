// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RadioGroup, RadioGroupItem } from "./radio";

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
});
