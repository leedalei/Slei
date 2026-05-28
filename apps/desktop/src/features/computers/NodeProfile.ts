import type { ComputerNode, RuntimeReadiness } from "./types";
import { statusLabel } from "./NodeList";

export function renderNodeProfile(
  node: ComputerNode,
  locale: "zh-CN" | "en-US",
): string {
  const runtimeLines = node.runtimes
    .map((runtime) => `${runtimeName(runtime.kind)} ${readinessLabel(runtime.readiness, locale)}`)
    .join(" ");
  const agents =
    node.agents.length > 0
      ? node.agents.map((agent) => `${agent.name} ${agent.runtime} ${agent.status}`).join(" ")
      : locale === "zh-CN"
        ? "没有托管 Agent"
        : "No hosted agents";

  return [
    node.name,
    statusLabel(node.status, locale),
    `daemon ${node.daemonVersion}`,
    runtimeLines,
    locale === "zh-CN" ? "注册工作区" : "Register workspace",
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
  const labels = {
    "zh-CN": {
      ready: "可用",
      unavailable: "不可用",
      unknown: "未知",
    },
    "en-US": {
      ready: "Ready",
      unavailable: "Unavailable",
      unknown: "Unknown",
    },
  }[locale];
  return labels[readiness];
}
