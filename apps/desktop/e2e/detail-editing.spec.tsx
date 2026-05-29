import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditableDetailField, SleiAppFrame } from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/app/fixtures";

const data = createSleiFixtures({ members: createDemoMembers() });
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: data.nodes,
};

describe("detail page editing pattern", () => {
  it("renders detail fields as read-only until the label edit icon is used", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        ariaLabel="编辑显示名称"
        label="显示名称"
        onSave={() => undefined}
        value="Coda"
      />,
    );

    expect(html).toContain("slei-editable-field");
    expect(html).toContain("显示名称");
    expect(html).toContain("Coda");
    expect(html).toContain('aria-label="编辑显示名称"');
    expect(html).not.toContain("slei-editable-field__editor");
    expect(html).not.toContain("保存");
    expect(html).not.toContain("取消");
  });

  it("renders edit mode as an input with save and cancel actions", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        ariaLabel="编辑显示名称"
        initialEditing
        label="显示名称"
        onSave={() => undefined}
        value="Coda"
      />,
    );

    expect(html).toContain("slei-editable-field__editor");
    expect(html).toContain('aria-label="显示名称输入"');
    expect(html).toContain("保存");
    expect(html).toContain("取消");
  });

  it("uses the same edit trigger pattern on member and computer details", () => {
    const membersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="members" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    const computersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(membersHtml).toContain('aria-label="编辑显示名称"');
    expect(membersHtml).toContain('aria-label="编辑描述"');
    expect(membersHtml).not.toContain("slei-editable-field__editor");
    expect(computersHtml).toContain('aria-label="编辑设备名称"');
    expect(computersHtml).not.toContain("slei-editable-field__editor");
    expect(computersHtml).not.toContain('aria-label="编辑系统信息"');
  });
});
