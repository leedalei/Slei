import { createDesktopMessages } from "../../i18n";

export type NavItem = "chat" | "tasks" | "members" | "computers" | "settings";

export function renderPrimaryNav(active: NavItem, locale: "zh-CN" | "en-US"): string {
  const labels = createDesktopMessages(locale).shell.nav;

  return (Object.keys(labels) as NavItem[])
    .map((item) => `${item === active ? "[active]" : ""}${labels[item]}`)
    .join(" ");
}
