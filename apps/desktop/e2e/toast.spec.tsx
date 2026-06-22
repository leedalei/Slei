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
    expect(html).toContain('data-slot="tooltip-trigger"');
    expect(html).toContain("fixed");
    expect(html).toContain("top-4");
    expect(html).toContain("left-1/2");
    expect(html).toContain("-translate-x-1/2");
    expect(html).not.toContain("bottom-4");
    expect(html).not.toContain("right-4");
    expect(html).toContain("bg-popover");
    expect(html).toContain("复制成功");
  });

  it("renders typed toast variants above dialogs", () => {
    const errorHtml = renderToStaticMarkup(<Toast text="频道名称不能为空" type="error" />);
    const successHtml = renderToStaticMarkup(<Toast text="频道已创建" type="success" />);
    const infoHtml = renderToStaticMarkup(<Toast text="成员正在加入" type="info" />);
    const warnHtml = renderToStaticMarkup(<Toast text="后续设置失败" type="warn" />);

    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('aria-live="assertive"');
    expect(errorHtml).toContain("z-[80]");
    expect(errorHtml).toContain("border-destructive");
    expect(successHtml).toContain("border-emerald-500");
    expect(infoHtml).toContain("border-sky-500");
    expect(warnHtml).toContain("border-amber-500");
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
