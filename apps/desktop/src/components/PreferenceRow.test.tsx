/* @vitest-environment jsdom */

import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PreferenceRow } from "./PreferenceRow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderPreferenceRow(element: ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(element);
  });

  return { host, root };
}

function cleanupPreferenceRow(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

describe("PreferenceRow", () => {
  it("renders label, description, and control content", () => {
    const html = renderToStaticMarkup(
      <PreferenceRow
        control={<button type="button">开启</button>}
        description="同步桌面通知和提醒"
        label="通知"
      />,
    );

    expect(html).toContain("通知");
    expect(html).toContain("同步桌面通知和提醒");
    expect(html).toContain("开启");
  });

  it("labels and describes a plain input control from row copy", () => {
    const { host, root } = renderPreferenceRow(
      <PreferenceRow
        control={<input type="checkbox" />}
        description="同步桌面通知和提醒"
        error="需要重新授权"
        label="通知"
      />,
    );

    try {
      const input = host.querySelector("input");
      const label = host.querySelector("label");
      const description = host.querySelector("[data-slei-preference-row-description]");
      const error = host.querySelector("[data-slei-preference-row-error]");

      expect(input?.id).toBeTruthy();
      expect(label?.getAttribute("for")).toBe(input?.id);
      expect(description?.id).toBeTruthy();
      expect(error?.id).toBeTruthy();
      expect(input?.getAttribute("aria-describedby")).toBe(`${description?.id} ${error?.id}`);
    } finally {
      cleanupPreferenceRow(root, host);
    }
  });

  it("preserves caller-provided control id and aria-describedby", () => {
    const { host, root } = renderPreferenceRow(
      <PreferenceRow
        control={<input aria-describedby="external-help" id="external-control" type="text" />}
        description="本地说明"
        label="昵称"
      />,
    );

    try {
      const input = host.querySelector("input");
      const label = host.querySelector("label");

      expect(input?.id).toBe("external-control");
      expect(input?.getAttribute("aria-describedby")).toBe("external-help");
      expect(label?.getAttribute("for")).toBe("external-control");
    } finally {
      cleanupPreferenceRow(root, host);
    }
  });

  it("labels composite group controls with aria-labelledby instead of htmlFor", () => {
    const { host, root } = renderPreferenceRow(
      <PreferenceRow
        control={<div role="group"><button type="button">浅色</button><button type="button">深色</button></div>}
        label="主题"
        labelMode="group"
      />,
    );

    try {
      const label = host.querySelector("[data-slei-preference-row-label]");
      const group = host.querySelector('[role="group"]');

      expect(label?.tagName).not.toBe("LABEL");
      expect(label?.id).toBeTruthy();
      expect(group?.getAttribute("aria-labelledby")).toBe(label?.id);
      expect(group?.hasAttribute("aria-label")).toBe(false);
    } finally {
      cleanupPreferenceRow(root, host);
    }
  });
});
