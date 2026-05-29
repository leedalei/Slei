import { createDesktopMessages } from "../../i18n";

export function renderAgentForm(locale: "zh-CN" | "en-US"): string {
  return createDesktopMessages(locale).agentCreate.addAgent;
}
