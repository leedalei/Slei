import { createDesktopMessages } from "../../i18n";
import type { AgentView } from "./types";

export function renderPermissionsPanel(agent: AgentView, locale: "zh-CN" | "en-US"): string {
  const permission = agent.workspaceOverride ?? agent.permission;
  const messages = createDesktopMessages(locale).members;
  const separator = locale === "zh-CN" ? "：" : ": ";
  return `${messages.channelPermission}${separator}${messages.permissionLabels[agent.permission]} ${messages.workspacePermission}${separator}${messages.permissionLabels[permission]}`;
}
