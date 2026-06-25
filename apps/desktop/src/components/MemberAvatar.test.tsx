/* @vitest-environment jsdom */

import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MemberAvatar } from "./MemberAvatar";
import { createMemberAvatar, type MemberAvatarIdentity } from "./member-avatar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalImage = window.Image;

function installImageMock(status: "error" | "loaded") {
  class MockImage {
    complete = false;
    private listeners = new Map<string, Set<(event: Event) => void>>();
    naturalWidth = 0;

    addEventListener(type: string, listener: (event: Event) => void) {
      const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: Event) => void) {
      this.listeners.get(type)?.delete(listener);
    }

    set src(_value: string) {
      this.complete = true;
      this.naturalWidth = status === "loaded" ? 64 : 0;
      queueMicrotask(() => {
        const eventType = status === "loaded" ? "load" : "error";
        const event = new Event(eventType);
        Object.defineProperty(event, "currentTarget", {
          configurable: true,
          value: this,
        });
        for (const listener of this.listeners.get(eventType) ?? []) {
          listener(event);
        }
      });
    }
  }

  Object.defineProperty(window, "Image", {
    configurable: true,
    writable: true,
    value: MockImage as unknown as typeof window.Image,
  });
}

async function renderMemberAvatar(element: ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return { host, root };
}

function cleanupMemberAvatar(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

afterEach(() => {
  Object.defineProperty(window, "Image", {
    configurable: true,
    writable: true,
    value: originalImage,
  });
  document.body.innerHTML = "";
});

describe("MemberAvatar", () => {
  it("renders the EinUI avatar and image slots with the generated member avatar source", async () => {
    installImageMock("loaded");
    const identity: MemberAvatarIdentity = {
      avatar: "LW",
      avatarSeed: "lin-wen-seed",
      handle: "lin",
      id: "member-1",
      name: "Lin Wen",
    };

    const { host, root } = await renderMemberAvatar(<MemberAvatar identity={identity} />);

    try {
      const avatar = host.querySelector<HTMLElement>('[data-slot="avatar"]');
      const image = host.querySelector<HTMLImageElement>('[data-slot="avatar-image"]');

      expect(avatar).not.toBeNull();
      expect(avatar?.getAttribute("aria-label")).toBe("Lin Wen");
      expect(avatar?.getAttribute("data-avatar-size")).toBe("default");
      expect(avatar?.getAttribute("data-avatar-image-rendering")).toBe("pixelated");
      expect(image).not.toBeNull();
      expect(image?.getAttribute("src")).toBe(createMemberAvatar(identity));
      expect(image?.getAttribute("alt")).toBe("");
      expect(host.innerHTML).not.toContain("SoftPanel");
      expect(host.querySelector("[data-slei-panel]")).toBeNull();
    } finally {
      cleanupMemberAvatar(root, host);
    }
  });

  it("uses the explicit avatar initials as fallback while preserving the large size marker", async () => {
    installImageMock("error");
    const identity: MemberAvatarIdentity = {
      avatar: "ZX",
      handle: "zhao",
      id: "member-2",
      name: "Zhao Xin",
    };

    const { host, root } = await renderMemberAvatar(<MemberAvatar identity={identity} large />);

    try {
      const avatar = host.querySelector<HTMLElement>('[data-slot="avatar"]');
      const fallback = host.querySelector<HTMLElement>('[data-slot="avatar-fallback"]');

      expect(avatar?.getAttribute("data-avatar-size")).toBe("large");
      expect(avatar?.getAttribute("data-avatar-image-rendering")).toBe("pixelated");
      expect(fallback).not.toBeNull();
      expect(fallback?.textContent).toBe("ZX");
      expect(host.querySelector("[data-slei-panel]")).toBeNull();
    } finally {
      cleanupMemberAvatar(root, host);
    }
  });

  it("falls back to uppercased member name initials when no avatar text is provided", async () => {
    installImageMock("error");
    const identity: MemberAvatarIdentity = {
      handle: "qing",
      id: "member-3",
      name: "qing lu",
    } as MemberAvatarIdentity;

    const { host, root } = await renderMemberAvatar(<MemberAvatar identity={identity} />);

    try {
      const fallback = host.querySelector<HTMLElement>('[data-slot="avatar-fallback"]');

      expect(fallback).not.toBeNull();
      expect(fallback?.textContent).toBe("QI");
      expect(host.innerHTML).not.toContain("SoftPanel");
      expect(host.querySelector("[data-slei-panel]")).toBeNull();
    } finally {
      cleanupMemberAvatar(root, host);
    }
  });
});
