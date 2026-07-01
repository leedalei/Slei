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
  it("keeps createMemberAvatar returning a safe image string for invalid profile image refs", () => {
    const identity: MemberAvatarIdentity = {
      avatar: "profile-image:nothex.png",
      handle: "@lei",
      id: "human-invalid-profile-image",
      name: "Lei Zhang",
    };

    const src = createMemberAvatar(identity);

    expect(src).toMatch(/^data:image\/svg\+xml/);
    expect(src).not.toContain("profile-image:");
  });

  it("preserves legacy DiceBear seed priority for pixel avatar values", () => {
    const identity: MemberAvatarIdentity = {
      avatar: "pixel-sun",
      handle: "@pixel",
      id: "member-pixel",
      name: "Pixel Sun",
    };

    expect(createMemberAvatar(identity)).toBe(createMemberAvatar({ ...identity, avatar: "" }));
  });

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
      expect(host.querySelector("[data-slei-panel]")).toBeNull();
    } finally {
      cleanupMemberAvatar(root, host);
    }
  });

  it("renders profile image avatar refs through the slei-avatar protocol without pixelated rendering", async () => {
    installImageMock("loaded");
    const ref = `profile-image:${"a".repeat(64)}.png`;
    const identity: MemberAvatarIdentity = {
      avatar: ref,
      handle: "@lei",
      id: "human",
      name: "Lei",
    };

    const { host, root } = await renderMemberAvatar(<MemberAvatar identity={identity} />);

    try {
      const avatar = host.querySelector<HTMLElement>('[data-slot="avatar"]');
      const image = host.querySelector<HTMLImageElement>('[data-slot="avatar-image"]');

      expect(avatar?.getAttribute("data-avatar-image-rendering")).toBe("auto");
      expect(image).not.toBeNull();
      expect(image?.getAttribute("src")).toBe(
        "slei-avatar:///aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      );
      expect(image?.className).not.toContain("[image-rendering:pixelated]");
    } finally {
      cleanupMemberAvatar(root, host);
    }
  });

  it.each(["profile-image:nothex.png", "profile-image:../x.png"])(
    "uses initials fallback for invalid profile image avatar ref %s",
    async (avatar) => {
      installImageMock("loaded");
      const identity: MemberAvatarIdentity = {
        avatar,
        handle: "@lei",
        id: "human-invalid-profile-image",
        name: "Lei Zhang",
      };

      const { host, root } = await renderMemberAvatar(<MemberAvatar identity={identity} />);

      try {
        const fallback = host.querySelector<HTMLElement>('[data-slot="avatar-fallback"]');
        const avatarRoot = host.querySelector<HTMLElement>('[data-slot="avatar"]');
        const image = host.querySelector<HTMLImageElement>('[data-slot="avatar-image"]');

        expect(avatarRoot?.getAttribute("data-avatar-image-rendering")).toBe("fallback");
        expect(image).toBeNull();
        expect(fallback).not.toBeNull();
        expect(fallback?.textContent).toBe("LE");
        expect(host.innerHTML).not.toContain("profile-image:");
        expect(host.textContent).not.toContain("profile-image:");
        expect(host.querySelector<HTMLImageElement>('img[src*="profile-image:"]')).toBeNull();
      } finally {
        cleanupMemberAvatar(root, host);
      }
    },
  );

  it("uses a tight global avatar shadow no larger than 3px blur", async () => {
    installImageMock("loaded");
    const identity: MemberAvatarIdentity = {
      avatar: "LW",
      avatarSeed: "lin-wen-shadow",
      handle: "lin",
      id: "member-shadow",
      name: "Lin Wen",
    };

    const { host, root } = await renderMemberAvatar(<MemberAvatar identity={identity} />);

    try {
      const avatar = host.querySelector<HTMLElement>('[data-slot="avatar"]');

      expect(avatar?.className).toContain("shadow-[0_1px_3px_rgba(0,0,0,0.14)]");
      expect(avatar?.className).not.toContain("shadow-[0_2px_6px");
      expect(avatar?.className).not.toContain("shadow-[0_4px_16px");
    } finally {
      cleanupMemberAvatar(root, host);
    }
  });

  it("does not render the decorative gradient glow behind member portraits", async () => {
    installImageMock("loaded");
    const identity: MemberAvatarIdentity = {
      avatar: "YG",
      avatarSeed: "yeal-glow-check",
      handle: "yeal",
      id: "member-glow-check",
      name: "Yeal",
    };

    const { host, root } = await renderMemberAvatar(<MemberAvatar identity={identity} />);

    try {
      expect(host.querySelector('[class*="bg-linear-to-r"]')).toBeNull();
      expect(host.querySelector('[class*="blur-md"]')).toBeNull();
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

  it("renders the small avatar size at 16 pixels for compact message rows", async () => {
    installImageMock("loaded");
    const identity: MemberAvatarIdentity = {
      avatar: "LW",
      avatarSeed: "lin-wen-small",
      handle: "lin",
      id: "member-small",
      name: "Lin Wen",
    };

    const { host, root } = await renderMemberAvatar(<MemberAvatar identity={identity} size="small" />);

    try {
      const avatar = host.querySelector<HTMLElement>('[data-slot="avatar"]');

      expect(avatar?.getAttribute("data-avatar-size")).toBe("small");
      expect(avatar?.className.split(/\s+/)).toContain("size-[16px]");
      expect(avatar?.className.split(/\s+/)).not.toContain("size-8");
      expect(avatar?.className.split(/\s+/)).not.toContain("size-16");
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
      expect(host.querySelector("[data-slei-panel]")).toBeNull();
    } finally {
      cleanupMemberAvatar(root, host);
    }
  });
});
