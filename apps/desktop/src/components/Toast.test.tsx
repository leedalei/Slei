/* @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { Toast, TOAST_VISIBLE_MS, type ToastType } from "./Toast";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderToast(input: { message?: string; type?: ToastType } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(<Toast message={input.message ?? "保存成功"} type={input.type} />);
  });

  return { host, root };
}

function cleanupToast(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

describe("Toast", () => {
  it("renders the toast message on a glass notification surface", () => {
    const { host, root } = renderToast({ message: "保存成功", type: "success" });

    try {
      const notification = host.querySelector<HTMLElement>('[data-slot="notification"]');
      const title = host.querySelector<HTMLElement>('[data-slot="notification-title"]');

      expect(notification).not.toBeNull();
      expect(notification?.getAttribute("data-toast-notification")).toBe("true");
      expect(title?.textContent).toBe("保存成功");
      expect(title?.querySelector("button")).toBeNull();
      expect(host.querySelector<HTMLButtonElement>('[data-slot="notification-action"]')).not.toBeNull();
      expect(host.querySelector("[data-slei-panel]")).toBeNull();
    } finally {
      cleanupToast(root, host);
    }
  });

  it("limits long messages to 70 percent of the app width and wraps overflow text", () => {
    const { host, root } = renderToast({
      message: "backend service failed while processing a long diagnostic message with many details",
      type: "success",
    });

    try {
      const notification = host.querySelector('[data-slot="notification"]');
      const title = host.querySelector<HTMLElement>('[data-slot="notification-title"]');

      expect(notification?.className).toContain("max-w-[70vw]");
      expect(title?.className).toContain("whitespace-normal");
      expect(title?.className).toContain("break-words");
    } finally {
      cleanupToast(root, host);
    }
  });

  it.each([
    ["success", "success"],
    ["error", "error"],
    ["info", "info"],
    ["warn", "warning"],
  ] as const)("preserves the %s visual and semantic notification variant", (toastType, notificationType) => {
    const { host, root } = renderToast({ type: toastType });

    try {
      const notification = host.querySelector<HTMLElement>('[data-slot="notification"]');

      expect(notification?.getAttribute("data-type")).toBe(notificationType);
      expect(notification?.getAttribute("role")).toBe(toastType === "error" ? "alert" : "status");
    } finally {
      cleanupToast(root, host);
    }
  });

  it("preserves click-to-copy behavior for the toast message", () => {
    const clipboard = { writeText: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    vi.stubGlobal("navigator", { clipboard });
    const { host, root } = renderToast({ message: "  copied text  ", type: "info" });

    try {
      act(() => {
        host.querySelector<HTMLButtonElement>('[data-slot="notification-action"]')?.click();
      });

      expect(clipboard.writeText).toHaveBeenCalledWith("copied text");
    } finally {
      vi.unstubAllGlobals();
      cleanupToast(root, host);
    }
  });

  it("calls onDismiss when the notification close control is clicked", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onDismiss = vi.fn();

    act(() => {
      root.render(<Toast message="保存成功" onDismiss={onDismiss} type="success" />);
    });

    try {
      act(() => {
        host.querySelector<HTMLButtonElement>('[data-slot="notification-close"]')?.click();
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      cleanupToast(root, host);
    }
  });

  it("lets callers clear the toast when the close control dismisses it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    function DismissibleCallerOwnedToast() {
      const [message, setMessage] = React.useState("保存成功");
      return <Toast message={message} onDismiss={() => setMessage("")} type="success" />;
    }

    act(() => {
      root.render(<DismissibleCallerOwnedToast />);
    });

    try {
      expect(host.querySelector('[data-slot="notification"]')).not.toBeNull();

      act(() => {
        host.querySelector<HTMLButtonElement>('[data-slot="notification-close"]')?.click();
      });

      expect(host.querySelector('[data-slot="notification"]')).toBeNull();
    } finally {
      cleanupToast(root, host);
    }
  });

  it("keeps the current single-toast lifecycle owned by the caller timer", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    function CallerOwnedToast() {
      const [toast, setToast] = React.useState<{ message: string; type: ToastType }>({ message: "保存成功", type: "success" });

      React.useEffect(() => {
        const timer = setTimeout(() => setToast((current) => ({ ...current, message: "" })), TOAST_VISIBLE_MS);
        return () => clearTimeout(timer);
      }, []);

      return <Toast message={toast.message} type={toast.type} />;
    }

    act(() => {
      root.render(<CallerOwnedToast />);
    });

    try {
      expect(host.querySelectorAll('[data-slot="notification"]')).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(TOAST_VISIBLE_MS - 1);
      });
      expect(host.querySelectorAll('[data-slot="notification"]')).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(host.querySelectorAll('[data-slot="notification"]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      cleanupToast(root, host);
    }
  });
});
