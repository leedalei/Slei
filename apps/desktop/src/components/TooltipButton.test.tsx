/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TooltipButton } from "./TooltipButton";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderRippleButton() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <TooltipProvider>
        <TooltipButton aria-label="Chat" ripple rippleColor="cyan" tooltip="Chat" type="button">
          Chat
        </TooltipButton>
      </TooltipProvider>,
    );
  });

  return { host, root };
}

function cleanup(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = "";
}

describe("TooltipButton", () => {
  it("renders a ripple feedback element on pointer down when enabled", () => {
    const { host, root } = renderRippleButton();

    try {
      const button = host.querySelector("button");
      expect(button).not.toBeNull();

      Object.defineProperty(button, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ height: 56, left: 10, top: 20, width: 56, right: 66, bottom: 76, x: 10, y: 20, toJSON: () => ({}) }),
      });

      act(() => {
        button?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 38, clientY: 48 }));
      });

      const ripple = button?.querySelector('[data-slot="button-ripple"]') as HTMLSpanElement | null;
      expect(ripple).not.toBeNull();
      expect(ripple?.className).toContain("bg-cyan-400/30");
      expect(ripple?.style.width).toBe("112px");
      expect(ripple?.style.height).toBe("112px");
    } finally {
      cleanup(root, host);
    }
  });
});
