/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installPointerEvent(view: Window & typeof globalThis) {
  class TestPointerEvent extends view.MouseEvent {
    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
    }
  }

  view.PointerEvent = TestPointerEvent as typeof PointerEvent;
}

function renderTabs() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const view = host.ownerDocument.defaultView!;
  installPointerEvent(view);

  act(() => {
    root.render(
      <Tabs defaultValue="profile">
        <TabsList aria-label="成员配置">
          <TabsTrigger value="profile">资料</TabsTrigger>
          <TabsTrigger value="activity">活动</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">资料内容</TabsContent>
        <TabsContent value="activity">活动内容</TabsContent>
      </Tabs>,
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

describe("Tabs", () => {
  it("renders line tabs through the shared primitive API", () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="profile">
        <TabsList aria-label="成员配置" className="custom-tabs-list" variant="line">
          <TabsTrigger value="profile">资料</TabsTrigger>
          <TabsTrigger value="activity">活动</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const list = host.querySelector<HTMLElement>('[data-slot="tabs-list"]');

    expect(html).toContain('data-orientation="horizontal"');
    expect(html).toContain('data-slot="tabs-list"');
    expect(html).toContain('data-variant="line"');
    expect(list?.parentElement?.getAttribute("data-orientation")).toBe("horizontal");
    expect(list?.className).toContain("custom-tabs-list");
    expect(Array.from(list?.children ?? []).map((child) => child.getAttribute("data-slot"))).toEqual([
      "tabs-trigger",
      "tabs-trigger",
    ]);
    expect(html).not.toContain("data-slei-glass-tabs-list");
  });

  it("renders soft tabs through the shared primitive API", () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="chat">
        <TabsList variant="soft">
          <TabsTrigger value="chat">Chat</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(html).toContain('data-variant="soft"');
    expect(html).toContain('data-slot="tabs-list"');
    expect(html).toContain('data-slot="tabs-trigger"');
    expect(html).toContain("Chat");
    expect(html).not.toContain("t-tabs-pill");
    expect(html).not.toContain("data-slei-tabs-pill");
  });

  it("switches glass tab content when a trigger is clicked", async () => {
    const { host, root } = renderTabs();

    try {
      const profileTab = Array.from(host.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "资料");
      const activityTab = Array.from(host.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "活动");
      expect(profileTab?.getAttribute("aria-selected")).toBe("true");
      expect(activityTab?.getAttribute("aria-selected")).toBe("false");
      expect(host.textContent).toContain("资料内容");
      expect(host.textContent).not.toContain("活动内容");

      const view = host.ownerDocument.defaultView!;
      await act(async () => {
        activityTab?.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }));
        activityTab?.dispatchEvent(new view.MouseEvent("mouseup", { bubbles: true, button: 0, ctrlKey: false }));
        (activityTab as HTMLButtonElement | undefined)?.click();
      });
      await act(async () => undefined);

      const updatedProfileTab = Array.from(host.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "资料");
      const updatedActivityTab = Array.from(host.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "活动");
      expect(updatedProfileTab?.getAttribute("aria-selected")).toBe("false");
      expect(updatedActivityTab?.getAttribute("aria-selected")).toBe("true");
      expect(host.textContent).not.toContain("资料内容");
      expect(host.textContent).toContain("活动内容");
    } finally {
      cleanup(root, host);
    }
  });

  it("keeps TabsContent layout classes on the content root with direct children", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <Tabs defaultValue="profile">
        <TabsContent className="custom-tabs-content" forceMount value="profile">
          <section data-testid="profile-panel">资料</section>
          <section data-testid="activity-panel">活动</section>
        </TabsContent>
      </Tabs>,
    );

    const content = host.querySelector<HTMLElement>('[data-slot="tabs-content"]');

    expect(content).not.toBeNull();
    expect(content?.className).toContain("custom-tabs-content");
    expect(Array.from(content?.children ?? []).map((child) => child.getAttribute("data-testid"))).toEqual([
      "profile-panel",
      "activity-panel",
    ]);
  });
});
