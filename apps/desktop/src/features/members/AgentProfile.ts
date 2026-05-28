import { renderPermissionsPanel } from "./PermissionsPanel";
import type { AgentView } from "./types";

export function renderAgentProfile(agent: AgentView, locale: "zh-CN" | "en-US"): string {
  const primary = agent.primary ? (locale === "zh-CN" ? "主 Agent" : "Primary agent") : "";
  return [
    agent.name,
    `@${agent.handle}`,
    runtimeLabel(agent.runtimeKind),
    agent.model,
    agent.presence,
    primary,
    renderPermissionsPanel(agent, locale),
    locale === "zh-CN" ? "能力扫描暂不可用" : "Capability scan unavailable",
  ].join(" ");
}

function runtimeLabel(runtime: AgentView["runtimeKind"]): string {
  return runtime === "ClaudeCode" ? "Claude Code" : runtime;
}
