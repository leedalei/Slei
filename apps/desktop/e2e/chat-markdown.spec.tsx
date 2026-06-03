import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "../src/features/chat/MarkdownMessage";

describe("chat Markdown rendering", () => {
  it("renders app-styled Markdown blocks and sanitizes unsafe links", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        markdown={[
          "Agent reply with `inline()` code.",
          "",
          "- first",
          "- second",
          "",
          "1. plan",
          "2. ship",
          "",
          "> keep context visible",
          "",
          "| Key | Value |",
          "| --- | --- |",
          "| OS | darwin arm64 |",
          "",
          "```ts",
          "const answer = 42;",
          "console.log(answer);",
          "```",
          "",
          "[blocked](javascript:alert(1)) [safe](https://example.com)",
          "<script>alert('xss')</script>",
        ].join("\n")}
      />,
    );

    expect(html).toContain("slei-markdown-message");
    expect(html).toContain("<code>inline()</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<table>");
    expect(html).toContain("<pre");
    expect(html).toContain("language-ts");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain('href="#blocked"');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("<script>");
  });

  it("renders common inline and gfm Markdown syntax from chat replies", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        markdown={[
          "## Reply summary",
          "",
          "**Bold point** with *emphasis*, ~~removed text~~, and [safe mail](mailto:test@example.com).",
          "",
          "- [x] handled",
          "- [ ] follow up",
          "",
          "https://example.com/docs",
          "",
          "---",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h2>Reply summary</h2>");
    expect(html).toContain("<strong>Bold point</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<del>removed text</del>");
    expect(html).toContain('href="mailto:test@example.com"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain("<hr");
  });
});
