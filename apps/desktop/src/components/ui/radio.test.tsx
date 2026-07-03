// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RadioGroup, RadioGroupItem } from "./radio";

describe("RadioGroupItem", () => {
  it("keeps labels composed outside of the default shadcn item", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <>
        <RadioGroup value="email">
          <div className="flex items-center gap-3">
            <RadioGroupItem id="email-one" value="email" />
            <label htmlFor="email-one">Email</label>
          </div>
        </RadioGroup>
        <RadioGroup value="email">
          <RadioGroupItem value="email" />
        </RadioGroup>
      </>,
    );

    const groups = Array.from(host.querySelectorAll<HTMLElement>('[data-slot="radio-group"]'));
    const items = groups.map((group) => group.querySelector<HTMLElement>('[data-slot="radio-group-item"]'));

    expect(groups).toHaveLength(2);
    expect(items[0]?.id).toBe("email-one");
    expect(groups[0]?.querySelector("label")?.htmlFor).toBe("email-one");
    expect(items[1]?.id).toBe("");
    expect(groups[1]?.querySelector("label")).toBeNull();
  });

  it("preserves explicit ids for label binding", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <RadioGroup value="manual">
        <div className="flex items-center gap-3">
          <RadioGroupItem id="manual-radio" value="manual" />
          <label htmlFor="manual-radio">Manual</label>
        </div>
      </RadioGroup>,
    );

    expect(host.querySelector('[data-slot="radio-group-item"]')?.id).toBe("manual-radio");
    expect(host.querySelector("label")?.htmlFor).toBe("manual-radio");
  });
});
