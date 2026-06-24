import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/test/fixtures";

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
    expect(html).toContain("OS");
    expect(html).toContain("darwin arm64");
    expect(html).not.toContain("<dt>系统</dt>");
    expect(html).not.toContain("<dt>平台</dt>");
    expect(html).not.toContain("<dt>架构</dt>");
    expect(html).not.toContain("15.5");
    expect(html).toContain("重新检测");
  });

  it("does not render an attention badge inside the runtime modal", () => {
    const data = createSleiFixtures({
      nodes: [
        {
          id: "local-node",
          name: "Lei MacBook",
          status: "connected",
          daemonVersion: "0.1.0",
          device: {
            platform: "darwin",
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

    const modalHtml = html.match(/<div role="dialog"[\s\S]*?连接本地 Claude runtime[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(modalHtml).not.toContain("slei-badge--attention");
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

  it("does not draw a divider above the first runtime row", () => {
    const data = createSleiFixtures({
      nodes: [
        {
          id: "local-node",
          name: "Lei MacBook",
          status: "connected",
          daemonVersion: "0.1.0",
          device: {
            platform: "darwin",
            arch: "arm64",
            hostname: "lei-macbook.local",
          },
          runtimes: [
            { kind: "ClaudeCode", readiness: "unknown" },
            { kind: "CodexCli", readiness: "ready" },
          ],
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
    const firstRuntimeRow = html.slice(html.indexOf(">ClaudeCode<"));
    const secondRuntimeRow = html.slice(html.indexOf(">CodexCli<"));

    expect(firstRuntimeRow.slice(0, firstRuntimeRow.indexOf("</div>"))).not.toContain("border-t");
    expect(secondRuntimeRow.slice(0, secondRuntimeRow.indexOf("</div>"))).toContain("border-t");
  });
});
