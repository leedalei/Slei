import { createDesktopMessages } from "../../i18n";
import { renderPermissionsPanel } from "./PermissionsPanel";
import type { AgentView } from "./types";

export function renderAgentProfile(agent: AgentView, locale: "zh-CN" | "en-US"): string {
  const messages = createDesktopMessages(locale).members;
  const primary = agent.primary ? messages.primaryAgent : "";
  return [
    agent.name,
    `@${agent.handle}`,
    runtimeLabel(agent.runtimeKind),
    agent.model,
    agent.presence,
    primary,
    renderPermissionsPanel(agent, locale),
    messages.capabilityScanUnavailable,
  ].join(" ");
}

function runtimeLabel(runtime: AgentView["runtimeKind"]): string {
  return runtime === "ClaudeCode" ? "Claude Code" : runtime;
}
