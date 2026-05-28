import { describe, expect, it } from "vitest";

import { createDaemonBridgeMock } from "../src/lib/daemon-bridge";
import { createEventBridge } from "../src/lib/event-bridge";
import { renderAppShell } from "../src/app/App";

describe("desktop shell daemon connectivity", () => {
  it("renders Chinese by default and reflects daemon connection state", async () => {
    const bridge = createDaemonBridgeMock({ connected: true });

    const connected = await renderAppShell({ bridge });
    expect(connected).toContain("聊天");
    expect(connected).toContain("已连接");

    bridge.setConnected(false);
    const offline = await renderAppShell({ bridge });
    expect(offline).toContain("离线");
  });

  it("reconnects event delivery from the last seen sequence", async () => {
    const bridge = createDaemonBridgeMock({ connected: true });
    const events = createEventBridge(bridge);

    await events.reconnectFrom(41);

    expect(bridge.eventSubscriptions).toEqual([{ after: 41 }]);
  });

  it("never exposes daemon endpoint, token or raw socket values to webview code", async () => {
    const bridge = createDaemonBridgeMock({ connected: true });

    const status = await bridge.daemonStatus();
    const serialized = JSON.stringify(status);

    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("ws://");
  });
});
