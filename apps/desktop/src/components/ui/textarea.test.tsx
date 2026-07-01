// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("uses the default shadcn textarea primitive", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<Textarea aria-label="消息" />);

    const textarea = host.querySelector<HTMLTextAreaElement>('[data-slot="textarea"]');

    expect(textarea?.parentElement).toBe(host);
    expect(textarea?.className).toContain("border-input");
    expect(textarea?.className).toContain("bg-transparent");
    expect(textarea?.className).toContain("dark:bg-input/30");
    expect(textarea?.className).toContain("field-sizing-content");
    expect(textarea?.className).toContain("shadow-xs");
    expect(textarea?.className).toContain("transition-[color,box-shadow]");
    expect(textarea?.className).toContain("focus-visible:border-ring");
    expect(textarea?.className).toContain("focus-visible:ring-[3px]");
    expect(textarea?.className).toContain("aria-invalid:border-destructive");
    expect(textarea?.className).not.toContain("bg-white/10");
    expect(textarea?.className).not.toContain("backdrop-blur-xl");
    expect(textarea?.className).not.toContain("border-white/20");
    expect(textarea?.className).not.toContain("focus:bg-white/15");
  });
});
