import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Toast, TOAST_VISIBLE_MS, copyToastContent } from "../src/components";

describe("shared toast feedback", () => {
  it("keeps toast feedback visible for 2.5 seconds", () => {
    expect(TOAST_VISIBLE_MS).toBe(2500);
  });

  it("renders polite live-region feedback", () => {
    const html = renderToStaticMarkup(<Toast text="复制成功" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('title="点击复制"');
    expect(html).toContain("fixed");
    expect(html).toContain("top-4");
    expect(html).toContain("left-1/2");
    expect(html).toContain("-translate-x-1/2");
    expect(html).not.toContain("bottom-4");
    expect(html).not.toContain("right-4");
    expect(html).toContain("bg-popover");
    expect(html).toContain("复制成功");
  });

  it("copies toast content when requested", async () => {
    const writes: string[] = [];

    const copied = await copyToastContent("发送失败：daemon error", {
      clipboard: {
        writeText: async (text: string) => {
          writes.push(text);
        },
      },
    });

    expect(copied).toBe(true);
    expect(writes).toEqual(["发送失败：daemon error"]);
  });

  it("does not render an empty status region", () => {
    const html = renderToStaticMarkup(<Toast text="" />);

    expect(html).toBe("");
  });
});
