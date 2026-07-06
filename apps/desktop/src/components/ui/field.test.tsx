// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "./field";
import { Input } from "./input";

describe("Field primitives", () => {
  it("render shadcn-style field slots with roomy vertical rhythm", () => {
    const html = renderToStaticMarkup(
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">名称</FieldLabel>
          <Input id="name" />
          <FieldDescription>用于列表和对话中展示。</FieldDescription>
        </Field>
      </FieldGroup>,
    );

    expect(html).toContain('data-slot="field-group"');
    expect(html).toContain("flex w-full flex-col gap-7");
    expect(html).toContain('data-slot="field"');
    expect(html).toContain('role="group"');
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain("group/field flex w-full gap-3");
    expect(html).toContain('data-slot="field-label"');
    expect(html).toContain("flex w-fit gap-2");
    expect(html).toContain("leading-snug");
    expect(html).toContain('data-slot="field-description"');
    expect(html).toContain("leading-normal");
    expect(html).toContain("font-normal");
  });

  it("supports official shadcn field content, title, separator, and horizontal orientation", () => {
    const html = renderToStaticMarkup(
      <FieldGroup>
        <Field orientation="horizontal">
          <Input id="newsletter" />
          <FieldContent>
            <FieldTitle>订阅通知</FieldTitle>
            <FieldDescription>收到异步任务完成提醒。</FieldDescription>
          </FieldContent>
        </Field>
        <FieldSeparator>更多</FieldSeparator>
      </FieldGroup>,
    );

    expect(html).toContain('data-orientation="horizontal"');
    expect(html).toContain("flex-row items-center");
    expect(html).toContain('data-slot="field-content"');
    expect(html).toContain("flex flex-1 flex-col gap-1.5");
    expect(html).toContain('data-slot="field-label"');
    expect(html).toContain("text-sm leading-snug font-medium");
    expect(html).toContain('data-slot="field-separator"');
    expect(html).toContain('data-slot="separator"');
    expect(html).toContain('data-slot="field-separator-content"');
  });

  it("supports fieldset legends and accessible field errors", () => {
    const html = renderToStaticMarkup(
      <FieldSet>
        <FieldLegend>选择 Agent</FieldLegend>
        <FieldError id="name-error">名称不能为空</FieldError>
      </FieldSet>,
    );

    expect(html).toContain('data-slot="field-set"');
    expect(html).toContain('data-slot="field-legend"');
    expect(html).toContain('data-slot="field-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("名称不能为空");
  });

  it("omits empty error output", () => {
    const html = renderToStaticMarkup(<FieldError />);

    expect(html).toBe("");
  });
});
