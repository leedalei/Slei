// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import { SettingsPage } from "./SettingsPageView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const localNode: DesktopNodeView = {
  id: "local-node",
  name: "Local",
  status: "connected",
  daemonVersion: "0.1.0",
  device: { platform: "darwin", arch: "arm64", hostname: "local" },
  runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
};

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

async function mountSettingsPage(element: React.ReactElement) {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount();
    });
    mountedContainer?.remove();
  }
  mountedContainer = document.createElement("div");
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  await act(async () => {
    mountedRoot?.render(element);
  });
  await act(async () => undefined);
  return mountedContainer;
}

function inputByLabel(root: HTMLElement, label: string) {
  const input = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`Missing input labeled ${label}`);
  return input;
}

async function uploadFile(input: HTMLInputElement, file: File) {
  await act(async () => {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => undefined);
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
});

describe("SettingsPage header", () => {
  it("makes the settings panel header draggable and text unselectable", () => {
    const messages = createDesktopMessages("en-US");
    const html = renderToStaticMarkup(
      <SettingsPage
        activePanel="language-region"
        appearance={{ theme: "system", fontSize: "md" }}
        locale="en-US"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        profile={null}
        timeZone="America/Los_Angeles"
      />,
    );
    const markerStart = html.indexOf('data-testid="slei-settings-panel-header"');
    const headerStart = html.lastIndexOf("<header", markerStart);
    const headerEnd = html.indexOf("</header>", markerStart);
    const headerHtml = html.slice(headerStart, headerEnd);

    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(html).toContain("data-slei-page-header");
    expect(headerHtml).toContain('data-tauri-drag-region="deep"');
    expect(headerHtml).toContain("select-none");
    expect(headerHtml).toContain("Language");
    expect(headerHtml).toContain("Region");
    expect(headerHtml).not.toContain('data-slot="badge"');
    expect(headerHtml).not.toContain(">Settings<");
  });

  it("uses card surfaces and preference rows for settings rows", () => {
    const messages = createDesktopMessages("en-US");
    const notificationsHtml = renderToStaticMarkup(
      <SettingsPage
        activePanel="notifications"
        appearance={{ theme: "system", fontSize: "md" }}
        locale="en-US"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        profile={null}
        timeZone="America/Los_Angeles"
      />,
    );
    const aboutHtml = renderToStaticMarkup(
      <SettingsPage
        activePanel="about"
        appearance={{ theme: "system", fontSize: "md" }}
        locale="en-US"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        profile={null}
        timeZone="America/Los_Angeles"
      />,
    );

    expect(notificationsHtml).toContain('data-slot="card"');
    expect(notificationsHtml).toContain('data-slot="card-content"');
    expect(notificationsHtml).toContain("bg-[var(--settings-section-bg)]");
    expect(notificationsHtml).toContain("border-[var(--settings-section-border)]");
    expect(notificationsHtml).toContain("data-slei-preference-row");
    expect(notificationsHtml).toContain('data-settings-notification="mentions"');
    expect(aboutHtml).toContain('data-slot="card"');
    expect(aboutHtml).toContain('data-slot="card-content"');
    expect(aboutHtml).toContain("bg-[var(--settings-section-bg)]");
    expect(aboutHtml).toContain("border-[var(--settings-section-border)]");
    expect(aboutHtml).toContain('data-settings-about-row="desktopVersion"');
  });

  it("renders about value tags without status dots or status metadata", () => {
    const messages = createDesktopMessages("en-US");
    const html = renderToStaticMarkup(
      <SettingsPage
        activePanel="about"
        appearance={{ theme: "system", fontSize: "md" }}
        locale="en-US"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        profile={null}
        timeZone="America/Los_Angeles"
      />,
    );

    expect(html.match(/data-slot="badge"/g)?.length).toBe(3);
    expect(html).not.toContain('data-slot="status-badge-dot"');
    expect(html).toContain('data-settings-about-row="desktopVersion"');
    expect(html).toContain('data-settings-about-row="daemonVersion"');
    expect(html).toContain('data-settings-about-row="connectedComputers"');
    expect(html).not.toContain("data-slei-status");
    expect(html).not.toContain("data-status");
  });

  it("uses a 12px vertical rhythm between settings controls across panels", () => {
    const messages = createDesktopMessages("zh-CN");
    const shared = {
      appearance: { theme: "light", fontSize: "md" } as const,
      locale: "zh-CN" as const,
      messages,
      nodes: [localNode],
      notifications: { approvals: true, humanReplies: false, mentions: true },
      profile: { displayName: "Lei", handle: "lei", avatar: "pixel-sun" },
      timeZone: "Asia/Shanghai",
    };

    for (const activePanel of ["language-region", "appearance", "notifications", "about"] as const) {
      const html = renderToStaticMarkup(<SettingsPage {...shared} activePanel={activePanel} />);
      const stackMarker = 'data-settings-control-stack="true"';
      const stackStart = html.indexOf(stackMarker);
      const stackOpenTagStart = html.lastIndexOf("<", stackStart);
      const stackOpenTagEnd = html.indexOf(">", stackStart);
      const stackOpenTag = html.slice(stackOpenTagStart, stackOpenTagEnd);

      expect(stackStart).toBeGreaterThanOrEqual(0);
      expect(stackOpenTag).toContain("grid gap-3");
      expect(stackOpenTag).not.toContain("grid gap-1");
      expect(stackOpenTag).not.toContain("grid gap-5");
    }
  });

  it("keeps panel titles and descriptions only in the page header", () => {
    const messages = createDesktopMessages("zh-CN");
    const shared = {
      appearance: { theme: "light", fontSize: "md" } as const,
      locale: "zh-CN" as const,
      messages,
      nodes: [localNode],
      notifications: { approvals: true, humanReplies: false, mentions: true },
      profile: { displayName: "Lei", handle: "lei", avatar: "pixel-sun" },
      timeZone: "Asia/Shanghai",
    };

    for (const activePanel of ["account", "language-region", "appearance", "notifications", "about"] as const) {
      const html = renderToStaticMarkup(<SettingsPage {...shared} activePanel={activePanel} />);
      const headerStart = html.indexOf('data-testid="slei-settings-panel-header"');
      const headerEnd = html.indexOf("</header>", headerStart);
      const headerHtml = html.slice(headerStart, headerEnd);

      expect(html).toContain("data-slei-page-header");
      expect(headerHtml).toContain(messages.settings.panelTitle[activePanel]);
      expect(headerHtml).toContain(messages.settings.panelSubtitle[activePanel]);
      expect(html).not.toContain('data-slot="card-header"');
      expect(html).not.toContain('data-slot="card-title"');
      expect(html).not.toContain('data-slot="card-description"');
    }
  });

  it("submits immediate setting changes from rendered controls", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onAppearanceChange = vi.fn();
    const appearanceContainer = await mountSettingsPage(
      <SettingsPage
        activePanel="appearance"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onAppearanceChange={onAppearanceChange}
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    await act(async () => {
      appearanceContainer.querySelector<HTMLButtonElement>('[data-settings-theme-option="dark"]')?.click();
    });
    await act(async () => undefined);

    expect(onAppearanceChange).toHaveBeenCalledWith({ theme: "dark", fontSize: "md" });

    await act(async () => {
      appearanceContainer.querySelector<HTMLButtonElement>("[data-settings-font-size-option='lg']")?.click();
    });
    await act(async () => undefined);

    expect(onAppearanceChange).toHaveBeenCalledWith({ theme: "light", fontSize: "lg" });

    const onNotificationsChange = vi.fn();
    const notificationsContainer = await mountSettingsPage(
      <SettingsPage
        activePanel="notifications"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onNotificationsChange={onNotificationsChange}
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    await act(async () => {
      notificationsContainer.querySelector<HTMLButtonElement>("#settings-notification-humanReplies")?.click();
    });
    await act(async () => undefined);

    expect(onNotificationsChange).toHaveBeenCalledWith({ approvals: true, humanReplies: true, mentions: true });

    const onProfileChange = vi.fn();
    const profileContainer = await mountSettingsPage(
      <SettingsPage
        activePanel="account"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onProfileChange={onProfileChange}
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    await act(async () => {
      profileContainer.querySelector<HTMLButtonElement>('[data-settings-avatar-option="pixel-moon"]')?.click();
    });
    await act(async () => undefined);

    expect(onProfileChange).toHaveBeenCalledWith({ avatar: "pixel-moon" });
  });

  it("renders a localized avatar upload control in the account panel", async () => {
    const messages = createDesktopMessages("zh-CN");
    const root = await mountSettingsPage(
      <SettingsPage
        activePanel="account"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onProfileAvatarUpload={vi.fn()}
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(inputByLabel(root, "上传头像图片")).toBeTruthy();
    expect(root.textContent).toContain("上传头像图片");
  });

  it("calls onProfileAvatarUpload when a valid image is selected", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onProfileAvatarUpload = vi.fn().mockResolvedValue(undefined);
    const root = await mountSettingsPage(
      <SettingsPage
        activePanel="account"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onProfileAvatarUpload={onProfileAvatarUpload}
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );
    const validPngBytes = Uint8Array.from([137, 80, 78, 71]);
    const file = new File([validPngBytes], "avatar.png", { type: "image/png" });

    await uploadFile(inputByLabel(root, "上传头像图片"), file);

    expect(onProfileAvatarUpload).toHaveBeenCalledWith(file);
  });

  it("disables avatar upload while the avatar profile field is pending", async () => {
    const messages = createDesktopMessages("zh-CN");
    const root = await mountSettingsPage(
      <SettingsPage
        activePanel="account"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onProfileAvatarUpload={vi.fn()}
        pendingProfileField="avatar"
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(inputByLabel(root, "上传头像图片").disabled).toBe(true);
  });

  it("disables avatar upload while the display name profile field is pending", async () => {
    const messages = createDesktopMessages("zh-CN");
    const root = await mountSettingsPage(
      <SettingsPage
        activePanel="account"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onProfileAvatarUpload={vi.fn()}
        pendingProfileField="displayName"
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(inputByLabel(root, "上传头像图片").disabled).toBe(true);
  });

  it("renders the avatar upload trigger as a focusable button", async () => {
    const messages = createDesktopMessages("zh-CN");
    const root = await mountSettingsPage(
      <SettingsPage
        activePanel="account"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onProfileAvatarUpload={vi.fn()}
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );
    const button = root.querySelector<HTMLButtonElement>('button[data-settings-avatar-upload-trigger="true"]');

    expect(button?.textContent).toContain("上传头像图片");
    expect(button?.disabled).toBe(false);
    button?.focus();
    expect(document.activeElement).toBe(button);
  });

  it("keeps account profile controls available when profile data is not loaded yet", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onProfileChange = vi.fn();
    const onProfileAvatarUpload = vi.fn();
    const root = await mountSettingsPage(
      <SettingsPage
        activePanel="account"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={messages}
        nodes={[localNode]}
        notifications={{ approvals: true, humanReplies: false, mentions: true }}
        onProfileAvatarUpload={onProfileAvatarUpload}
        onProfileChange={onProfileChange}
        profile={null}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(root.textContent).not.toContain("账户资料暂不可用");
    expect(root.textContent).toContain("显示名称");
    expect(root.textContent).toContain("@local");
    expect(root.querySelector<HTMLButtonElement>('button[data-settings-avatar-upload-trigger="true"]')?.disabled).toBe(false);
    expect(root.querySelector('input[aria-label="上传头像图片"]:not(:disabled)')).toBeTruthy();
  });
});
