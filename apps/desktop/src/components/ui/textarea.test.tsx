// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("uses the EinUI glass textarea surface and focus glow by default", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Textarea aria-label="消息" />);

    const textarea = host.querySelector<HTMLTextAreaElement>('[data-slot="textarea"]');
    const wrapper = textarea?.parentElement;
    const glow = wrapper?.querySelector<HTMLElement>('[aria-hidden="true"]');

    expect(wrapper?.className).toContain("group relative w-full");
    expect(glow?.className).toContain("bg-linear-to-r");
    expect(glow?.className).toContain("from-cyan-500/0");
    expect(glow?.className).toContain("group-focus-within:from-cyan-500/30");
    expect(textarea?.className).toContain("bg-white/10");
    expect(textarea?.className).toContain("backdrop-blur-xl");
    expect(textarea?.className).toContain("border-white/20");
    expect(textarea?.className).toContain("text-foreground");
    expect(textarea?.className).toContain("placeholder:text-muted-foreground/70");
    expect(textarea?.className).toContain("shadow-[0_4px_16px_rgba(0,0,0,0.2)]");
    expect(textarea?.className).toContain("transition-all");
    expect(textarea?.className).toContain("duration-300");
    expect(textarea?.className).toContain("focus:border-white/40");
    expect(textarea?.className).toContain("focus:bg-white/15");
    expect(textarea?.className).toContain("focus:ring-cyan-400/30");
    expect(textarea?.className).not.toContain("border-input");
    expect(textarea?.className).not.toContain("bg-input");
  });

  it("can disable the focus glow for local overrides", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Textarea aria-label="消息" glowEffect={false} />);

    const textarea = host.querySelector<HTMLTextAreaElement>('[data-slot="textarea"]');

    expect(textarea?.parentElement?.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
