import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";

describe("runtime setup onboarding modal", () => {
  it("appears when Claude runtime is not ready", () => {
    const data = createSleiFixtures({
      nodes: [
        {
          id: "local-node",
          name: "Lei MacBook",
          status: "connected",
          daemonVersion: "0.1.0",
          device: {
            platform: "darwin",
            osVersion: "15.5",
            arch: "arm64",
            hostname: "lei-macbook.local",
          },
          runtimes: [{ kind: "ClaudeCode", readiness: "unknown" }],
        },
      ],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: false,
          nodes: data.nodes,
        }}
        data={data}
      />,
    );

    expect(html).toContain("连接本地 Claude runtime");
    expect(html).toContain("给这台设备命名");
    expect(html).toContain("Lei MacBook");
    expect(html).toContain("15.5");
    expect(html).toContain("arm64");
    expect(html).toContain("重新检测");
  });

  it("shows detected Claude runtime version when available", () => {
    const data = createSleiFixtures({
      nodes: [
        {
          id: "local-node",
          name: "Lei MacBook",
          status: "connected",
          daemonVersion: "0.1.0",
          device: {
            platform: "darwin",
            osVersion: "15.5",
            arch: "arm64",
            hostname: "lei-macbook.local",
          },
          runtimes: [{ kind: "ClaudeCode", readiness: "ready", version: "1.2.3" }],
        },
      ],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="computers"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: data.nodes,
        }}
        data={data}
      />,
    );

    expect(html).toContain("1.2.3");
    expect(html).toContain("lei-macbook.local");
  });

  it("does not appear when Claude runtime is ready", () => {
    const data = createSleiFixtures();
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: data.nodes,
        }}
        data={data}
      />,
    );

    expect(html).not.toContain("连接本地 Claude runtime");
  });
});
