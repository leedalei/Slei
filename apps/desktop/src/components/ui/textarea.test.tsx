// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Textarea } from "./textarea";

const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

describe("Textarea", () => {
  it("uses the EinUI glass textarea surface without a focus glow by default", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Textarea aria-label="消息" />);

    const textarea = host.querySelector<HTMLTextAreaElement>('[data-slot="textarea"]');
    const wrapper = textarea?.parentElement;
    const glow = wrapper?.querySelector<HTMLElement>('[aria-hidden="true"]');

    expect(wrapper?.className).toContain("group relative w-full");
    expect(glow).toBeNull();
    expect(textarea?.className).toContain("bg-white/10");
    expect(textarea?.className).toContain("backdrop-blur-xl");
    expect(textarea?.className).toContain("border-white/20");
    expect(textarea?.className).toContain("text-foreground");
    expect(textarea?.className).toContain("placeholder:text-muted-foreground/70");
    expect(textarea?.className).toContain("shadow-[0_2px_4px_rgba(0,0,0,0.10)]");
    expect(textarea?.className).toContain("transition-all");
    expect(textarea?.className).toContain("duration-300");
    expect(textarea?.className).toContain("focus:border-white/40");
    expect(textarea?.className).toContain("focus:bg-white/15");
    expect(textarea?.className).not.toContain("focus:ring-cyan-400/30");
    expect(textarea?.className).not.toContain("border-input");
    expect(textarea?.className).not.toContain("bg-input");
  });

  it("can opt into the focus glow for local overrides", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Textarea aria-label="消息" glowEffect />);

    const textarea = host.querySelector<HTMLTextAreaElement>('[data-slot="textarea"]');
    const glow = textarea?.parentElement?.querySelector<HTMLElement>('[aria-hidden="true"]');

    expect(glow?.className).toContain("bg-linear-to-r");
    expect(glow?.className).toContain("group-focus-within:from-[var(--input-focus-glow-from)]");
  });

  it("uses the shared light-mode focus glow tokens", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Textarea aria-label="消息" glowEffect />);
    const textarea = host.querySelector<HTMLTextAreaElement>('[data-slot="textarea"]');
    const glow = textarea?.parentElement?.querySelector<HTMLElement>('[aria-hidden="true"]');
    const lightTokens = appCss.slice(appCss.indexOf(".light {"), appCss.indexOf("@layer utilities"));

    expect(textarea?.className).toContain("bg-white/10");
    expect(glow?.className).toContain("group-focus-within:from-[var(--input-focus-glow-from)]");
    expect(lightTokens).toContain("--input-focus-glow-from: rgb(6 182 212 / 0.08);");
    expect(lightTokens).toContain("--input-focus-glow-via: rgb(59 130 246 / 0.08);");
    expect(lightTokens).toContain("--input-focus-glow-to: rgb(168 85 247 / 0.08);");
  });
});
