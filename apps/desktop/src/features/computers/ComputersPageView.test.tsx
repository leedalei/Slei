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
});
