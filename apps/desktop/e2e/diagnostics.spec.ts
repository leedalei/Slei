import { describe, expect, it } from "vitest";

import { renderBasicTimelineBrowse } from "../src/features/search/BasicTimelineBrowse";
import { renderDiagnosticsPage } from "../src/features/diagnostics/DiagnosticsPage";
import { renderErrorPanel } from "../src/features/diagnostics/ErrorPanel";
import { renderLogExportDialog } from "../src/features/diagnostics/LogExportDialog";
import { createFrontendCrashReport } from "../src/lib/frontend-crash-logging";

describe("diagnostics and localized recovery", () => {
  it("renders sanitized diagnostics and paginated timeline browsing", () => {
    const html = renderDiagnosticsPage({
      locale: "zh-CN",
      status: {
        node: "MacBookPro M4 MAX",
        runtime: "Claude Code",
        worker: "claude-agent",
        protocolVersion: "v1",
        schemaVersion: "2026-05-27",
        failureSummary: "token=[redacted-token] path=[redacted-path]",
      },
    });

    expect(html).toContain("诊断");
    expect(html).toContain("MacBookPro M4 MAX");
    expect(html).toContain("Claude Code");
    expect(html).not.toContain("secret-token");
    expect(html).not.toContain("/Users/leelei");

    const browse = renderBasicTimelineBrowse({ page: 2, pageSize: 50, total: 130 });
    expect(browse).toContain("Timeline page 2");
    expect(browse).toContain("50 per page");
    expect(browse).not.toContain("Search");
  });

  it("renders inbox and memory diagnostics counts", () => {
    const html = renderDiagnosticsPage({
      locale: "en-US",
      status: {
        node: "MacBookPro M4 MAX",
        runtime: "Claude Code",
        worker: "claude-agent",
        protocolVersion: "v1",
        schemaVersion: "2026-05-27",
        agentInboxEventCount: 5,
        memoryUpdateEventCount: 8,
      },
    });

    expect(html).toContain("Inbox");
    expect(html).toContain("5");
    expect(html).toContain("Memory updates");
    expect(html).toContain("8");
  });

  it("renders actionable bilingual E1xx-E4xx errors and sanitized log export", () => {
    expect(renderErrorPanel({ locale: "zh-CN", code: "E101" })).toContain("检查本地 daemon");
    expect(renderErrorPanel({ locale: "en-US", code: "E201" })).toContain("Check runtime permissions");
    expect(renderErrorPanel({ locale: "zh-CN", code: "E301" })).toContain("重新连接");
    expect(renderErrorPanel({ locale: "en-US", code: "E401" })).toContain("Review workspace access");

    const exportDialog = renderLogExportDialog({
      locale: "zh-CN",
      sanitizedPreview: "token=[redacted-token] body=[redacted-body]",
    });
    expect(exportDialog).toContain("导出日志");
    expect(exportDialog).toContain("[redacted-token]");
    expect(exportDialog).not.toContain("secret-token");
  });

  it("creates sanitized frontend crash reports for desktop logs", () => {
    const report = createFrontendCrashReport(
      "react",
      new Error("token=secret-token Cannot read properties of null"),
      "at SearchPage",
    );

    expect(report.kind).toBe("react");
    expect(report.message).toContain("[redacted-token]");
    expect(report.message).not.toContain("secret-token");
    expect(report.componentStack).toContain("SearchPage");
  });
});
