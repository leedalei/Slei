// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownMessage } from "../src/features/chat/MarkdownMessage";

const appCss = readFileSync(resolve(process.cwd(), "src/app/app.css"), "utf8");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | null = null;

afterEach(() => {
  act(() => {
    mountedRoot?.unmount();
  });
  mountedRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("chat Markdown rendering", () => {
  it("renders mentions with the default secondary badge styles and inline alignment", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage markdown="mysql有哪些好用的mcp? @theo" tone="primary" />,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const mention = host.querySelector<HTMLElement>(".slei-message-mention");
    const mentionRule = appCss.match(/\.slei-markdown-message \.slei-message-mention \{[^}]+\}/)?.[0];

    expect(mention?.tagName).toBe("SPAN");
    expect(mention?.dataset.slot).toBe("badge");
    expect(mention?.dataset.variant).toBe("secondary");
    expect(mention?.textContent).toBe("@theo");
    expect(mention?.classList).toContain("bg-secondary");
    expect(mention?.classList).toContain("text-secondary-foreground");
    expect(mention?.classList).toContain("border-transparent");
    expect(mention?.classList).toContain("align-middle");
    expect(mentionRule).toBeUndefined();
  });

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

  it("renders fenced code with a separate language and copy toolbar before code content", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        markdown={[
          "```sh",
          "pnpm --filter @slei/desktop exec vitest run src/app/SleiApp.test.ts",
          "```",
        ].join("\n")}
      />,
    );

    const headerIndex = html.indexOf('data-slot="markdown-code-header"');
    const languageIndex = html.indexOf('data-slot="markdown-code-language"');
    const copyButtonIndex = html.indexOf('aria-label="Copy code"');
    const preIndex = html.indexOf("<pre");
    const codeIndex = html.indexOf("pnpm --filter");

    expect(html).toContain('data-slot="markdown-code-block"');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(languageIndex).toBeGreaterThan(headerIndex);
    expect(copyButtonIndex).toBeGreaterThan(languageIndex);
    expect(preIndex).toBeGreaterThan(copyButtonIndex);
    expect(codeIndex).toBeGreaterThan(preIndex);
    expect(html).toContain(">sh</span>");
  });

  it("copies fenced code content from the code block toolbar", async () => {
    const clipboard = { writeText: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    vi.stubGlobal("navigator", { clipboard });
    const host = document.createElement("div");
    document.body.append(host);
    mountedRoot = createRoot(host);

    await act(async () => {
      mountedRoot?.render(
        <MarkdownMessage
          markdown={[
            "```ts",
            "const answer = 42;",
            "console.log(answer);",
            "```",
          ].join("\n")}
        />,
      );
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]')?.click();
    });

    expect(clipboard.writeText).toHaveBeenCalledWith("const answer = 42;\nconsole.log(answer);");
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

  it("distinguishes chat mentions from ordinary message text", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        markdown={"Please ask @coda and @lei-lee, but keep `@raw` and test@example.com untouched."}
      />,
    );

    expect(html).toContain("slei-message-mention");
    expect(html).toContain(">@coda</span>");
    expect(html).toContain(">@lei-lee</span>");
    expect(html).toContain("<code>@raw</code>");
    expect(html).toContain("test@example.com");
    expect(html).not.toContain(">@raw</span>");
    expect(html).not.toContain(">@example</span>");
  });
});
