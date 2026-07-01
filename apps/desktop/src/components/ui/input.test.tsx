// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Input } from "./input";

const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

describe("Input", () => {
  it("uses the EinUI glass input surface without a focus glow by default", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Input aria-label="普通输入" />);

    const input = host.querySelector<HTMLInputElement>('[data-slot="input"]');
    const glow = input?.parentElement?.querySelector<HTMLElement>('[aria-hidden="true"]');

    expect(input?.parentElement?.className).toContain("group relative w-full");
    expect(glow).toBeNull();
    expect(input?.className).toContain("bg-white/10");
    expect(input?.className).toContain("backdrop-blur-xl");
    expect(input?.className).toContain("border-white/20");
    expect(input?.className).toContain("text-foreground");
    expect(input?.className).toContain("placeholder:text-muted-foreground/70");
    expect(input?.className).toContain("shadow-[0_2px_4px_rgba(0,0,0,0.10)]");
    expect(input?.className).toContain("transition-all");
    expect(input?.className).toContain("duration-300");
    expect(input?.className).toContain("focus:border-white/40");
    expect(input?.className).toContain("focus:bg-white/15");
    expect(input?.className).not.toContain("border-input");
    expect(input?.className).not.toContain("bg-input");
  });

  it("can opt into the focus glow for local overrides", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Input aria-label="搜索" glowEffect />);

    const input = host.querySelector<HTMLInputElement>('[data-slot="input"]');
    const glow = input?.parentElement?.querySelector<HTMLElement>('[aria-hidden="true"]');

    expect(glow?.className).toContain("bg-linear-to-r");
    expect(glow?.className).toContain("group-focus-within:from-[var(--input-focus-glow-from)]");
  });

  it("defines a lighter light-mode focus glow for inputs", () => {
    expect(appCss).toContain("--input-focus-glow-from: rgb(6 182 212 / 0.12);");
    expect(appCss).toContain("--input-focus-glow-via: rgb(59 130 246 / 0.12);");
    expect(appCss).toContain("--input-focus-glow-to: rgb(168 85 247 / 0.12);");

    const lightTokens = appCss.slice(appCss.indexOf(".light {"), appCss.indexOf("@layer utilities"));

    expect(lightTokens).toContain("--input-focus-glow-from: rgb(6 182 212 / 0.08);");
    expect(lightTokens).toContain("--input-focus-glow-via: rgb(59 130 246 / 0.08);");
    expect(lightTokens).toContain("--input-focus-glow-to: rgb(168 85 247 / 0.08);");
  });

});
