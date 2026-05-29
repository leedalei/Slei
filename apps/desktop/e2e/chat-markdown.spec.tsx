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
});
