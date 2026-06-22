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
    expect(headerHtml).not.toContain('data-slot="badge"');
    expect(headerHtml).not.toContain(">Settings<");
  });

  it("uses compact cards and secondary detail blocks for settings rows", () => {
    const messages = createDesktopMessages("en-US");
    const notificationsHtml = renderToStaticMarkup(
      <SettingsPage
        activePanel="notifications"
        appearance={{ theme: "system", fontSize: "md" }}
        locale="en-US"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        profile={null}
        timeZone="America/Los_Angeles"
      />,
    );
    const aboutHtml = renderToStaticMarkup(
      <SettingsPage
        activePanel="about"
        appearance={{ theme: "system", fontSize: "md" }}
        locale="en-US"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        profile={null}
        timeZone="America/Los_Angeles"
      />,
    );

    expect(notificationsHtml).toContain('data-size="compact"');
    expect(notificationsHtml).toContain('data-slot="detail-block"');
    expect(notificationsHtml).toContain('data-settings-notification="mentions"');
    expect(aboutHtml).toContain('data-slot="detail-block"');
    expect(aboutHtml).toContain('data-settings-about-row="desktopVersion"');
  });
});
