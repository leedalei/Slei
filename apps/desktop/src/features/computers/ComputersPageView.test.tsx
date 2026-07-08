// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import type { SleiMember } from "../../app/types";
import { ComputersPage } from "./ComputersPageView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function renderComputersPage() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <ComputersPage
        members={[]}
        messages={createDesktopMessages("zh-CN")}
        nodes={[localNode]}
      />,
    );
  });

  return { host, root };
}

function cleanupComputersPage(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

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
    const headerEnd = html.indexOf("</header>", markerStart);
    const headerHtml = html.slice(markerStart, headerEnd);

    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(html).toContain("data-slei-page-header");
    expect(headerHtml).toContain("data-slei-status");
    expect(html).not.toContain('<header class="select-none border-b px-6 py-5"');
    expect(html).toContain('<div class="select-none border-b px-6 py-5" data-testid="slei-computer-detail-header"');
    expect(headerHtml).toContain('data-desktop-drag-region="deep"');
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
    const headerEnd = html.indexOf("</header>", markerStart);
    const headerHtml = html.slice(markerStart, headerEnd);

    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml).toContain(messages.computers.connected);
    expect(headerHtml).toContain('data-slei-status="connected"');
    expect(headerHtml).toContain("bg-emerald-500/12");
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

  it("uses card surfaces and secondary detail blocks in the computer detail page", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[hostedAgent]}
        messages={messages}
        nodes={[localNode]}
      />,
    );
    const deviceNameIndex = html.indexOf(messages.computers.deviceName);
    const deviceCardStart = html.lastIndexOf('data-slot="card"', deviceNameIndex);
    const deviceCardEnd = html.indexOf('data-slot="card"', deviceNameIndex + 1);
    const deviceCardHtml = html.slice(deviceCardStart, deviceCardEnd);

    expect(deviceCardHtml).toContain('data-slot="card"');
    expect(deviceCardHtml).toContain('data-slot="card-content"');
    expect(html).toContain('data-slot="detail-block"');
    expect(html).toContain('data-detail-block-kind="runtime"');
    expect(html).toContain('data-detail-block-kind="hosted-agent"');
    expect(html).toContain("data-slei-status");
    expect(html).toContain('data-slei-icon="bot"');
  });

  it("keeps the device-name editor inside the glass card without a focus glow", () => {
    const { host, root } = renderComputersPage();

    try {
      const editButton = host.querySelector<HTMLButtonElement>(".slei-editable-field__edit");
      act(() => {
        editButton?.click();
      });

      const input = host.querySelector<HTMLInputElement>('[data-slot="input"]');
      const deviceCard = input?.closest<HTMLElement>('[data-slot="card"]');
      const cardContent = input?.closest<HTMLElement>('[data-slot="card-content"]');
      const glow = input?.parentElement?.querySelector<HTMLElement>('[aria-hidden="true"]');

      expect(input?.value).toBe(localNode.name);
      expect(deviceCard?.className).toContain("overflow-visible");
      expect(cardContent?.className).toContain("p-5");
      expect(glow).toBeNull();
    } finally {
      cleanupComputersPage(root, host);
    }
  });

  it("keeps computer info definition list terms and descriptions as direct grouped children", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <ComputersPage
        members={[]}
        messages={createDesktopMessages("zh-CN")}
        nodes={[localNode]}
      />,
    );

    const definitionList = host.querySelector("dl");
    const groups = Array.from(definitionList?.children ?? []);

    expect(groups).toHaveLength(4);
    for (const group of groups) {
      expect(group.tagName).toBe("DIV");
      expect(group.querySelector(":scope > dt")).not.toBeNull();
      expect(group.querySelector(":scope > dd")).not.toBeNull();
    }
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

  it("renders hosted agent count as a plain non-status badge", () => {
    const messages = createDesktopMessages("zh-CN");
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <ComputersPage
        members={[hostedAgent]}
        messages={messages}
        nodes={[localNode]}
      />,
    );

    const agentsHeading = Array.from(host.querySelectorAll("h2")).find((heading) => heading.textContent === messages.computers.agentsOnThisComputer);
    const agentsHeader = agentsHeading?.parentElement;
    const countBadge = Array.from(agentsHeader?.querySelectorAll<HTMLElement>('[data-slot="badge"]') ?? []).find((badge) => badge.textContent === "1");

    expect(countBadge).not.toBeNull();
    expect(countBadge?.getAttribute("data-slei-status")).toBeNull();
    expect(countBadge?.querySelector('[data-slot="status-badge-dot"]')).toBeNull();
    expect(countBadge?.querySelector("svg")).toBeNull();
  });
});
