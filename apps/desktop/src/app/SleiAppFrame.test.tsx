// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../i18n";
import { createDemoMembers, createSleiFixtures } from "../test/fixtures";
import type { DesktopAgentView } from "../lib/daemon-bridge";
import { memberFromAgentView } from "./SleiApp";
import { SleiAppFrame } from "./SleiAppFrame";
import type { SleiMessage } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};

const runtimeSetup = {
  loading: false,
  hasClaudeRuntimeReady: true,
  nodes: [],
};

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

async function mount(element: React.ReactElement) {
  mountedContainer = document.createElement("div");
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  await act(async () => {
    mountedRoot?.render(element);
  });
  await act(async () => undefined);
  return mountedContainer;
}

async function changeField(field: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  expect(field).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    setter?.call(field, value);
    field?.dispatchEvent(new Event("input", { bubbles: true }));
    field?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => undefined);
}

function inputByLabel(root: ParentNode, label: string) {
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

async function clickElement(element: Element | null | undefined) {
  expect(element).toBeInstanceOf(HTMLElement);
  const target = element as HTMLElement;
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, ctrlKey: false, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, ctrlKey: false }));
    target.click();
  });
  await act(async () => undefined);
}

const readyNodes = [{
  id: "local-node",
  name: "本机设备",
  status: "connected" as const,
  daemonVersion: "dev",
  device: { hostname: "local", platform: "darwin", arch: "arm64" },
  runtimes: [{ kind: "ClaudeCode", readiness: "ready" as const }],
}];

function currentDialog() {
  const dialog = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
  if (!dialog) throw new Error("Missing dialog content");
  return dialog;
}

function currentDialogSubmit() {
  const submit = currentDialog().querySelector<HTMLButtonElement>('form button[type="submit"]');
  if (!submit) throw new Error("Missing dialog submit");
  return submit;
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
  document.documentElement.classList.remove("dark", "light");
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("SleiAppFrame appearance preferences", () => {
  it("maps daemon working agent status to a busy sidebar member", () => {
    const agent: DesktopAgentView = {
      id: "agent_coda",
      name: "Coda",
      handle: "@coda",
      runtimeKind: "ClaudeCode",
      model: "Sonnet",
      nodeId: "local-node",
      description: "实现工程师。",
      workspacePath: "/tmp/coda",
      memoryPath: "/tmp/coda/MEMORY.md",
      docsPath: "/tmp/coda/docs",
      avatarSeed: "Coda",
      runtimeThread: {
        runtimeKind: "ClaudeCode",
        status: "working",
        createdAt: "2026-06-29T00:00:00Z",
      },
      createdAt: "2026-06-29T00:00:00Z",
      updatedAt: "2026-06-29T00:00:00Z",
    };

    const member = memberFromAgentView(agent, [{
      id: "local-node",
      name: "本机",
      status: "connected",
      daemonVersion: "dev",
      device: { hostname: "local", platform: "macos", arch: "arm64" },
      runtimes: [],
    }], createDesktopMessages("zh-CN"));

    expect(member.runtimeStatus).toBe("busy");
    expect(member.activity).toBe("正在处理任务线程回复");
  });

  it("wires the runtime toast close control to the prop-owned dismiss callback", async () => {
    const onRuntimeToastDismiss = vi.fn();
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        onRuntimeToastDismiss={onRuntimeToastDismiss}
        runtimeErrorToastMessage="运行时错误"
        runtimeSetup={runtimeSetup}
        runtimeToastType="error"
      />,
    );

    expect(container.querySelector('[data-slot="notification"]')?.textContent).toContain("运行时错误");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-slot="notification-close"]')?.click();
    });

    expect(onRuntimeToastDismiss).toHaveBeenCalledTimes(1);
  });

  it("syncs the font size preference to the document root and restores it on unmount", async () => {
    document.documentElement.style.fontSize = "13px";
    document.documentElement.style.setProperty("--app-font-size", "13px");
    document.documentElement.style.setProperty("--text-sm", "12px");

    const container = await mount(
      <SleiAppFrame
        activeView="settings"
        appearance={{ theme: "light", fontSize: "lg" }}
        data={createSleiFixtures()}
        initialSettingsPanel="appearance"
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(container.querySelector("[data-font-size='lg']")).not.toBeNull();
    expect(document.documentElement.style.fontSize).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--app-font-size")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("16px");

    await act(async () => {
      mountedRoot?.render(
        <SleiAppFrame
          activeView="settings"
          appearance={{ theme: "light", fontSize: "sm" }}
          data={createSleiFixtures()}
          initialSettingsPanel="appearance"
          locale="zh-CN"
          runtimeSetup={runtimeSetup}
        />,
      );
    });
    await act(async () => undefined);

    expect(document.documentElement.style.fontSize).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--app-font-size")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("12px");
    expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("14px");

    await act(async () => {
      mountedRoot?.unmount();
    });
    mountedRoot = undefined;

    expect(document.documentElement.style.fontSize).toBe("13px");
    expect(document.documentElement.style.getPropertyValue("--app-font-size")).toBe("13px");
    expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("12px");
  });

  it("updates tokens used by explicit text utility nodes", async () => {
    const container = await mount(
      <SleiAppFrame
        activeView="settings"
        appearance={{ theme: "light", fontSize: "lg" }}
        data={createSleiFixtures()}
        initialSettingsPanel="appearance"
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    const description = container.querySelector<HTMLElement>("[data-testid='slei-settings-panel-header'] p");

    expect(description).not.toBeNull();
    expect(description?.className).toContain("text-sm");
    expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("14px");
  });

  it("wires settings account avatar upload to the provided callback", async () => {
    const onProfileAvatarUpload = vi.fn().mockResolvedValue(undefined);
    const container = await mount(
      <SleiAppFrame
        activeView="settings"
        data={createSleiFixtures()}
        initialSettingsPanel="account"
        locale="zh-CN"
        onProfileAvatarUpload={onProfileAvatarUpload}
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        runtimeSetup={runtimeSetup}
      />,
    );
    const file = new File([Uint8Array.from([137, 80, 78, 71])], "avatar.png", { type: "image/png" });

    await uploadFile(inputByLabel(container, "上传头像图片"), file);

    expect(onProfileAvatarUpload).toHaveBeenCalledWith(file);
  });

  it("defaults to dark theme when appearance is omitted", async () => {
    document.documentElement.classList.remove("dark", "light");

    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("syncs dark and light theme classes to the document root so portal dialogs inherit tokens", async () => {
    document.documentElement.classList.remove("dark", "light");

    await mount(
      <SleiAppFrame
        activeView="chat"
        appearance={{ theme: "dark", fontSize: "md" }}
        data={createSleiFixtures()}
        initialCreateChannelModalOpen
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.body.querySelector('[data-slot="dialog-content"]')).not.toBeNull();

    await act(async () => {
      mountedRoot?.render(
        <SleiAppFrame
          activeView="chat"
          appearance={{ theme: "light", fontSize: "md" }}
          data={createSleiFixtures()}
          initialCreateChannelModalOpen
          locale="zh-CN"
          runtimeSetup={runtimeSetup}
        />,
      );
    });
    await act(async () => undefined);

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});

describe("SleiAppFrame agent creation modal", () => {
  it("renders split sections with avatar and hides the handle input", async () => {
    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        initialAgentCreateModalOpen
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: readyNodes }}
      />,
    );

    expect(document.body.textContent).toContain("运行环境");
    expect(document.body.textContent).toContain("成员信息");
    expect(document.body.querySelector("[data-agent-create-avatar]")).toBeTruthy();
    expect(document.body.querySelector("#slei-agent-handle")).toBeNull();
    expect(document.body.querySelector("#slei-agent-description")).toBeTruthy();
  });

  it("loads role presets, selects a card, and submits the preset description", async () => {
    const onAgentCreate = vi.fn();
    const onAgentRolePresetsLoad = vi.fn(async () => ({
      presets: [{ id: "teacher", title: "教师", description: "负责课程讲解和练习反馈。", sortOrder: 10 }],
    }));

    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        initialAgentCreateModalOpen
        locale="zh-CN"
        onAgentCreate={onAgentCreate}
        onAgentRolePresetsLoad={onAgentRolePresetsLoad}
        runtimeSetup={{ ...runtimeSetup, nodes: readyNodes }}
      />,
    );

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "教师助手");
    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-slot="radio-group-item"][value="preset"]')?.click();
    });
    await act(async () => undefined);

    const presetList = document.body.querySelector<HTMLElement>("[data-agent-preset-list]");
    expect(presetList?.className).toContain("max-h-72");
    expect(presetList?.className).toContain("overflow-y-auto");
    expect(document.body.textContent).toContain("教师");

    const presetCard = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("教师") && button.textContent?.includes("课程讲解"));
    await act(async () => {
      presetCard?.click();
    });
    expect(presetCard?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      currentDialogSubmit()?.click();
    });

    expect(onAgentCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "教师助手",
      handle: "@教师助手",
      description: "负责课程讲解和练习反馈。",
      avatarSeed: "agent-avatar-教师助手",
    }));
  });

  it("rejects invalid and duplicate names before submit", async () => {
    const onAgentCreate = vi.fn();
    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: createDemoMembers() })}
        initialAgentCreateModalOpen
        locale="zh-CN"
        onAgentCreate={onAgentCreate}
        runtimeSetup={{ ...runtimeSetup, nodes: readyNodes }}
      />,
    );

    expect(currentDialogSubmit()?.disabled).toBe(true);

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "系统 架构师");
    expect(document.body.textContent).toContain("名称不能包含空格或 -");
    expect(currentDialogSubmit()?.disabled).toBe(true);

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "Coda");
    expect(document.body.textContent).toContain("已有同名成员");
    expect(currentDialogSubmit()?.disabled).toBe(true);

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "一".repeat(33));
    expect(document.body.textContent).toContain("名称不能超过 32 个字符");
    expect(currentDialogSubmit()?.disabled).toBe(true);

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "系统架构师");
    expect(currentDialogSubmit()?.disabled).toBe(false);
  });

  it("refreshes the pixel avatar seed and submits it", async () => {
    const onAgentCreate = vi.fn();
    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        initialAgentCreateModalOpen
        locale="zh-CN"
        onAgentCreate={onAgentCreate}
        runtimeSetup={{ ...runtimeSetup, nodes: readyNodes }}
      />,
    );

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "法律研究员");
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-agent-create-avatar]")?.click();
    });
    await act(async () => {
      currentDialogSubmit()?.click();
    });

    expect(onAgentCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "法律研究员",
      handle: "@法律研究员",
      avatarSeed: "agent-avatar-法律研究员-1",
    }));
  });
});

describe("SleiAppFrame global search navigation", () => {
  it("renders the single workspace sidebar without the old primary rail", () => {
    const data = createSleiFixtures({
      members: createDemoMembers(),
      channels: [
        { id: "all", name: "all", description: "所有成员的默认频道", unread: 0, activeSessionId: "session:all" },
        { id: "dev", name: "dev", description: "研发频道描述", projectPaths: ["/workspace/dev"], unread: 2, activeSessionId: "session:dev" },
      ],
      conversations: [{ id: "dm:agent_coda", agentId: "a1", kind: "dm", activeSessionId: "session-dm-coda", createdAt: "0", updatedAt: "0" }],
    });
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).not.toContain("slei-shell-nav");
    expect(html).not.toContain("data-nav-icon");
    expect(html).toContain("slei-workspace-sidebar");
    expect(html).toContain("搜索");
    expect(html).toContain("任务");
    expect(html).toContain(">dev</");
    expect(html).toContain(">Coda</");
    expect(html).not.toContain("data-nav-icon=\"members\"");
    const host = document.createElement("div");
    host.innerHTML = html;
    const sidebarText = host.querySelector(".slei-workspace-sidebar")?.textContent ?? "";
    expect(sidebarText).not.toContain("关联项目：");
    expect(sidebarText).not.toContain("研发频道描述");
  });

  it("renders the top-left brand with the transparent bubble icon asset", async () => {
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );
    const brandIcon = container.querySelector<HTMLImageElement>(".slei-brand__icon");
    const asset = readFileSync(join(process.cwd(), "src/assets/brand/slei-bubble.svg"), "utf8");
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");

    expect(brandIcon).not.toBeNull();
    expect(brandIcon?.getAttribute("alt")).toBe("");
    expect(brandIcon?.getAttribute("src")).toMatch(/^(data:image\/svg\+xml|.*slei-bubble\.svg)/);
    expect(container.querySelector(".slei-brand__mark")).toBeNull();
    expect(sidebarSource).toContain("../assets/brand/slei-bubble.svg");
    expect(asset).toContain("<path");
    expect(asset).not.toContain("<rect");
    expect(asset).toContain('stop-color="#0B9C67"');
    expect(asset).toContain('stop-color="#16C78A"');
    expect(asset).toContain('fill="#A5F3FC"');
    expect(asset).toContain('fill="#C4B5FD"');
    expect(asset).toContain('fill="#FDA4AF"');
    expect(asset).toContain('stroke="#FFFFFF"');
    expect(asset).toContain('stroke-opacity="0.62"');
    expect(asset).toContain('fill-opacity="0.88"');
    expect(asset).toContain('r="2.55"');
    expect(asset).not.toContain('r="3.05"');
  });

  it("keeps the workspace sidebar visible for search", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="search"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('data-active-view="search"');
    expect(html).toContain("slei-workspace-sidebar");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("搜索");
  });

  it("keeps the workspace sidebar visible for tasks", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="tasks"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('data-active-view="tasks"');
    expect(html).toContain("slei-workspace-sidebar");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("任务");
  });

  it("uses the workspace sidebar grid without the old rail column", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('grid-template-columns:var(--app-sidebar-width, 15rem) 3px minmax(0, 1fr)');
    expect(html).not.toContain("5.25rem");
    expect(html).not.toContain("grid h-14 w-14 place-items-center");
  });

  it("routes bottom settings menu entries to existing views", async () => {
    const onViewChange = vi.fn();
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        onViewChange={onViewChange}
        runtimeSetup={runtimeSetup}
      />,
    );

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="打开设置菜单"]'));
    await clickElement(Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
      .find((item) => item.textContent?.includes("运行设备")));

    expect(onViewChange).toHaveBeenCalledWith("computers");
  });

  it("opens channel and DM context menus from pointer, keyboard, and row more buttons", async () => {
    const onMemberSelect = vi.fn();
    const onViewChange = vi.fn();
    const onConversationSelect = vi.fn();
    const data = createSleiFixtures({
      members: createDemoMembers(),
      channels: [
        { id: "all", name: "all", description: "所有成员的默认频道", unread: 0, activeSessionId: "session:all" },
        { id: "dev", name: "dev", description: "研发频道描述", unread: 0, activeSessionId: "session:dev" },
      ],
      conversations: [{ id: "dm:agent_coda", agentId: "a1", kind: "dm", activeSessionId: "session-dm-coda", createdAt: "0", updatedAt: "0" }],
    });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        onConversationSelect={onConversationSelect}
        onMemberSelect={onMemberSelect}
        onViewChange={onViewChange}
        runtimeSetup={runtimeSetup}
      />,
    );
    const devRow = container.querySelector<HTMLElement>('[data-testid="workspace-channel-row-dev"]');
    const allRow = container.querySelector<HTMLElement>('[data-testid="workspace-channel-row-all"]');
    const dmRow = container.querySelector<HTMLElement>('[data-testid="workspace-dm-row-agent_coda"]');

    expect(devRow).toBeTruthy();
    expect(allRow).toBeTruthy();
    expect(dmRow).toBeTruthy();

    await act(async () => {
      devRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain("编辑频道");
    expect(document.body.textContent).toContain("删除频道");

    await act(async () => {
      allRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain("编辑频道");
    expect(document.body.textContent).not.toContain("删除频道");

    await act(async () => {
      devRow?.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain("编辑频道");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="频道 dev 更多操作"]')?.click();
    });
    expect(document.body.textContent).toContain("编辑频道");

    await act(async () => {
      dmRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain("打开成员资料");
    expect(document.body.textContent).toContain("打开私聊");

    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
        .find((item) => item.textContent?.includes("打开成员资料"))
        ?.click();
    });
    expect(onMemberSelect).toHaveBeenCalledWith("a1");
    expect(onViewChange).toHaveBeenCalledWith("members");

    await act(async () => {
      dmRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
        .find((item) => item.textContent?.includes("打开私聊"))
        ?.click();
    });
    expect(onConversationSelect).toHaveBeenCalledWith("dm:agent_coda");
  });

  it("routes channel edit menu actions through the frame edit path", async () => {
    const onChannelEdit = vi.fn();
    const onChannelSelect = vi.fn();
    const onViewChange = vi.fn();
    const data = createSleiFixtures({
      channels: [
        { id: "ops", name: "ops", description: "运维频道描述", unread: 0, activeSessionId: "session:ops" },
        { id: "dev", name: "dev", description: "研发频道描述", projectPaths: ["/workspace/dev"], unread: 0, activeSessionId: "session:dev" },
      ],
    });
    const container = await mount(
      <SleiAppFrame
        activeChannelId="ops"
        activeView="tasks"
        data={data}
        locale="zh-CN"
        onChannelEdit={onChannelEdit}
        onChannelSelect={onChannelSelect}
        onViewChange={onViewChange}
        runtimeSetup={runtimeSetup}
      />,
    );
    const devRow = container.querySelector<HTMLElement>('[data-testid="workspace-channel-row-dev"]');

    await act(async () => {
      devRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
        .find((item) => item.textContent?.includes("编辑频道"))
        ?.click();
    });

    expect(onChannelEdit).toHaveBeenCalledWith("dev");
    expect(onChannelSelect).not.toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("falls back to selecting the channel and chat view when no edit callback is provided", async () => {
    const onChannelSelect = vi.fn();
    const onViewChange = vi.fn();
    const data = createSleiFixtures({
      channels: [
        { id: "ops", name: "ops", description: "运维频道描述", unread: 0, activeSessionId: "session:ops" },
        { id: "dev", name: "dev", description: "研发频道描述", projectPaths: ["/workspace/dev"], unread: 0, activeSessionId: "session:dev" },
      ],
    });
    const container = await mount(
      <SleiAppFrame
        activeChannelId="ops"
        activeView="tasks"
        data={data}
        locale="zh-CN"
        onChannelSelect={onChannelSelect}
        onViewChange={onViewChange}
        runtimeSetup={runtimeSetup}
      />,
    );

    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="workspace-channel-row-dev"]')
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
        .find((item) => item.textContent?.includes("编辑频道"))
        ?.click();
    });

    expect(onChannelSelect).toHaveBeenCalledWith("dev");
    expect(onViewChange).toHaveBeenCalledWith("chat");
  });

  it("confirms channel deletion from the workspace sidebar context menu", async () => {
    const onChannelDelete = vi.fn();
    const data = createSleiFixtures({
      channels: [
        { id: "all", name: "all", description: "所有成员的默认频道", unread: 0, activeSessionId: "session:all" },
        { id: "dev", name: "dev", description: "研发频道描述", unread: 0, activeSessionId: "session:dev" },
      ],
    });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        onChannelDelete={onChannelDelete}
        runtimeSetup={runtimeSetup}
      />,
    );
    const devRow = container.querySelector<HTMLElement>('[data-testid="workspace-channel-row-dev"]');
    const allRow = container.querySelector<HTMLElement>('[data-testid="workspace-channel-row-all"]');

    await act(async () => {
      allRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).not.toContain("删除频道");

    await act(async () => {
      devRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
        .find((item) => item.textContent?.includes("删除频道"))
        ?.click();
    });
    expect(onChannelDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("确定删除 #dev？");

    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-slot="alert-dialog-cancel"]')?.click();
    });
    expect(onChannelDelete).not.toHaveBeenCalled();

    await act(async () => {
      devRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
        .find((item) => item.textContent?.includes("删除频道"))
        ?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-slot="alert-dialog-action"]')?.click();
    });
    expect(onChannelDelete).toHaveBeenCalledWith("dev");
  });

  it("does not keep old primary navigation tooltip wiring in the app frame", () => {
    const source = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");

    expect(source).not.toContain("<nav ");
    expect(source).not.toContain('tooltipSide="right"');
  });

  it("keeps the workspace sidebar right divider as a single thin line", () => {
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const sidebarCss = appCss.slice(appCss.indexOf(".slei-workspace-sidebar {"), appCss.indexOf(".slei-workspace-sidebar__header {"));

    expect(sidebarSource).toContain("border-r border-sidebar-border/65");
    expect(sidebarCss).toContain("inset -1px 0 0 color-mix(in srgb, var(--sidebar-border) 56%, transparent)");
    expect(sidebarCss).not.toContain("inset -8px 0 18px");
  });

  it("keeps the workspace sidebar transparent while giving workspace a light glass fill", () => {
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const sidebarCss = appCss.slice(appCss.indexOf(".slei-workspace-sidebar {"), appCss.indexOf(".slei-glass-workspace {"));

    expect(appCss).toContain("--glass-bg:");
    expect(appCss).toContain("--glass-border:");
    expect(appCss).toContain("--glass-blur:");
    expect(appCss).toContain("--workspace-glass-bg: oklch(0.18 0.045 255 / 1)");
    expect(appCss).toContain("--workspace-glass-bg: oklch(0.955 0.003 220 / 1)");
    expect(appCss).toContain("--glass-surface-filter: blur(var(--glass-blur)) saturate(145%)");
    expect(appCss).toContain("--chrome-surface-filter: blur(6px) saturate(112%)");
    expect(sidebarSource).not.toContain("bg-sidebar/");
    expect(frameSource).not.toContain("bg-sidebar/");
    expect(sidebarCss).toContain("background: transparent");
    expect(sidebarCss).not.toContain("background: var(--glass-sidebar-bg)");
    expect(sidebarCss).toContain("-webkit-backdrop-filter: var(--chrome-surface-filter)");
    expect(sidebarCss).toContain("backdrop-filter: var(--chrome-surface-filter)");
    expect(sidebarCss).toContain('[data-slot="agent-activity"]');
    expect(sidebarCss).toContain("background: transparent");
  });

  it("keeps the native window and shell roots transparent so glass surfaces reveal apps behind Slei", () => {
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const cargoToml = readFileSync(join(process.cwd(), "src-tauri/Cargo.toml"), "utf8");
    const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
      app: {
        macOSPrivateApi?: boolean;
        windows: Array<{
          transparent?: boolean;
          backgroundColor?: [number, number, number, number];
          windowEffects?: { effects?: string[]; state?: string; radius?: number };
        }>;
      };
    };
    const tauriLib = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

    expect(cargoToml).toContain('tauri = { version = "2.11.2", features = ["macos-private-api"] }');
    expect(tauriConfig.app.macOSPrivateApi).toBe(true);
    expect(tauriConfig.app.windows[0]?.transparent).toBe(true);
    expect(tauriConfig.app.windows[0]?.backgroundColor).toEqual([0, 0, 0, 0]);
    expect(tauriConfig.app.windows[0]?.windowEffects).toEqual({
      effects: ["sidebar"],
      state: "active",
      radius: 0,
    });
    expect(tauriLib).toContain("configure_transparent_window");
    expect(tauriLib).toContain("webview_window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)))");
    expect(tauriLib).toContain("webview_window.set_effects(");
    expect(tauriLib).toContain(".effect(tauri::window::Effect::Sidebar)");
    expect(tauriLib).toContain(".state(tauri::window::EffectState::Active)");
    expect(tauriLib).toContain(".radius(0.)");
    expect(frameSource).not.toContain("overflow-hidden bg-background text-foreground");
    expect(frameSource).toContain("overflow-hidden bg-transparent text-foreground");
    expect(frameSource).not.toContain('className="slei-workspace min-h-0 min-w-0 overflow-hidden bg-background"');
    expect(frameSource).not.toContain('className="slei-workspace slei-glass-workspace min-h-0 min-w-0 overflow-hidden bg-transparent"');
    expect(frameSource).toContain('className="slei-workspace slei-glass-workspace min-h-0 min-w-0 overflow-visible bg-transparent"');
    expect(appCss).toContain(".slei-glass-workspace {");
    expect(appCss).toContain("backdrop-filter: var(--glass-surface-filter)");
    expect(appCss).toContain("--background: oklch(0.18 0.045 255 / 0.5)");
    expect(appCss).toContain("--background: oklch(0.94 0.006 220 / 0.5)");
    expect(appCss).toContain("body {\n  margin: 0;\n  min-width: 320px;\n  min-height: 100vh;\n  background: transparent;");
    expect(appCss).toContain("html,\n#app {\n  margin: 0;");
    expect(appCss).toContain("html,\n#app {\n  margin: 0;\n  min-width: 320px;\n  min-height: 100vh;\n  background: transparent;");
    expect(appCss).not.toContain("linear-gradient(to bottom right");
    expect(appCss).not.toContain("background: color-mix(in srgb, var(--background) 20%, transparent)");
    expect(appCss).toContain(".slei-glass-workspace {\n  -webkit-backdrop-filter: var(--glass-surface-filter);\n  backdrop-filter: var(--glass-surface-filter);\n  background: var(--workspace-glass-bg);");
    expect(appCss).not.toContain("#app {\n  background: var(--background)");
    expect(appCss).not.toContain("#root {");
  });

  it("keeps every workspace page root transparent so native glass remains visible", () => {
    const sourceFiles = [
      "src/app/SleiAppFrame.tsx",
      "src/features/search/SearchPageView.tsx",
      "src/features/tasks/TasksPageView.tsx",
      "src/features/computers/ComputersPageView.tsx",
      "src/features/settings/SettingsPageView.tsx",
      "src/features/chat/ChatPageView.tsx",
    ];

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(join(process.cwd(), sourceFile), "utf8");
      expect(source, sourceFile).not.toMatch(/<(main|section|aside)[^>]+className="[^"]*(?:h-full|min-h-0|grid h-full|flex h-full)[^"]*bg-background(?:\s|")/);
      expect(source, sourceFile).not.toMatch(/<(main|section|aside)[^>]+className="[^"]*bg-background(?:\s|")[^"]*(?:h-full|min-h-0|grid h-full|flex h-full)/);
    }
  });

  it("renders search and task actions as stable sidebar buttons without click ripple", () => {
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");

    expect(sidebarSource).toContain('onClick={() => input.onViewChange?.("search")}');
    expect(sidebarSource).toContain('onClick={() => input.onViewChange?.("tasks")}');
    expect(sidebarSource).not.toContain("ripple");
    expect(sidebarSource).not.toContain("rippleColor");
    expect(sidebarSource).toContain('variant={input.activeView === "search" ? "primary" : "outline"}');
    expect(sidebarSource).toContain('variant={input.activeView === "tasks" ? "primary" : "outline"}');
  });

  it("renders the active sidebar action as the einui primary button variant", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="search"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    const searchButtonIndex = html.indexOf('aria-current="page"');
    const searchButtonOpenTag = html.slice(html.lastIndexOf("<button", searchButtonIndex), html.indexOf(">", searchButtonIndex));

    expect(searchButtonOpenTag).toContain('data-variant="primary"');
    expect(searchButtonOpenTag).not.toContain("slei-shell-nav__button--flow");
  });

  it("keeps search and member icons available for sidebar and menu actions", () => {
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");
    const iconsSource = readFileSync(join(process.cwd(), "src/components/icons.tsx"), "utf8");

    expect(sidebarSource).toContain('name="search"');
    expect(sidebarSource).toContain('name="members"');
    expect(iconsSource).toContain("SearchCheck");
    expect(iconsSource).toContain("UsersRound");
    expect(iconsSource).toContain("searchFilled: SearchCheck");
    expect(iconsSource).toContain("membersFilled: UsersRound");
    expect(iconsSource).toContain("search: Search");
    expect(iconsSource).toContain("members: Users");
  });

  it("removes the old flowing gradient rail styling", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const buttonSource = readFileSync(join(process.cwd(), "src/components/ui/button.tsx"), "utf8");

    expect(appCss).toContain("--glass-button-primary-bg: var(--primary)");
    expect(appCss).not.toContain("--glass-button-primary-gradient-bg");
    expect(appCss).not.toContain('.slei-shell-nav__button--flow[data-variant="primary"]');
    expect(appCss).not.toContain("@keyframes slei-shell-nav-gradient-flow");
    expect(frameSource).not.toContain("slei-shell-nav__button--flow");
    expect(buttonSource).not.toContain("slei-shell-nav__button--flow");
  });

  it("keeps the accent token in the teal family instead of purple", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const accentDeclarations = Array.from(appCss.matchAll(/--accent:\s*oklch\(([^;]+)\);/g), (match) => match[1]);

    expect(accentDeclarations).toHaveLength(3);
    expect(accentDeclarations.every((value) => value.endsWith("185") || value.endsWith("190"))).toBe(true);
    expect(accentDeclarations.some((value) => value.endsWith("285"))).toBe(false);
  });

  it("keeps workspace sidebar button chrome on einui button variants", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const sidebarChromeCss = appCss.slice(appCss.indexOf(".slei-workspace-sidebar {"), appCss.indexOf(".slei-workspace-sidebar__header {"));

    expect(sidebarChromeCss).not.toContain("__button");
    expect(sidebarChromeCss).not.toContain("border-color: var(--glass-button-border)");
    expect(sidebarChromeCss).not.toContain("box-shadow: var(--glass-button-shadow)");
    expect(sidebarChromeCss).not.toContain("color-mix(in srgb, var(--primary) 28%, var(--menu-border))");
    expect(sidebarChromeCss).not.toContain("var(--raised-border)");
  });

  it("uses primary buttons for modal confirmation actions", () => {
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");

    expect(sidebarSource).toContain('<Button onClick={() => projectFolderInputRef.current?.click()} type="button">');
    expect(sidebarSource).not.toContain('<Button onClick={() => projectFolderInputRef.current?.click()} type="button" variant="outline">');
    expect(sidebarSource).toContain('aria-label={input.messages.chat.createChannel} className="min-w-20" disabled={creatingChannel} type="submit" variant="primary"');
    expect(frameSource).toContain('<Button type="submit" variant="primary"><SleiIcon name="plus" size={14} />{input.messages.common.create}</Button>');
    expect(frameSource).toContain('<Button disabled={createDisabled} type="submit" variant="primary">{input.messages.common.create}</Button>');
    expect(frameSource).toContain('disabled={input.loading} onClick={() => input.onRefreshRuntime?.()} type="button" variant="primary"');
  });

  it("keeps TooltipProvider at the app frame instead of nesting it in each Tooltip", () => {
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const tooltipSource = readFileSync(join(process.cwd(), "src/components/ui/tooltip.tsx"), "utf8");
    const tooltipRootSource = tooltipSource.slice(tooltipSource.indexOf("function Tooltip("), tooltipSource.indexOf("function TooltipTrigger("));

    expect(frameSource).toContain("<TooltipProvider>");
    expect(tooltipRootSource).not.toContain("<TooltipProvider>");
  });

  it("keeps the macOS traffic lights visually centered in the widened rail", () => {
    const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
      app: { windows: Array<{ trafficLightPosition?: { x: number; y: number } }> };
    };

    expect(tauriConfig.app.windows[0]?.trafficLightPosition).toEqual({ x: 8, y: 18 });
  });

  it("renders search only as the top workspace sidebar primary action", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const sidebar = host.querySelector(".slei-workspace-sidebar");
    const searchActions = Array.from(sidebar?.querySelectorAll("button") ?? [])
      .filter((button) => button.textContent?.trim() === "搜索");

    expect(searchActions).toHaveLength(1);
    expect(sidebar?.textContent).not.toContain("Command K");
  });

  it("renders saved messages in the right workspace while keeping channels and DMs in the sidebar", () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      conversations: [{ id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" }],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChatWorkspace="saved"
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
        savedMessages={[{
          id: "saved:channel:all:msg_1",
          messageId: "msg_1",
          sourceId: "all",
          sourceKind: "channel",
          savedAt: "2026-06-22T09:00:00Z",
          body: "这是一条保存消息正文",
          authorId: "a1",
          authorName: "Coda",
          messageCreatedAt: "2026-06-22T08:59:00Z",
          sourceName: "all",
          sourceLabel: "群聊 · #all",
          messageDeleted: false,
        }]}
      />,
    );

    expect(html).toContain('data-testid="slei-saved-workspace"');
    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-slot="card-content"');
    expect(html).toContain('data-slei-icon="bookmark"');
    expect(html).toContain(">频道 1</");
    expect(html).toContain(">私聊 1</");
    expect(html).toContain("这是一条保存消息正文");
    expect(html).toContain("群聊 · #all");
    expect(html).toContain("Coda");
    expect(html).toContain("发送于 2026-06-22");
    expect(html).toContain("保存于 2026-06-22");
  });

  it("treats saved messages and channels as one exclusive sidebar selection", async () => {
    const data = createSleiFixtures({
      channels: [
        { id: "all", name: "all", description: "默认团队频道", unread: 0, activeSessionId: "session:all" },
        { id: "dev-content", name: "dev-content", description: "频道", unread: 0, activeSessionId: "session:dev" },
      ],
    });

    const container = await mount(
      <SleiAppFrame
        activeChatWorkspace="saved"
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    const sidebar = container.querySelector(".slei-workspace-sidebar");
    const currentItems = Array.from(sidebar?.querySelectorAll<HTMLElement>('[aria-current="true"]') ?? []);

    expect(currentItems).toHaveLength(0);
    expect(sidebar?.querySelector('[data-channel-id="all"] [aria-current="true"]')).toBeNull();
  });

  it("renders saved message rows as cards while preserving unavailable and click behavior", async () => {
    const onSavedMessageSelect = vi.fn();
    const availableMessage = {
      id: "saved:available",
      messageId: "msg_available",
      sourceId: "all",
      sourceKind: "channel" as const,
      savedAt: "2026-06-22T09:00:00Z",
      body: "可打开的收藏消息",
      authorId: "a1",
      authorName: "Coda",
      messageCreatedAt: "2026-06-22T08:59:00Z",
      sourceName: "all",
      sourceLabel: "群聊 · #all",
      messageDeleted: false,
    };
    const deletedMessage = {
      ...availableMessage,
      id: "saved:deleted",
      messageId: "msg_deleted",
      body: "已删除的收藏消息",
      messageDeleted: true,
    };
    const container = await mount(
      <SleiAppFrame
        activeChatWorkspace="saved"
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        onSavedMessageSelect={onSavedMessageSelect}
        runtimeSetup={runtimeSetup}
        savedMessages={[availableMessage, deletedMessage]}
      />,
    );

    const workspace = container.querySelector('[data-testid="slei-saved-workspace"]');
    const rows = Array.from(workspace?.querySelectorAll<HTMLElement>('[data-slot="card"][data-saved-message-row]') ?? []);
    const availableButton = rows[0]?.querySelector<HTMLButtonElement>("button");
    const deletedButton = rows[1]?.querySelector<HTMLButtonElement>("button");

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.querySelector('[data-slot="card-content"]'))).toBe(true);
    expect(workspace?.querySelector('[data-slei-icon="bookmark"]')).not.toBeNull();
    expect(availableButton?.disabled).toBe(false);
    expect(deletedButton?.disabled).toBe(true);
    expect(deletedButton?.className).toContain("opacity-70");
    expect(availableButton?.className).toContain("hover:border-transparent");
    expect(availableButton?.className).not.toContain("hover:border-white/40");

    await act(async () => {
      availableButton?.click();
      deletedButton?.click();
    });

    expect(onSavedMessageSelect).toHaveBeenCalledTimes(1);
    expect(onSavedMessageSelect).toHaveBeenCalledWith(availableMessage);
  });

  it("renders channel names only in the workspace sidebar", () => {
    const data = createSleiFixtures({
      channels: [
        { id: "all", name: "all", description: "默认团队频道", unread: 0, activeSessionId: "session:all" },
        { id: "dev-content", name: "dev-content", description: "频道", projectPaths: [], unread: 0, activeSessionId: "session:dev" },
        { id: "kol", name: "kol", description: "频道", projectPaths: ["/workspace/kol"], unread: 0, activeSessionId: "session:kol" },
      ],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    const host = document.createElement("div");
    host.innerHTML = html;
    const sidebarText = host.querySelector(".slei-workspace-sidebar")?.textContent ?? "";

    expect(sidebarText).toContain("all");
    expect(sidebarText).toContain("dev-content");
    expect(sidebarText).toContain("kol");
    expect(sidebarText).not.toContain("默认团队频道");
    expect(sidebarText).not.toContain("关联项目：暂无");
    expect(sidebarText).not.toContain("关联项目：/workspace/kol");
  });

  it("uses liquid glass selected states for sidebar channels and direct messages", () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      channels: [
        { id: "all", name: "all", description: "默认团队频道", unread: 0, activeSessionId: "session:all" },
        { id: "dev-content", name: "dev-content", description: "频道", projectPaths: [], unread: 0, activeSessionId: "session:dev" },
      ],
      conversations: [
        { id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" },
      ],
    });

    const channelHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="dev-content"
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );
    const channelHost = document.createElement("div");
    channelHost.innerHTML = channelHtml;
    const selectedChannel = channelHost.querySelector<HTMLElement>('[data-channel-id="dev-content"]');

    expect(selectedChannel?.className).toContain("bg-white/20");
    expect(selectedChannel?.className).toContain("backdrop-blur-xl");
    expect(selectedChannel?.className).toContain("shadow-[0_10px_28px");
    expect(selectedChannel?.className).not.toContain("bg-accent");
    expect(selectedChannel?.className).not.toContain("text-accent-foreground");
    expect(selectedChannel?.closest('[data-slot="scroll-area"]')?.className).toContain("-mx-2");
    expect(selectedChannel?.closest('[data-slot="scroll-area"]')?.className).toContain("-my-2");
    expect(selectedChannel?.closest('[data-slot="scroll-area"]')?.querySelector('[data-channel-scroll-content]')?.className).toContain("px-2");
    expect(selectedChannel?.closest('[data-slot="scroll-area"]')?.querySelector('[data-channel-scroll-content]')?.className).toContain("py-2");

    const dmHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:a1"
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );
    const dmHost = document.createElement("div");
    dmHost.innerHTML = dmHtml;
    const selectedDm = dmHost.querySelector<HTMLElement>('[data-conversation-id="dm:a1"]');

    expect(selectedDm?.className).toContain("bg-white/20");
    expect(selectedDm?.className).toContain("backdrop-blur-xl");
    expect(selectedDm?.className).not.toContain("bg-accent");
    expect(selectedDm?.className).not.toContain("text-accent-foreground");
  });

  it("keeps the workspace sidebar visible while secondary destinations render in the workspace", () => {
    const data = createSleiFixtures({ members: createDemoMembers() });
    const nodes = [
      {
        id: "local-node",
        name: "Mac Studio",
        status: "connected" as const,
        daemonVersion: "0.1.0",
        created: "2026-06-22",
        device: { arch: "arm64", hostname: "mac-studio", platform: "darwin" },
        runtimes: [],
      },
    ];

    const membersHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeMemberId="a2"
        activeView="members"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes }}
      />,
    );
    expect(membersHtml).toContain("slei-workspace-sidebar");
    expect(membersHtml).toContain("成员");
    expect(membersHtml).toContain(">频道 ");

    const computersHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="computers"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes }}
      />,
    );
    expect(computersHtml).toContain("slei-workspace-sidebar");
    expect(computersHtml).toContain("Mac Studio");
    expect(computersHtml).toContain(">频道 ");

    const settingsHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        initialSettingsPanel="appearance"
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes }}
      />,
    );
    expect(settingsHtml).toContain("slei-workspace-sidebar");
    expect(settingsHtml).toContain("外观");
    expect(settingsHtml).toContain(">频道 ");
  });

  it("cycles channel and direct message sorting independently by name", async () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      channels: [
        { id: "zeta", name: "zeta", description: "Zeta channel", unread: 0, activeSessionId: "session:zeta" },
        { id: "alpha", name: "alpha", description: "Alpha channel", unread: 0, activeSessionId: "session:alpha" },
        { id: "beta", name: "beta", description: "Beta channel", unread: 0, activeSessionId: "session:beta" },
      ],
      conversations: [
        { id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" },
        { id: "dm:a2", agentId: "a2", kind: "dm", activeSessionId: "session-dm-a2", createdAt: "0", updatedAt: "0" },
        { id: "dm:a3", agentId: "a3", kind: "dm", activeSessionId: "session-dm-a3", createdAt: "0", updatedAt: "0" },
      ],
    });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );
    const click = async (button: HTMLButtonElement) => {
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    const channelSortButton = () => container.querySelector<HTMLButtonElement>('[data-sort-target="channels"]');
    const directMessageSortButton = () => container.querySelector<HTMLButtonElement>('[data-sort-target="direct-messages"]');
    const channelOrder = () => Array.from(container.querySelectorAll<HTMLElement>("[data-channel-list-item]")).map((item) => item.dataset.channelId);
    const directMessageOrder = () => Array.from(container.querySelectorAll<HTMLElement>("[data-direct-message-list-item]")).map((item) => item.dataset.conversationId);
    const sortIconState = (button: HTMLButtonElement | null | undefined) => button?.querySelector<HTMLElement>("[data-sort-icon-swap]")?.dataset.state;
    const sortDirectionIconState = (button: HTMLButtonElement | null | undefined) => button?.querySelector<HTMLElement>("[data-sort-direction-swap]")?.dataset.state;
    const activeSortIcon = (button: HTMLButtonElement | null | undefined) => {
      const swap = button?.querySelector<HTMLElement>("[data-sort-icon-swap]");
      const state = swap?.dataset.state;
      const iconSlot = Array.from(swap?.children ?? [])
        .find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("t-icon") && child.dataset.icon === state);
      const nestedSwap = iconSlot?.querySelector<HTMLElement>("[data-sort-direction-swap]");
      if (nestedSwap) {
        const nestedState = nestedSwap.dataset.state;
        const nestedIconSlot = Array.from(nestedSwap.children)
          .find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("t-icon") && child.dataset.icon === nestedState);
        return nestedIconSlot?.querySelector<HTMLElement>("[data-slei-icon]")?.dataset.sleiIcon;
      }
      return iconSlot?.querySelector<HTMLElement>("[data-slei-icon]")?.dataset.sleiIcon;
    };

    expect(channelOrder()).toEqual(["zeta", "alpha", "beta"]);
    expect(directMessageOrder()).toEqual(["dm:a1", "dm:a2", "dm:a3"]);
    expect(channelSortButton()?.dataset.sortState).toBe("default");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("升序");
    expect(channelSortButton()?.getAttribute("data-variant")).toBe("ghost");
    expect(channelSortButton()?.classList.contains("bg-muted/70")).toBe(false);
    expect(channelSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("default");
    expect(sortIconState(channelSortButton())).toBe("a");
    expect(activeSortIcon(channelSortButton())).toBe("sort");

    await click(channelSortButton()!);
    expect(channelOrder()).toEqual(["alpha", "beta", "zeta"]);
    expect(directMessageOrder()).toEqual(["dm:a1", "dm:a2", "dm:a3"]);
    expect(channelSortButton()?.dataset.sortState).toBe("asc");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("降序");
    expect(channelSortButton()?.getAttribute("data-variant")).toBe("ghost");
    expect(channelSortButton()?.classList.contains("bg-muted/70")).toBe(true);
    expect(channelSortButton()?.classList.contains("text-foreground")).toBe(true);
    expect(channelSortButton()?.classList.contains("dark:bg-muted/50")).toBe(true);
    expect(channelSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("asc");
    expect(sortIconState(channelSortButton())).toBe("b");
    expect(sortDirectionIconState(channelSortButton())).toBe("a");
    expect(activeSortIcon(channelSortButton())).toBe("arrowUp");
    expect(window.localStorage.getItem("slei:sidebar-sort:channels")).toBe("asc");

    await click(channelSortButton()!);
    expect(channelOrder()).toEqual(["zeta", "beta", "alpha"]);
    expect(channelSortButton()?.dataset.sortState).toBe("desc");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("取消排序");
    expect(channelSortButton()?.getAttribute("data-variant")).toBe("ghost");
    expect(channelSortButton()?.classList.contains("bg-muted/70")).toBe(true);
    expect(channelSortButton()?.classList.contains("text-foreground")).toBe(true);
    expect(channelSortButton()?.classList.contains("dark:bg-muted/50")).toBe(true);
    expect(channelSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("desc");
    expect(sortIconState(channelSortButton())).toBe("b");
    expect(sortDirectionIconState(channelSortButton())).toBe("b");
    expect(activeSortIcon(channelSortButton())).toBe("arrowDown");
    expect(window.localStorage.getItem("slei:sidebar-sort:channels")).toBe("desc");

    await click(channelSortButton()!);
    expect(channelOrder()).toEqual(["zeta", "alpha", "beta"]);
    expect(channelSortButton()?.dataset.sortState).toBe("default");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("升序");
    expect(channelSortButton()?.getAttribute("data-variant")).toBe("ghost");
    expect(channelSortButton()?.classList.contains("bg-muted/70")).toBe(false);
    expect(sortIconState(channelSortButton())).toBe("a");
    expect(activeSortIcon(channelSortButton())).toBe("sort");
    expect(window.localStorage.getItem("slei:sidebar-sort:channels")).toBe("default");

    await click(directMessageSortButton()!);
    expect(channelOrder()).toEqual(["zeta", "alpha", "beta"]);
    expect(directMessageOrder()).toEqual(["dm:a3", "dm:a2", "dm:a1"]);
    expect(directMessageSortButton()?.dataset.sortState).toBe("asc");
    expect(directMessageSortButton()?.getAttribute("aria-label")).toBe("降序");
    expect(directMessageSortButton()?.getAttribute("data-variant")).toBe("ghost");
    expect(directMessageSortButton()?.classList.contains("bg-muted/70")).toBe(true);
    expect(directMessageSortButton()?.classList.contains("text-foreground")).toBe(true);
    expect(directMessageSortButton()?.classList.contains("dark:bg-muted/50")).toBe(true);
    expect(directMessageSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("asc");
    expect(sortIconState(directMessageSortButton())).toBe("b");
    expect(sortDirectionIconState(directMessageSortButton())).toBe("a");
    expect(activeSortIcon(directMessageSortButton())).toBe("arrowUp");
    expect(window.localStorage.getItem("slei:sidebar-sort:direct-messages")).toBe("asc");
  });

  it("restores channel and direct message sort preferences from frontend storage", async () => {
    window.localStorage.setItem("slei:sidebar-sort:channels", "desc");
    window.localStorage.setItem("slei:sidebar-sort:direct-messages", "asc");
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      channels: [
        { id: "zeta", name: "zeta", description: "Zeta channel", unread: 0, activeSessionId: "session:zeta" },
        { id: "alpha", name: "alpha", description: "Alpha channel", unread: 0, activeSessionId: "session:alpha" },
        { id: "beta", name: "beta", description: "Beta channel", unread: 0, activeSessionId: "session:beta" },
      ],
      conversations: [
        { id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" },
        { id: "dm:a2", agentId: "a2", kind: "dm", activeSessionId: "session-dm-a2", createdAt: "0", updatedAt: "0" },
        { id: "dm:a3", agentId: "a3", kind: "dm", activeSessionId: "session-dm-a3", createdAt: "0", updatedAt: "0" },
      ],
    });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    expect(Array.from(container.querySelectorAll<HTMLElement>("[data-channel-list-item]")).map((item) => item.dataset.channelId)).toEqual(["zeta", "beta", "alpha"]);
    expect(Array.from(container.querySelectorAll<HTMLElement>("[data-direct-message-list-item]")).map((item) => item.dataset.conversationId)).toEqual(["dm:a3", "dm:a2", "dm:a1"]);
    expect(container.querySelector<HTMLButtonElement>('[data-sort-target="channels"]')?.dataset.sortState).toBe("desc");
    expect(container.querySelector<HTMLButtonElement>('[data-sort-target="direct-messages"]')?.dataset.sortState).toBe("asc");
  });

  it("uses the shared empty illustration in the members navigator empty state", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="members"
        data={createSleiFixtures({ members: [] })}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain("暂无智能体");
    expect(html).toContain('data-empty-illustration="nodata"');
  });

  it("does not show channel readiness copy before a channel is created", async () => {
    const host = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: createDemoMembers() })}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    const createButton = host.querySelector('button[aria-label="创建频道"]') as HTMLButtonElement | null;
    expect(createButton).toBeTruthy();
    await act(async () => {
      createButton?.click();
    });
    await act(async () => undefined);

    expect(document.body.textContent).toContain("选择 Agent");
    expect(document.body.textContent).toContain("Coda");
    const agentCheckbox = document.body.querySelector<HTMLElement>('[aria-label="选择 Agent Coda"]');
    const agentList = agentCheckbox?.closest<HTMLElement>('[data-slot="scroll-area"]');
    expect(agentList?.className).toContain("bg-transparent");
    expect(agentList?.className).toContain("border-white/20");
    expect(agentCheckbox?.className).toContain("bg-white/10");
    expect(agentCheckbox?.className).toContain("border-white/20");
    expect(agentCheckbox?.className).not.toContain("bg-transparent");

    await act(async () => {
      agentCheckbox?.click();
    });

    const selectedAgentOption = agentCheckbox?.closest<HTMLElement>('[data-testid="slei-create-channel-agent-option"]');
    expect(selectedAgentOption?.dataset.selected).toBe("true");
    expect(selectedAgentOption?.className).toContain("bg-white/20");
    expect(document.body.textContent).not.toContain("记忆同步中");
    expect(document.body.textContent).not.toContain("记忆失败");
  });

  it("shows command execution copy for an active channel agent tool event", () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      messages: [{
        id: "agent-activity-msg_1-a1",
        author: "Coda",
        handle: "@coda",
        role: "agent",
        time: "",
        body: "",
        channelId: "all",
        status: "running",
        sourceMessageId: "msg_1",
        activityEventKind: "tool.started",
        activityToolName: "Bash",
        toolCall: "channel_agent_reply",
      } as SleiMessage & {
        activityEventKind: string;
        activityToolName: string;
      }],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('data-slot="agent-activity"');
    expect(html).toContain("正在执行命令");
    expect(html).not.toContain("正在思考");
  });

  it("marks sidebar category titles as unselectable", () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      conversations: [{ id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" }],
    });
    const chatHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );
    expect(chatHtml).toContain('data-slot="sidebar-section-title"');
    expect(chatHtml).toContain('class="select-none');
    expect(chatHtml).toContain(">频道 1</");
    expect(chatHtml).toContain(">私聊 1</");
    const titleMatches = chatHtml.match(/data-slot="sidebar-section-title"[^>]*class="([^"]*)"/g) ?? [];
    expect(titleMatches.length).toBeGreaterThan(0);
    expect(titleMatches.every((match) => match.includes("select-none"))).toBe(true);
  });
});

describe("SleiAppFrame interactive channel cards", () => {
  it("opens the create channel modal with sanitized draft values from a card", async () => {
    const createChannel = vi.fn();
    const completeCard = vi.fn();
    const members = createDemoMembers();
    const container = await mount(
      <SleiAppFrame
        activeChannelId="all"
        activeView="chat"
        data={createSleiFixtures({
          members,
          messages: [{
            id: "card_message_channel_1",
            author: "Yeal",
            role: "agent",
            time: "10:00",
            body: "",
            channelId: "all",
            status: "done",
            cards: [{
              id: "card_channel_1",
              kind: "createChannel",
              state: "pending",
              title: "创建 #qa",
              summary: "#qa",
              draft: {
                name: " #qa ",
                projectName: "QA Project",
                projectPaths: [
                  "/Users/lei/Slei",
                  " /Users/lei/Slei ",
                  "../secret",
                  "file:///tmp/project",
                  "/Users/lei/\u0000bad",
                  ".",
                ],
                agentIds: ["a1", "missing_agent"],
              },
              actionLabel: "创建",
              doneLabel: "DONE",
            }],
          }],
        })}
        locale="zh-CN"
        onChannelCreate={createChannel}
        onInteractiveCardComplete={completeCard}
        runtimeSetup={{ ...runtimeSetup, nodes: createSleiFixtures().nodes }}
      />,
    );

    const cardButton = container.querySelector<HTMLButtonElement>('[data-card-kind="createChannel"] button');
    expect(cardButton).not.toBeNull();
    await act(async () => {
      cardButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(createChannel).not.toHaveBeenCalled();
    expect(completeCard).not.toHaveBeenCalled();
    expect(dialog?.textContent).toContain("/Users/lei/Slei");
    expect(dialog?.textContent).not.toContain("../secret");
    expect(dialog?.textContent).not.toContain("file:///tmp/project");

    const nameInput = dialog?.querySelector<HTMLInputElement>("#slei-channel-name");
    expect(nameInput?.value).toBe("qa");
    const codaCheckbox = dialog?.querySelector<HTMLElement>('[aria-label="选择 Agent Coda"]');
    const cindyCheckbox = dialog?.querySelector<HTMLElement>('[aria-label="选择 Agent Cindy"]');
    expect(codaCheckbox?.getAttribute("aria-checked")).toBe("true");
    expect(cindyCheckbox?.getAttribute("aria-checked")).toBe("false");
  });

  it("completes a create-channel card only after modal channel creation succeeds", async () => {
    const createChannel = vi.fn(async () => ({
      channel: { id: "qa", name: "qa", description: "QA", projectPaths: [] },
    }));
    const completeCard = vi.fn();
    const container = await mount(
      <SleiAppFrame
        activeChannelId="all"
        activeView="chat"
        data={createSleiFixtures({
          messages: [{
            id: "card_message_channel_2",
            author: "Yeal",
            role: "agent",
            time: "10:00",
            body: "",
            channelId: "all",
            status: "done",
            cards: [{
              id: "card_channel_2",
              kind: "createChannel",
              state: "pending",
              title: "创建 #qa",
              summary: "#qa",
              draft: { name: "qa", projectPaths: [], agentIds: [] },
              actionLabel: "创建",
              doneLabel: "DONE",
            }],
          }],
        })}
        locale="zh-CN"
        onChannelCreate={createChannel}
        onChannelCreateRefresh={async () => [{ id: "all", name: "all", description: "默认频道", unread: 0 }, { id: "qa", name: "qa", description: "QA", unread: 0 }]}
        onInteractiveCardComplete={completeCard}
        runtimeSetup={{ ...runtimeSetup, nodes: createSleiFixtures().nodes }}
      />,
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-card-kind="createChannel"] button')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await act(async () => {
      dialog?.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    });

    expect(createChannel).toHaveBeenCalledWith({
      name: "qa",
      projectName: "",
      projectPaths: [],
      agentIds: [],
    });
    expect(completeCard).toHaveBeenCalledWith("card_channel_2");
  });
});
