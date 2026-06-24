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
  const rows = [
    ["Node", input.status.node],
    ["Runtime", input.status.runtime],
    ["Worker", input.status.worker],
    ["Protocol", input.status.protocolVersion],
    ["Schema", input.status.schemaVersion],
    ["Inbox events", String(input.status.agentInboxEventCount ?? 0)],
    ["Memory updates", String(input.status.memoryUpdateEventCount ?? 0)],
    input.status.failureSummary ? ["Failure", input.status.failureSummary] : undefined,
  ]
    .filter(Boolean)
    .map((row) => {
      const [label, value] = row as [string, string];
      return `<div class="grid gap-1 rounded-lg bg-muted/40 p-3" data-slei-diagnostics-row><strong>${label}</strong><span>${value}</span></div>`;
    })
    .join("");
  const content = `<section class="grid gap-4 p-6" data-slei-diagnostics-page><header class="grid gap-1" data-slei-page-header><h1>${title}</h1></header><section class="rounded-xl border border-border/60 bg-card p-4 shadow-sm" data-slei-panel data-variant="surface"><div class="grid gap-2">${rows}</div></section></section>`;

  return renderFeatureShell({ active: "settings", locale: input.locale, content });
}
