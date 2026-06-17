import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditableDetailField, SleiAppFrame } from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/test/fixtures";

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

    expect(html).toContain('aria-label="编辑显示名称"');
    expect(html).toContain("slei-editable-field");
    expect(html).toContain("slei-editable-field__label");
    expect(html).toContain("显示名称");
    expect(html).toContain("Coda");
    expect(html).not.toContain('aria-label="显示名称输入"');
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

    expect(html).toContain("<form");
    expect(html).toContain('aria-label="显示名称输入"');
    expect(html).toContain("保存");
    expect(html).toContain("取消");
  });

  it("renders saving and error state for edit mode", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        ariaLabel="编辑显示名称"
        error="保存失败"
        initialEditing
        label="显示名称"
        saving
        onSave={() => undefined}
        value="Lei"
      />,
    );

    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("aria-describedby=");
    expect(html).toContain('role="alert"');
    expect(html).toContain("保存失败");
    expect(html).toContain('data-editable-saving="true"');
  });

  it("renders allow-empty edit mode without validation alert", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        allowEmpty
        ariaLabel="编辑描述"
        initialEditing
        label="描述"
        onSave={() => undefined}
        value=""
      />,
    );

    expect(html).toContain("<input");
    expect(html).toContain('aria-label="描述输入"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("text-destructive");
  });

  it("keeps compact editable field compatibility hooks", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        ariaLabel="编辑运行时"
        label="Runtime"
        onSave={() => undefined}
        readClassName="slei-badge"
        sectionClassName="slei-config-editable"
        value="ClaudeCode"
      />,
    );

    expect(html).toContain("slei-config-editable");
    expect(html).toContain("slei-editable-field");
    expect(html).toContain("slei-editable-field__label");
    expect(html).toContain("slei-badge");
    expect(html).toContain("ClaudeCode");
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
    expect(membersHtml).toContain('aria-label="编辑运行时"');
    expect(membersHtml).toContain('aria-label="编辑 Model"');
    expect(membersHtml).toContain("显示名称");
    expect(membersHtml).toContain("描述");
    expect(membersHtml).not.toContain('aria-label="显示名称输入"');
    expect(computersHtml).toContain('aria-label="编辑设备名称"');
    expect(computersHtml).not.toContain('aria-label="设备名称输入"');
    expect(computersHtml).not.toContain('aria-label="编辑系统信息"');
  });
});
