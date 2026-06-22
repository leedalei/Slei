/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { Toast } from "./Toast";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderToast(message = "保存成功") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(<Toast message={message} type="success" />);
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
  it("renders on an opaque white surface so page content does not show through", () => {
    const { host, root } = renderToast();

    try {
      const button = host.querySelector("button");

      expect(button?.className).toContain("bg-white");
    } finally {
      cleanupToast(root, host);
    }
  });

  it("limits long messages to 70 percent of the app width and wraps overflow text", () => {
    const { host, root } = renderToast("invalid coordinator JSON: unknown variant request_agent_reply expected one of many other variants");

    try {
      const button = host.querySelector("button");

      expect(button?.className).toContain("max-w-[70vw]");
      expect(button?.className).toContain("whitespace-normal");
      expect(button?.className).toContain("break-words");
    } finally {
      cleanupToast(root, host);
    }
  });
});
