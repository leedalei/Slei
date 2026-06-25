import { Children, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { sanitizeMarkdown } from "../../lib/markdown";

type MarkdownTone = "foreground" | "card";
type MarkdownForegroundStyle = CSSProperties & {
  "--markdown-foreground"?: string;
};

export function MarkdownMessage({ markdown, tone = "foreground" }: { markdown: string; tone?: MarkdownTone }) {
  return (
    <div
      className={cn(
        "slei-markdown-message mt-1 max-w-none text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/60 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc",
        tone === "card" ? "text-card-foreground" : "text-foreground",
      )}
      style={markdownForegroundStyle(tone)}
    >
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMarkdownUrl}>
        {sanitizeMarkdown(markdown)}
      </ReactMarkdown>
    </div>
  );
}

export function markdownForegroundStyle(tone: MarkdownTone): MarkdownForegroundStyle | undefined {
  if (tone === "card") return { "--markdown-foreground": "var(--card-foreground)" };
  return undefined;
}

function safeMarkdownUrl(url: string): string {
  return /^(https?:|mailto:|#blocked$)/i.test(url) ? url : "#blocked";
}

const markdownComponents: Components = {
  p({ children, node: _node, ...props }) {
    return <p {...props}>{renderMentions(children)}</p>;
  },
  li({ children, node: _node, ...props }) {
    return <li {...props}>{renderMentions(children)}</li>;
  },
  a({ children, href, node: _node, ...props }) {
    return (
      <a href={href} rel="noreferrer" target="_blank" {...props}>
        {children}
      </a>
    );
  },
  code({ children, className, node: _node, ...props }) {
    const code = String(children).replace(/\n$/, "");
    return (
      <code className={className} {...props}>
        {className ? highlightCode(code) : children}
      </code>
    );
  },
};

const mentionPattern = /(^|[^A-Za-z0-9_@.])(@[A-Za-z0-9][A-Za-z0-9_-]*)(?=$|[^A-Za-z0-9_-])/g;

function renderMentions(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child, index) =>
    typeof child === "string" ? renderMentionText(child, index) : child,
  );
}

function renderMentionText(text: string, childIndex: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  mentionPattern.lastIndex = 0;

  while ((match = mentionPattern.exec(text))) {
    const prefix = match[1] ?? "";
    const mention = match[2];
    const mentionStart = match.index + prefix.length;

    if (mentionStart > lastIndex) nodes.push(text.slice(lastIndex, mentionStart));
    nodes.push(
      <span className="slei-message-mention" key={`${childIndex}-${mentionStart}`}>
        {mention}
      </span>,
    );
    lastIndex = mentionStart + mention.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length > 0 ? nodes : [text];
}

function highlightCode(code: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /\b(const|let|var|function|return|if|else|await|async|import|export|from|type)\b|("[^"]*"|'[^']*'|`[^`]*`)|\b(\d+(?:\.\d+)?)\b/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(code))) {
    if (match.index > lastIndex) nodes.push(code.slice(lastIndex, match.index));
    if (match[1]) {
      nodes.push(<span className="hljs-keyword" key={match.index}>{match[1]}</span>);
    } else if (match[2]) {
      nodes.push(<span className="hljs-string" key={match.index}>{match[2]}</span>);
    } else if (match[3]) {
      nodes.push(<span className="hljs-number" key={match.index}>{match[3]}</span>);
    }
    lastIndex = tokenPattern.lastIndex;
  }
  if (lastIndex < code.length) nodes.push(code.slice(lastIndex));
  return nodes;
}
