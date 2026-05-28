export function renderPanelLayout(input: {
  nav: string;
  sidebar?: string;
  content: string;
}): string {
  return [input.nav, input.sidebar ?? "", input.content].filter(Boolean).join("\n");
}
