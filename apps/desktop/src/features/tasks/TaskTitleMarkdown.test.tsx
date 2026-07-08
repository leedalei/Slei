import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TaskTitleMarkdown } from "./TaskTitleMarkdown";

describe("TaskTitleMarkdown", () => {
  it("renders task titles with compact markdown styling", () => {
    const html = renderToStaticMarkup(<TaskTitleMarkdown markdown={"**整理**任务\n\n- 合并代码"} />);

    expect(html).toContain("slei-task-title-markdown");
    expect(html).toContain("[&amp;_p]:my-0");
    expect(html).toContain("<strong>整理</strong>");
    expect(html).toContain("<li>合并代码</li>");
  });

  it("does not render code copy controls inside task titles", () => {
    const html = renderToStaticMarkup(<TaskTitleMarkdown markdown={"```ts\nconst ok = true;\n```"} />);

    expect(html).toContain("hljs-keyword");
    expect(html).toContain("ok = true;");
    expect(html).not.toContain('data-slot="markdown-code-copy"');
  });
});
