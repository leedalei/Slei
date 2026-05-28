export function sanitizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)]\((javascript:[^\s]+)\)/gi, (_match, label) => {
      return `[${label}](#blocked)`;
    })
    .replace(/\[([^\]]+)]\((file:[^\s]+)\)/gi, (_match, label) => {
      return `[${label}](#blocked)`;
    });
}
