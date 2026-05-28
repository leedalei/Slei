import { describe, expect, it } from "vitest";

import { renderComputersPage } from "./ComputersPage";

describe("ComputersPage", () => {
  it("renders localized node readiness and runtime capabilities", () => {
    const html = renderComputersPage({
      locale: "zh-CN",
      nodes: [
        {
          id: "node_offline",
          name: "公司台式 Win",
          status: "disconnected",
          daemonVersion: "0.1.0",
          runtimes: [{ kind: "ClaudeCode", readiness: "unavailable" }],
          agents: [],
        },
        {
          id: "node_local",
          name: "MacBookPro M4 MAX",
          status: "connected",
          daemonVersion: "0.1.0",
          runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
          agents: [{ name: "Coda", runtime: "Claude Code", status: "online" }],
        },
      ],
    });

    expect(html).toContain("运行设备");
    expect(html).toContain("已连接");
    expect(html).toContain("离线");
    expect(html).toContain("Claude Code");
    expect(html).toContain("可用");
    expect(html).toContain("注册工作区");
    expect(html).toContain("Coda");
  });

  it("renders English labels without guessing readiness from UI state", () => {
    const html = renderComputersPage({
      locale: "en-US",
      nodes: [
        {
          id: "node_unknown",
          name: "Local",
          status: "connected",
          daemonVersion: "0.1.0",
          runtimes: [{ kind: "ClaudeCode", readiness: "unknown" }],
          agents: [],
        },
      ],
    });

    expect(html).toContain("Computers");
    expect(html).toContain("Unknown");
    expect(html).toContain("Register workspace");
    expect(html).toContain("No hosted agents");
  });
});
