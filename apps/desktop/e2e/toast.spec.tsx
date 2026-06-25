import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Toast, TOAST_VISIBLE_MS } from "../src/components";
import { TooltipProvider } from "../src/components/ui/tooltip";

function renderToast(input: Parameters<typeof Toast>[0]) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <Toast {...input} />
    </TooltipProvider>,
  );
}

describe("shared toast feedback", () => {
  it("keeps toast feedback visible for 2.5 seconds", () => {
    expect(TOAST_VISIBLE_MS).toBe(2500);
  });

  it("renders polite live-region feedback", () => {
    const html = renderToast({ text: "复制成功" });

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain('type="button"');
    expect(html).not.toContain('data-slot="notification-action"');
    expect(html).not.toContain('aria-label="复制通知内容"');
    expect(html).toContain("fixed");
    expect(html).toContain("top-4");
    expect(html).toContain("left-1/2");
    expect(html).toContain("-translate-x-1/2");
    expect(html).not.toContain("bottom-4");
    expect(html).not.toContain("right-4");
    expect(html).toContain('data-slot="notification-surface"');
    expect(html).toContain("bg-white/70");
    expect(html).toContain("backdrop-blur-2xl");
    expect(html).toContain("backdrop-saturate-150");
    expect(html).toContain('data-slot="notification-content"');
    expect(html).toContain("items-center");
    expect(html).toContain("px-3.5");
    expect(html).toContain("py-2.5");
    expect(html).toContain('data-slot="notification-icon-container"');
    expect(html).toContain("h-7");
    expect(html).toContain("w-7");
    expect(html).toContain('data-slot="notification-icon"');
    expect(html).toContain("h-4");
    expect(html).toContain("w-4");
    expect(html).toContain("复制成功");
  });

  it("renders typed toast variants above dialogs", () => {
    const errorHtml = renderToast({ text: "频道名称不能为空", type: "error" });
    const successHtml = renderToast({ text: "频道已创建", type: "success" });
    const infoHtml = renderToast({ text: "成员正在加入", type: "info" });
    const warnHtml = renderToast({ text: "后续设置失败", type: "warn" });

    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('aria-live="assertive"');
    expect(errorHtml).toContain("z-[80]");
    expect(errorHtml).toContain('data-type="error"');
    expect(errorHtml).toContain("border-red-400/30");
    expect(successHtml).toContain('data-type="success"');
    expect(successHtml).toContain("border-emerald-400/30");
    expect(infoHtml).toContain('data-type="info"');
    expect(infoHtml).toContain("border-cyan-400/30");
    expect(warnHtml).toContain('data-type="warning"');
    expect(warnHtml).toContain("border-amber-400/30");
  });

  it("does not render a toast copy action", () => {
    const html = renderToast({ text: "发送失败：daemon error", type: "error" });

    expect(html).not.toContain('data-slot="notification-action"');
    expect(html).not.toContain('aria-label="复制通知内容"');
  });

  it("does not render an empty status region", () => {
    const html = renderToStaticMarkup(<Toast text="" />);

    expect(html).toBe("");
  });
});
