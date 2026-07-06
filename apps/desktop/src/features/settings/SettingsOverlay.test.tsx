// @vitest-environment jsdom
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { SettingsDetailHost, SettingsOverlay } from "./SettingsOverlay";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const messages = createDesktopMessages("zh-CN");

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

async function mountOverlay(overrides: Partial<Parameters<typeof SettingsOverlay>[0]> = {}) {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount();
    });
    mountedContainer?.remove();
  }

  mountedContainer = document.createElement("div");
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  const onClose = vi.fn();
  const onPanelChange = vi.fn();
  const onMemberItemSelect = vi.fn();
  const onDeviceItemSelect = vi.fn();

  await act(async () => {
    mountedRoot?.render(
      <SettingsOverlay
        activePanel="account"
        activeDeviceId="node-local"
        activeMemberId="agent-yeal"
        deviceItems={[
          { id: "node-local", label: "Mac Studio", description: "local" },
          { id: "node-lab", label: "Lab Mini", description: "lab" },
        ]}
        memberItems={[
          { id: "agent-yeal", label: "Yeal", description: "@yeal" },
          { id: "agent-theo", label: "Theo", description: "@theo" },
        ]}
        messages={messages}
        onClose={onClose}
        onDeviceItemSelect={onDeviceItemSelect}
        onMemberItemSelect={onMemberItemSelect}
        onPanelChange={onPanelChange}
        renderDetail={(panel) => <section data-testid={`detail-${panel}`}>{panel}</section>}
        {...overrides}
      />,
    );
  });
  await act(async () => undefined);

  return { container: mountedContainer, onClose, onDeviceItemSelect, onMemberItemSelect, onPanelChange };
}

function buttonByText(root: HTMLElement, text: string) {
  const button = Array.from(root.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Missing button with text ${text}`);
  return button;
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

describe("SettingsOverlay", () => {
  it("uses separate slide timings for the sidebar and detail panels", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(appCss).toContain("--settings-sidebar-motion-dur: 500ms;");
    expect(appCss).toContain("--settings-detail-motion-dur: 750ms;");
    expect(appCss).toContain(
      "animation: slei-settings-nav-enter var(--settings-sidebar-motion-dur) var(--settings-overlay-motion-ease) both;",
    );
    expect(appCss).toContain(
      "animation: slei-settings-detail-enter var(--settings-detail-motion-dur) var(--settings-overlay-motion-ease) both;",
    );
  });

  it("renders settings as the same two-card split layout as the app shell", async () => {
    const { container } = await mountOverlay();
    const overlay = container.querySelector('[data-testid="slei-settings-overlay"]');
    const nav = container.querySelector('[data-testid="slei-settings-overlay-nav"]');
    const detail = container.querySelector('[data-testid="slei-settings-overlay-detail"]');

    expect(overlay?.getAttribute("data-settings-overlay-layout")).toBe("split-cards");
    expect(overlay?.getAttribute("data-settings-motion")).toBe("enter");
    expect(overlay?.className).toContain("absolute");
    expect(overlay?.className).not.toContain("fixed");
    expect(overlay?.firstElementChild?.getAttribute("data-testid")).toBe("slei-settings-overlay-content");
    expect(container.querySelector('[data-testid="slei-settings-overlay-content"]')).toBeTruthy();
    expect(nav?.getAttribute("data-settings-nav-surface")).toBe("settings-sidebar-card");
    expect(nav?.className).toContain("slei-settings-overlay-card");
    expect(nav?.className).toContain("slei-settings-overlay-nav-card");
    expect(nav?.className).toContain("bg-[var(--settings-sidebar-bg)]");
    expect(detail?.getAttribute("data-settings-detail-surface")).toBe("settings-detail-card");
    expect(detail?.getAttribute("data-settings-divider-shadow")).toBeNull();
    expect(detail?.className).toContain("slei-settings-overlay-card");
    expect(detail?.className).toContain("slei-settings-overlay-detail-card");
    expect(detail?.className).toContain("bg-[var(--settings-detail-bg)]");
    expect(detail?.className).not.toContain("border-l");
  });

  it("groups settings entries and renders account detail by default", async () => {
    const { container } = await mountOverlay();

    expect(container.textContent).toContain("个人");
    expect(container.textContent).toContain("工作区");
    expect(container.textContent).toContain("系统");
    expect(container.querySelector('[data-testid="detail-account"]')).toBeTruthy();
  });

  it("places the return-to-chat control in the bottom settings slot without rendering settings search", async () => {
    const { container } = await mountOverlay();
    const footer = container.querySelector('[data-testid="slei-settings-overlay-footer"]');
    const footerLabel = container.querySelector('[data-testid="slei-settings-overlay-footer-label"]');
    const returnButton = container.querySelector<HTMLButtonElement>('[data-testid="slei-settings-return"]');

    expect(footer).toBeTruthy();
    expect(footerLabel?.textContent).toBe("设置");
    expect(returnButton?.textContent).toContain("返回聊天");
    expect(returnButton?.getAttribute("data-settings-return-placement")).toBe("bottom-settings-slot");
    expect(returnButton?.querySelector('[data-slei-icon="arrowLeft"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="slei-settings-overlay-chrome"]')).toBeNull();
    expect(container.querySelector('input[role="searchbox"]')).toBeNull();
    expect(container.textContent).not.toContain("搜索设置");
  });

  it("marks the active real device nav item as the current page", async () => {
    const { container } = await mountOverlay({ activePanel: "devices", activeDeviceId: "node-lab" });

    expect(buttonByText(container, "Lab Mini").getAttribute("aria-current")).toBe("page");
    expect(buttonByText(container, "账号资料").getAttribute("aria-current")).toBeNull();
  });

  it("uses the workspace sidebar active background for selected settings nav items", async () => {
    const accountOverlay = await mountOverlay();
    const accountButton = buttonByText(accountOverlay.container, "账号资料");

    expect(accountButton.className).toContain("bg-[var(--workspace-sidebar-active-bg)]");
    expect(accountButton.classList.contains("bg-accent")).toBe(false);
    expect(accountButton.classList.contains("text-accent-foreground")).toBe(false);

    const deviceOverlay = await mountOverlay({ activePanel: "devices", activeDeviceId: "node-lab" });
    const activeDeviceButton = buttonByText(deviceOverlay.container, "Lab Mini");

    expect(activeDeviceButton.className).toContain("bg-[var(--workspace-sidebar-active-bg)]");
    expect(activeDeviceButton.classList.contains("bg-accent")).toBe(false);
    expect(activeDeviceButton.classList.contains("text-accent-foreground")).toBe(false);
  });

  it("calls onClose exactly once when returning to chat", async () => {
    const { container, onClose } = await mountOverlay();

    await act(async () => {
      buttonByText(container, "返回聊天").click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders real members and devices as expandable workspace menu children", async () => {
    const { container } = await mountOverlay();

    const membersMenu = buttonByText(container, "成员管理");
    const devicesMenu = buttonByText(container, "设备管理");

    expect(membersMenu.getAttribute("aria-expanded")).toBe("true");
    expect(devicesMenu.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-settings-submenu="members"]')).toBeTruthy();
    expect(container.querySelector('[data-settings-submenu="devices"]')).toBeTruthy();
    expect(buttonByText(container, "Yeal")).toBeTruthy();
    expect(buttonByText(container, "Theo")).toBeTruthy();
    expect(buttonByText(container, "Mac Studio")).toBeTruthy();
    expect(buttonByText(container, "Lab Mini")).toBeTruthy();
    expect(container.textContent).not.toContain("成员列表");
    expect(container.textContent).not.toContain("设备列表");
  });

  it("aligns workspace child labels with parent labels", async () => {
    const { container } = await mountOverlay();

    const memberItem = container.querySelector<HTMLButtonElement>('[data-settings-submenu="members"] button');

    expect(memberItem?.className).toContain("pl-9");
    expect(memberItem?.className).not.toContain("ml-6");
  });

  it("calls onPanelChange and item selection when a real workspace child is clicked", async () => {
    const { container, onDeviceItemSelect, onMemberItemSelect, onPanelChange } = await mountOverlay();

    await act(async () => {
      buttonByText(container, "Theo").click();
    });

    expect(onPanelChange).toHaveBeenCalledWith("members");
    expect(onMemberItemSelect).toHaveBeenCalledWith("agent-theo");

    await act(async () => {
      buttonByText(container, "Lab Mini").click();
    });

    expect(onPanelChange).toHaveBeenCalledWith("devices");
    expect(onDeviceItemSelect).toHaveBeenCalledWith("node-lab");
  });

  it("hosts the members detail panel by panel key", async () => {
    const { container } = await mountOverlay({
      activePanel: "members",
      renderDetail: (panel) => (
        <SettingsDetailHost
          panel={panel}
          renderAbout={() => <section data-testid="host-about">about</section>}
          renderAccount={() => <section data-testid="host-account">account</section>}
          renderDevices={() => <section data-testid="host-devices">devices</section>}
          renderMembers={() => <section data-testid="host-members">members</section>}
          renderPreferences={() => <section data-testid="host-preferences">preferences</section>}
        />
      ),
    });

    expect(container.querySelector('[data-testid="host-members"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="host-devices"]')).toBeNull();
  });

  it("hosts the devices detail panel by panel key", async () => {
    const { container } = await mountOverlay({
      activePanel: "devices",
      renderDetail: (panel) => (
        <SettingsDetailHost
          panel={panel}
          renderAbout={() => <section data-testid="host-about">about</section>}
          renderAccount={() => <section data-testid="host-account">account</section>}
          renderDevices={() => <section data-testid="host-devices">devices</section>}
          renderMembers={() => <section data-testid="host-members">members</section>}
          renderPreferences={() => <section data-testid="host-preferences">preferences</section>}
        />
      ),
    });

    expect(container.querySelector('[data-testid="host-devices"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="host-members"]')).toBeNull();
  });
});
