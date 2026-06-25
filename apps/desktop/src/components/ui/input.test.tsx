// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Input } from "./input";

describe("Input", () => {
  it("uses the EinUI glass input surface and focus glow by default", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Input aria-label="普通输入" />);

    const input = host.querySelector<HTMLInputElement>('[data-slot="input"]');
    const glow = input?.parentElement?.querySelector<HTMLElement>('[aria-hidden="true"]');

    expect(input?.parentElement?.className).toContain("group relative w-full");
    expect(glow?.className).toContain("bg-linear-to-r");
    expect(glow?.className).toContain("from-cyan-500/0");
    expect(glow?.className).toContain("group-focus-within:from-cyan-500/30");
    expect(glow?.className).toContain("group-focus-within:opacity-70");
    expect(input?.className).toContain("bg-white/10");
    expect(input?.className).toContain("backdrop-blur-xl");
    expect(input?.className).toContain("border-white/20");
    expect(input?.className).toContain("text-foreground");
    expect(input?.className).toContain("placeholder:text-muted-foreground/70");
    expect(input?.className).toContain("shadow-[0_4px_16px_rgba(0,0,0,0.2)]");
    expect(input?.className).toContain("transition-all");
    expect(input?.className).toContain("duration-300");
    expect(input?.className).toContain("focus:border-white/40");
    expect(input?.className).toContain("focus:bg-white/15");
    expect(input?.className).not.toContain("border-input");
    expect(input?.className).not.toContain("bg-input");
  });

  it("can disable the focus glow for searchbar-style local overrides", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Input aria-label="搜索" glowEffect={false} />);

    const input = host.querySelector<HTMLInputElement>('[data-slot="input"]');

    expect(input?.parentElement?.querySelector('[aria-hidden="true"]')).toBeNull();
  });

});
