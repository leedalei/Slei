// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import type { SleiMember } from "../../app/types";
import { ComputersPage } from "./ComputersPageView";

const localNode: DesktopNodeView = {
  id: "local-node",
  name: "Lei MacBook",
  status: "connected",
  daemonVersion: "0.1.0",
  device: { platform: "darwin", arch: "arm64", hostname: "MateBook-Pro-Max-3.local" },
  runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
};

const hostedAgent: SleiMember = {
  id: "agent_yeal",
  name: "Yeal",
  handle: "@yeal",
  avatar: "YE",
  type: "agent",
  runtimeStatus: "idle",
  role: "Guide",
  description: "Guide agent.",
  computer: "Lei MacBook",
  nodeId: "local-node",
  created: "2026-06-22",
  creator: "system",
  runtime: "ClaudeCode",
  model: "Sonnet",
  instructions: "Guide agent.",
  permissions: [],
  environmentVariables: [],
  createdAgents: [],
  activity: "Idle",
  capabilities: ["ClaudeCode"],
};

describe("ComputersPage header", () => {
  it("makes the computer detail header draggable and text unselectable", () => {
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[]}
        messages={createDesktopMessages("zh-CN")}
        nodes={[localNode]}
      />,
    );
    const markerStart = html.indexOf('data-testid="slei-computer-detail-header"');
    const headerStart = html.lastIndexOf("<header", markerStart);
    const headerEnd = html.indexOf("</header>", markerStart);
    const headerHtml = html.slice(headerStart, headerEnd);

    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(html).toContain("data-slei-page-header");
    expect(headerHtml).toContain("data-slei-status");
    expect(headerHtml).toContain('data-tauri-drag-region="deep"');
    expect(headerHtml).toContain("select-none");
    expect(headerHtml).toContain("Lei MacBook");
    expect(headerHtml).toContain("MateBook-Pro-Max-3.local");
  });

  it("uses the shared empty illustration when no agents are hosted on the computer", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[]}
        messages={messages}
        nodes={[localNode]}
      />,
    );

    expect(html).toContain(messages.computers.noAgents);
    expect(html).toContain('data-empty-illustration="nodata"');
  });

  it("renders a dash when the computer created time is missing", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[]}
        messages={messages}
        nodes={[{ ...localNode, created: undefined }]}
      />,
    );
    const createdLabelIndex = html.indexOf(messages.computers.created);
    const createdItemStart = html.lastIndexOf("<div", createdLabelIndex);
    const createdItemEnd = html.indexOf("</div>", createdLabelIndex);
    const createdItemHtml = html.slice(createdItemStart, createdItemEnd);

    expect(createdLabelIndex).toBeGreaterThanOrEqual(0);
    expect(createdItemHtml).toContain("<dd");
    expect(createdItemHtml).toContain(">-</dd>");
  });

  it("shows the selected computer connection status in the detail header", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[]}
        messages={messages}
        nodes={[localNode]}
      />,
    );
    const markerStart = html.indexOf('data-testid="slei-computer-detail-header"');
    const headerStart = html.lastIndexOf("<header", markerStart);
    const headerEnd = html.indexOf("</header>", markerStart);
    const headerHtml = html.slice(headerStart, headerEnd);

    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml).toContain(messages.computers.connected);
    expect(headerHtml).toContain('data-slei-status="connected"');
  });

  it("does not duplicate the selected computer identity in a detail list card", () => {
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[]}
        messages={createDesktopMessages("zh-CN")}
        nodes={[localNode]}
      />,
    );

    expect(html).not.toContain('data-testid="slei-computer-list-card"');
  });

  it("uses shared soft panels and secondary detail blocks in the computer detail page", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[hostedAgent]}
        messages={messages}
        nodes={[localNode]}
      />,
    );
    const deviceNameIndex = html.indexOf(messages.computers.deviceName);
    const deviceCardStart = html.lastIndexOf("data-slei-panel", deviceNameIndex);
    const deviceCardEnd = html.indexOf("data-slei-panel", deviceNameIndex + 1);
    const deviceCardHtml = html.slice(deviceCardStart, deviceCardEnd);

    expect(deviceCardHtml).toContain("data-slei-panel");
    expect(html).toContain('data-slot="detail-block"');
    expect(html).toContain('data-detail-block-kind="runtime"');
    expect(html).toContain('data-detail-block-kind="hosted-agent"');
    expect(html).toContain("data-slei-status");
  });

  it("labels hosted agents by connection state instead of idle workload state", () => {
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[hostedAgent]}
        messages={createDesktopMessages("zh-CN")}
        nodes={[localNode]}
      />,
    );

    expect(html).toContain("在线");
    expect(html).not.toContain("空闲");
  });
});
