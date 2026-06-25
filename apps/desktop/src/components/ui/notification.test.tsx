// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { NotificationProvider, useNotification } from "./notification";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | undefined;
let mountedHost: HTMLElement | undefined;

function StickyNotificationTrigger() {
  const { addNotification } = useNotification();

  React.useEffect(() => {
    addNotification({
      duration: 0,
      title: "Pinned",
      type: "info",
    });
  }, [addNotification]);

  return null;
}

afterEach(() => {
  if (mountedRoot && mountedHost) {
    act(() => {
      mountedRoot?.unmount();
    });
    mountedHost.remove();
  }
  mountedRoot = undefined;
  mountedHost = undefined;
  document.body.innerHTML = "";
});

describe("NotificationProvider", () => {
  it("renders duration 0 notifications as sticky without a progress bar", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoot = root;
    mountedHost = host;

    await act(async () => {
      root.render(
        <NotificationProvider>
          <StickyNotificationTrigger />
        </NotificationProvider>,
      );
    });

    expect(document.body.textContent).toContain("Pinned");
    expect(document.body.querySelector('[role="progressbar"]')).toBeNull();
  });
});
