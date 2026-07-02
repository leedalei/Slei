// @vitest-environment jsdom
import { act } from "react";
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

  await act(async () => {
    mountedRoot?.render(
      <SettingsOverlay
        activePanel="account"
        messages={messages}
        onClose={onClose}
        onPanelChange={onPanelChange}
        renderDetail={(panel) => <section data-testid={`detail-${panel}`}>{panel}</section>}
        {...overrides}
      />,
    );
  });
  await act(async () => undefined);

  return { container: mountedContainer, onClose, onPanelChange };
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
  it("renders a continuous full-page settings layout with left nav and right detail", async () => {
    const { container } = await mountOverlay();
    const nav = container.querySelector('[data-testid="slei-settings-overlay-nav"]');
    const detail = container.querySelector('[data-testid="slei-settings-overlay-detail"]');

    expect(container.querySelector('[data-testid="slei-settings-overlay"]')?.getAttribute("data-settings-overlay-layout")).toBe("continuous");
    expect(nav?.getAttribute("data-settings-nav-surface")).toBe("workspace-sidebar-bg");
    expect(nav?.className).toContain("bg-[var(--workspace-sidebar-bg)]");
    expect(nav?.className).not.toContain("border-r");
    expect(detail?.getAttribute("data-settings-detail-surface")).toBe("right-raised-left-shadow");
    expect(detail?.getAttribute("data-settings-divider-shadow")).toBe("casts-left");
    expect(detail?.className).toContain("bg-[var(--workspace-glass-bg)]");
    expect(detail?.className).toContain("border-l");
    expect(detail?.className).toContain("shadow-[-12px_0_24px_-18px_rgba(15,23,42,0.16)]");
  });

  it("groups settings entries and renders account detail by default", async () => {
    const { container } = await mountOverlay();

    expect(container.textContent).toContain("个人");
    expect(container.textContent).toContain("工作区");
    expect(container.textContent).toContain("系统");
    expect(container.querySelector('[data-testid="detail-account"]')).toBeTruthy();
  });

  it("places the return-to-chat control in the native chrome row without rendering settings search", async () => {
    const { container } = await mountOverlay();
    const returnButton = container.querySelector<HTMLButtonElement>('[data-testid="slei-settings-return"]');

    expect(returnButton?.textContent).toContain("返回聊天");
    expect(returnButton?.getAttribute("data-settings-return-placement")).toBe("top-right");
    expect(returnButton?.querySelector('[data-slei-icon="arrowLeft"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="slei-settings-overlay-chrome"]')?.getAttribute("data-settings-chrome-align")).toBe("native-controls-center");
    expect(container.querySelector('input[role="searchbox"]')).toBeNull();
    expect(container.textContent).not.toContain("搜索设置");
  });

  it("marks the active nav item as the current page", async () => {
    const { container } = await mountOverlay({ activePanel: "devices" });

    expect(buttonByText(container, "设备列表").getAttribute("aria-current")).toBe("page");
    expect(buttonByText(container, "账号资料").getAttribute("aria-current")).toBeNull();
  });

  it("calls onClose exactly once when returning to chat", async () => {
    const { container, onClose } = await mountOverlay();

    await act(async () => {
      buttonByText(container, "返回聊天").click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders members and devices as expandable workspace menus with list children", async () => {
    const { container } = await mountOverlay();

    const membersMenu = buttonByText(container, "成员管理");
    const devicesMenu = buttonByText(container, "设备管理");

    expect(membersMenu.getAttribute("aria-expanded")).toBe("true");
    expect(devicesMenu.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-settings-submenu="members"]')).toBeTruthy();
    expect(container.querySelector('[data-settings-submenu="devices"]')).toBeTruthy();
    expect(buttonByText(container, "成员列表")).toBeTruthy();
    expect(buttonByText(container, "设备列表")).toBeTruthy();
  });

  it("calls onPanelChange when a nav item is clicked", async () => {
    const { container, onPanelChange } = await mountOverlay();

    await act(async () => {
      buttonByText(container, "设备列表").click();
    });

    expect(onPanelChange).toHaveBeenCalledWith("devices");
    expect(onPanelChange).toHaveBeenCalledTimes(1);
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
