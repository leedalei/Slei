// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Input } from "./input";

describe("Input", () => {
  it("uses the default shadcn input primitive", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Input aria-label="普通输入" type="search" />);

    const input = host.querySelector<HTMLInputElement>('[data-slot="input"]');

    expect(input?.parentElement).toBe(host);
    expect(input?.getAttribute("type")).toBe("search");
    const classes = input?.className.split(/\s+/) ?? [];

    expect(classes).toContain("border-input");
    expect(classes).toContain("bg-background");
    expect(classes).toContain("dark:bg-input/30");
    expect(classes).toContain("shadow-xs");
    expect(classes).toContain("transition-[color,box-shadow]");
    expect(classes).toContain("focus-visible:border-ring");
    expect(classes).toContain("focus-visible:ring-[3px]");
    expect(classes).toContain("aria-invalid:border-destructive");
    expect(classes).not.toContain("bg-white/10");
    expect(classes).not.toContain("bg-transparent");
    expect(classes).not.toContain("backdrop-blur-xl");
    expect(classes).not.toContain("border-white/20");
    expect(classes).not.toContain("focus:bg-white/15");
  });
});
