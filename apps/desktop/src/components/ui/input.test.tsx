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
    expect(input?.className).toContain("border-input");
    expect(input?.className).toContain("bg-transparent");
    expect(input?.className).toContain("dark:bg-input/30");
    expect(input?.className).toContain("shadow-xs");
    expect(input?.className).toContain("transition-[color,box-shadow]");
    expect(input?.className).toContain("focus-visible:border-ring");
    expect(input?.className).toContain("focus-visible:ring-[3px]");
    expect(input?.className).toContain("aria-invalid:border-destructive");
    expect(input?.className).not.toContain("bg-white/10");
    expect(input?.className).not.toContain("backdrop-blur-xl");
    expect(input?.className).not.toContain("border-white/20");
    expect(input?.className).not.toContain("focus:bg-white/15");
  });
});
