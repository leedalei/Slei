import { createDesktopMessages } from "../../i18n";
import { renderFeatureShell } from "../shell/AppShell";

export type DiagnosticsStatus = {
  node: string;
  runtime: string;
  worker: string;
  protocolVersion: string;
  schemaVersion: string;
  agentInboxEventCount?: number;
  memoryUpdateEventCount?: number;
  failureSummary?: string;
};

export function renderDiagnosticsPage(input: {
  locale: "zh-CN" | "en-US";
  status: DiagnosticsStatus;
}): string {
  const title = createDesktopMessages(input.locale).diagnostics.title;
  const content = [
    title,
    `Node: ${input.status.node}`,
    `Runtime: ${input.status.runtime}`,
    `Worker: ${input.status.worker}`,
    `Protocol: ${input.status.protocolVersion}`,
    `Schema: ${input.status.schemaVersion}`,
    `Inbox events: ${input.status.agentInboxEventCount ?? 0}`,
    `Memory updates: ${input.status.memoryUpdateEventCount ?? 0}`,
    input.status.failureSummary ? `Failure: ${input.status.failureSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return renderFeatureShell({ active: "settings", locale: input.locale, content });
}
