// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const bridgeSlot = vi.hoisted(() => ({
  current: undefined as unknown,
}));

vi.mock("../lib/daemon-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/daemon-bridge")>();
  return {
    ...actual,
    createDaemonBridge: () => bridgeSlot.current,
  };
});

import { createDaemonBridgeMock, type DaemonBridgeMock } from "../test/daemon-bridge-mock";
import { SleiApp } from "./SleiApp";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};
HTMLElement.prototype.scrollIntoView ??= () => undefined;

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

async function mountSleiApp(bridge: DaemonBridgeMock) {
  bridgeSlot.current = bridge;
  mountedContainer = document.createElement("div");
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  await act(async () => {
    mountedRoot?.render(
      <MemoryRouter>
        <SleiApp />
      </MemoryRouter>,
    );
  });
  await flushReact();
  return mountedContainer;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitForAssertion(assertion: () => void, attempts = 20) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await flushReact();
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flushReact();
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await flushReact();
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount();
    });
  }
  mountedContainer?.remove();
  mountedRoot = undefined;
  mountedContainer = undefined;
  bridgeSlot.current = undefined;
  vi.restoreAllMocks();
});

describe("SleiApp Electron daemon recovery", () => {
  it("reruns initialization when daemon state becomes connected", async () => {
    const bridge = createDaemonBridgeMock({ connected: false });
    const channel = {
      id: "all",
      name: "all",
      description: "研发频道",
      activeSessionId: "session:all",
      isDefault: true,
      projectPaths: [],
    };
    const listChannels = vi.spyOn(bridge, "listChannels")
      .mockResolvedValueOnce({ channels: [] })
      .mockResolvedValue({ channels: [channel] });
    vi.spyOn(bridge, "listChannelMessages")
      .mockResolvedValue({
        messages: [
          {
            id: "msg_after_connect",
            sequence: 1,
            channelId: "all",
            sessionId: "session:all",
            authorId: "human:local",
            body: "初始化后频道消息",
            kind: "human",
            deleted: false,
            createdAt: "2026-07-07T00:00:00Z",
          },
        ],
        pageInfo: { hasMoreBefore: false },
      });

    const host = await mountSleiApp(bridge);

    await waitForAssertion(() => {
      expect(listChannels).toHaveBeenCalledTimes(1);
    });

    bridge.setConnected(true);
    bridge.emitDaemonState({ state: "connected" });

    await waitForAssertion(() => {
      expect(listChannels).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain("all");
      expect(host.textContent).toContain("初始化后频道消息");
    });
  });

  it("submits the chat composer through the daemon bridge channel message route", async () => {
    const bridge = createDaemonBridgeMock({ connected: true });
    const sendChannelMessage = vi.spyOn(bridge, "sendChannelMessage");
    const host = await mountSleiApp(bridge);

    await waitForAssertion(() => {
      expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')).not.toBeNull();
    });

    const textarea = host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]');
    const sendButton = host.querySelector<HTMLButtonElement>('[data-testid="slei-send-button"]');
    expect(textarea).not.toBeNull();
    expect(sendButton).not.toBeNull();

    await changeTextarea(textarea!, "Electron composer 发送");
    await click(sendButton!);

    await waitForAssertion(() => {
      expect(sendChannelMessage).toHaveBeenCalledWith("all", {
        authorId: "human:local",
        body: "Electron composer 发送",
        asTask: false,
        attachmentIds: [],
      });
    });
  });
});
