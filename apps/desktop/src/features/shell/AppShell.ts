import { renderPanelLayout } from "./PanelLayout";
import { type NavItem, renderPrimaryNav } from "./PrimaryNav";

export function renderFeatureShell(input: {
  active: NavItem;
  locale: "zh-CN" | "en-US";
  content: string;
  sidebar?: string;
}): string {
  return renderPanelLayout({
    nav: renderPrimaryNav(input.active, input.locale),
    sidebar: input.sidebar,
    content: input.content,
  });
}
