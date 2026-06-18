// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import { SettingsPage } from "./SettingsPageView";

const localNode: DesktopNodeView = {
  id: "local-node",
  name: "Local",
  status: "connected",
  daemonVersion: "0.1.0",
  device: { platform: "darwin", arch: "arm64", hostname: "local" },
  runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
};

describe("SettingsPage header", () => {
  it("makes the settings panel header draggable and text unselectable", () => {
    const messages = createDesktopMessages("en-US");
    const html = renderToStaticMarkup(
      <SettingsPage
        activePanel="language-region"
        appearance={{ theme: "system", fontSize: "md" }}
        locale="en-US"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        profile={null}
        timeZone="America/Los_Angeles"
      />,
    );
    const markerStart = html.indexOf('data-testid="slei-settings-panel-header"');
    const headerStart = html.lastIndexOf("<header", markerStart);
    const headerEnd = html.indexOf("</header>", markerStart);
    const headerHtml = html.slice(headerStart, headerEnd);

    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml).toContain('data-tauri-drag-region="deep"');
    expect(headerHtml).toContain("select-none");
    expect(headerHtml).toContain("Language");
    expect(headerHtml).toContain("Region");
  });
});
