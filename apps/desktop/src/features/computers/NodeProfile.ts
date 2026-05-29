import { createDesktopMessages } from "../../i18n";
import type { ComputerNode, RuntimeReadiness } from "./types";
import { statusLabel } from "./NodeList";

export function renderNodeProfile(
  node: ComputerNode,
  locale: "zh-CN" | "en-US",
): string {
  const messages = createDesktopMessages(locale).computers;
  const runtimeLines = node.runtimes
    .map((runtime) => `${runtimeName(runtime.kind)} ${readinessLabel(runtime.readiness, locale)}`)
    .join(" ");
  const agents =
    node.agents.length > 0
      ? node.agents.map((agent) => `${agent.name} ${agent.runtime} ${agent.status}`).join(" ")
      : messages.noHostedAgents;

  return [
    node.name,
    statusLabel(node.status, locale),
    `daemon ${node.daemonVersion}`,
    runtimeLines,
    messages.registerWorkspace,
    agents,
  ].join(" ");
}

function runtimeName(kind: RuntimeReadiness["kind"]): string {
  return kind === "ClaudeCode" ? "Claude Code" : kind;
}

function readinessLabel(
  readiness: RuntimeReadiness["readiness"],
  locale: "zh-CN" | "en-US",
): string {
  return createDesktopMessages(locale).computers.readiness[readiness];
}
