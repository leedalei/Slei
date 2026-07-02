// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { SettingsOverlay } from "./SettingsOverlay";

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

async function search(root: HTMLElement, query: string) {
  const input = root.querySelector<HTMLInputElement>('input[role="searchbox"]');
  if (!input) throw new Error("Missing settings search input");

  await act(async () => {
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
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

describe("SettingsOverlay", () => {
  it("renders a continuous full-page settings layout with left nav and right detail", async () => {
    const { container } = await mountOverlay();

    expect(container.querySelector('[data-testid="slei-settings-overlay"]')?.getAttribute("data-settings-overlay-layout")).toBe("continuous");
    expect(container.querySelector('[data-testid="slei-settings-overlay-nav"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="slei-settings-overlay-detail"]')?.getAttribute("data-settings-detail-surface")).toBe("border-left-shadow-left");
  });

  it("groups settings entries and renders account detail by default", async () => {
    const { container } = await mountOverlay();

    expect(container.textContent).toContain("个人");
    expect(container.textContent).toContain("工作区");
    expect(container.textContent).toContain("系统");
    expect(container.querySelector('[data-testid="detail-account"]')).toBeTruthy();
  });

  it("calls onClose exactly once when returning to the app", async () => {
    const { container, onClose } = await mountOverlay();

    await act(async () => {
      buttonByText(container, "返回应用").click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps all workspace children visible when search matches the group label", async () => {
    const { container } = await mountOverlay();

    await search(container, "工作区");

    expect(container.textContent).toContain("工作区");
    expect(container.textContent).toContain("成员管理");
    expect(container.textContent).toContain("设备管理");
    expect(container.textContent).not.toContain("账号资料");
  });

  it("shows only matching children when search matches a child label", async () => {
    const { container } = await mountOverlay();

    await search(container, "设备");

    expect(container.textContent).toContain("工作区");
    expect(container.textContent).toContain("设备管理");
    expect(container.textContent).not.toContain("成员管理");
    expect(container.textContent).not.toContain("账号资料");
  });

  it("calls onPanelChange when a nav item is clicked", async () => {
    const { container, onPanelChange } = await mountOverlay();

    await act(async () => {
      buttonByText(container, "设备管理").click();
    });

    expect(onPanelChange).toHaveBeenCalledWith("devices");
    expect(onPanelChange).toHaveBeenCalledTimes(1);
  });
});
