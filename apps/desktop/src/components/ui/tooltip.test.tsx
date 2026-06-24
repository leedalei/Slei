/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderOpenTooltip() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>帮助</TooltipTrigger>
          <TooltipContent forceMount>只显示气泡</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
  });
  await act(async () => undefined);

  return { host, root };
}

function cleanupTooltip(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = "";
}

describe("Tooltip", () => {
  it("renders a bubble without an arrow pointer", async () => {
    const { host, root } = await renderOpenTooltip();

    try {
      const bubble = document.body.querySelector('[data-slot="tooltip-content"]');

      expect(bubble).not.toBeNull();
      expect(bubble?.textContent).toContain("只显示气泡");
      expect(bubble?.querySelector("svg")).toBeNull();
      expect(document.body.querySelector(".rotate-45")).toBeNull();
    } finally {
      cleanupTooltip(root, host);
    }
  });
});
