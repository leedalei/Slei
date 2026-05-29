import type { ReactNode } from "react";

import { sanitizeMarkdown } from "../../lib/markdown";

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; language?: string; code: string };

export function MarkdownMessage({ markdown }: { markdown: string }) {
  return (
    <div className="slei-markdown-message">
      {parseMarkdownBlocks(sanitizeMarkdown(markdown)).map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", language: fence[1] || undefined, code: code.join("\n") });
      index += index < lines.length ? 1 : 0;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quotes: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quotes.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quotes.join("\n") });
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = parseTableCells(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        rows.push(parseTableCells(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !startsSpecialBlock(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function startsSpecialBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return /^```/.test(line) || /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line) || /^\s*>\s?/.test(line) || isTableStart(lines, index);
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(
    lines[index]?.includes("|") &&
      lines[index + 1] &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]),
  );
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderBlock(block: MarkdownBlock, key: number) {
  if (block.type === "paragraph") return <p key={key}>{renderInline(block.text)}</p>;
  if (block.type === "ul") return <ul key={key}>{block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ul>;
  if (block.type === "ol") return <ol key={key}>{block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ol>;
  if (block.type === "blockquote") return <blockquote key={key}>{renderInline(block.text)}</blockquote>;
  if (block.type === "table") {
    return (
      <table key={key}>
        <thead>
          <tr>{block.headers.map((header) => <th key={header}>{renderInline(header)}</th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <pre className={block.language ? `language-${block.language}` : undefined} key={key}>
      <code className={block.language ? `language-${block.language}` : undefined}>{highlightCode(block.code)}</code>
    </pre>
  );
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|\[([^\]]+)]\(([^)\s]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1]) {
      nodes.push(<code key={`code-${match.index}`}>{match[1].slice(1, -1)}</code>);
    } else {
      nodes.push(
        <a href={safeHref(match[3])} key={`link-${match.index}`} rel="noreferrer" target="_blank">
          {match[2]}
        </a>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function safeHref(href: string): string {
  return /^(https?:|mailto:|#blocked$)/i.test(href) ? href : "#blocked";
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
