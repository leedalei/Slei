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
  it("renders the toast message on a shadcn toast surface", () => {
    const { host, root } = renderToast({ message: "保存成功", type: "success" });

    try {
      const toast = host.querySelector<HTMLElement>('[data-slot="toast"]');
      const title = host.querySelector<HTMLElement>('[data-slot="toast-title"]');

      expect(toast).not.toBeNull();
      expect(title?.textContent).toBe("保存成功");
      expect(title?.querySelector("button")).toBeNull();
      expect(host.querySelector<HTMLButtonElement>('[data-slot="toast-action"]')).toBeNull();
      expect(host.querySelector<HTMLButtonElement>('[aria-label="复制通知内容"]')).toBeNull();
      expect(host.querySelector("[data-slei-panel]")).toBeNull();
      expect(host.innerHTML).not.toContain("notification-surface");
      expect(host.innerHTML).not.toContain("backdrop-blur");
      expect(host.innerHTML).not.toContain("bg-linear");
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
      const toast = host.querySelector('[data-slot="toast"]');
      const title = host.querySelector<HTMLElement>('[data-slot="toast-title"]');

      expect(toast?.className).toContain("max-w-[70vw]");
      expect(title?.className).toContain("whitespace-normal");
      expect(title?.className).toContain("break-words");
    } finally {
      cleanupToast(root, host);
    }
  });

  it("centers compact toast content vertically on a token-based surface", () => {
    const { host, root } = renderToast({ message: "复制成功", type: "success" });

    try {
      const content = host.querySelector<HTMLElement>('[data-slot="toast-content"]');
      const icon = host.querySelector<SVGElement>('[data-slot="toast-icon"]');
      const toast = host.querySelector<HTMLElement>('[data-slot="toast"]');

      expect(content).not.toBeNull();
      expect(icon).not.toBeNull();
      expect(toast).not.toBeNull();
      expect(content?.className).toContain("items-center");
      expect(toast?.className).toContain("bg-popover");
      expect(toast?.className).toContain("text-popover-foreground");
      expect(icon?.className.baseVal).toContain("h-4");
      expect(icon?.className.baseVal).toContain("w-4");
      expect(toast?.className).not.toContain("bg-white/70");
      expect(toast?.className).not.toContain("backdrop-blur-2xl");
      expect(toast?.className).not.toContain("backdrop-saturate-150");
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
      const toast = host.querySelector<HTMLElement>('[data-slot="toast"]');

      expect(toast?.getAttribute("data-type")).toBe(notificationType);
      expect(toast?.getAttribute("role")).toBe(toastType === "error" ? "alert" : "status");
    } finally {
      cleanupToast(root, host);
    }
  });

  it("does not render a copy action for toast messages", () => {
    const { host, root } = renderToast({ message: "  copied text  ", type: "info" });

    try {
      expect(host.querySelector('[data-slot="toast"]')?.textContent).toContain("copied text");
      expect(host.querySelector<HTMLButtonElement>('[data-slot="toast-action"]')).toBeNull();
      expect(host.querySelector<HTMLButtonElement>('[aria-label="复制通知内容"]')).toBeNull();
    } finally {
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
        host.querySelector<HTMLButtonElement>('[data-slot="toast-close"]')?.click();
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
      expect(host.querySelector('[data-slot="toast"]')).not.toBeNull();

      act(() => {
        host.querySelector<HTMLButtonElement>('[data-slot="toast-close"]')?.click();
      });

      expect(host.querySelector('[data-slot="toast"]')).toBeNull();
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
      expect(host.querySelectorAll('[data-slot="toast"]')).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(TOAST_VISIBLE_MS - 1);
      });
      expect(host.querySelectorAll('[data-slot="toast"]')).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(host.querySelectorAll('[data-slot="toast"]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      cleanupToast(root, host);
    }
  });
});
