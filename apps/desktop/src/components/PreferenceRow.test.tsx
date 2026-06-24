import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PreferenceRow } from "./PreferenceRow";

describe("PreferenceRow", () => {
  it("renders label, description, and control content", () => {
    const html = renderToStaticMarkup(
      <PreferenceRow
        control={<button type="button">开启</button>}
        description="同步桌面通知和提醒"
        label="通知"
      />,
    );

    expect(html).toContain("通知");
    expect(html).toContain("同步桌面通知和提醒");
    expect(html).toContain("开启");
  });
});
