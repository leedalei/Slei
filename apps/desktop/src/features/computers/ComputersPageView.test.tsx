// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import { ComputersPage } from "./ComputersPageView";

const localNode: DesktopNodeView = {
  id: "local-node",
  name: "Lei MacBook",
  status: "connected",
  daemonVersion: "0.1.0",
  device: { platform: "darwin", arch: "arm64", hostname: "MateBook-Pro-Max-3.local" },
  runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
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

  it("shows daemon connection dots on the right side of each computer list row", () => {
    const messages = createDesktopMessages("zh-CN");
    const offlineNode: DesktopNodeView = {
      ...localNode,
      id: "remote-node",
      name: "Remote Windows",
      status: "offline",
      runtimes: [{ kind: "ClaudeCode", readiness: "unavailable" }],
    };
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[]}
        messages={messages}
        nodes={[localNode, offlineNode]}
      />,
    );

    expect(html).toContain('data-testid="slei-computer-daemon-dot-local-node"');
    expect(html).toContain('data-daemon-status="connected"');
    expect(html).toContain("bg-emerald-500");
    expect(html).toContain('data-testid="slei-computer-daemon-dot-remote-node"');
    expect(html).toContain('data-daemon-status="offline"');
    expect(html).toContain("bg-muted-foreground/45");
  });

  it("keeps the computer list card compact without a separate card header gap", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      <ComputersPage
        members={[]}
        messages={messages}
        nodes={[localNode]}
      />,
    );
    const markerStart = html.indexOf('data-testid="slei-computer-list-card"');
    const cardStart = html.lastIndexOf("<div", markerStart);
    const cardEnd = html.indexOf("</div></div>", cardStart);
    const cardHtml = html.slice(cardStart, cardEnd);

    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(cardStart).toBeGreaterThanOrEqual(0);
    expect(cardHtml).toContain('data-size="sm"');
    expect(cardHtml).toContain(messages.computers.computers);
    expect(cardHtml).toContain("Lei MacBook");
    expect(cardHtml).not.toContain('data-slot="card-header"');
  });
});
