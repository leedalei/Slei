import { renderFeatureShell } from "../shell/AppShell";

export type DiagnosticsStatus = {
  node: string;
  runtime: string;
  worker: string;
  protocolVersion: string;
  schemaVersion: string;
  failureSummary?: string;
};

export function renderDiagnosticsPage(input: {
  locale: "zh-CN" | "en-US";
  status: DiagnosticsStatus;
}): string {
  const title = input.locale === "zh-CN" ? "诊断" : "Diagnostics";
  const content = [
    title,
    `Node: ${input.status.node}`,
    `Runtime: ${input.status.runtime}`,
    `Worker: ${input.status.worker}`,
    `Protocol: ${input.status.protocolVersion}`,
    `Schema: ${input.status.schemaVersion}`,
    input.status.failureSummary ? `Failure: ${input.status.failureSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return renderFeatureShell({ active: "settings", locale: input.locale, content });
}
