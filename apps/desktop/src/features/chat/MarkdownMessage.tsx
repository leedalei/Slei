import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { sanitizeMarkdown } from "../../lib/markdown";

export function MarkdownMessage({ markdown }: { markdown: string }) {
  return (
    <div className="slei-markdown-message">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMarkdownUrl}>
        {sanitizeMarkdown(markdown)}
      </ReactMarkdown>
    </div>
  );
}

function safeMarkdownUrl(url: string): string {
  return /^(https?:|mailto:|#blocked$)/i.test(url) ? url : "#blocked";
}

const markdownComponents: Components = {
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
