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
class TestPointerEvent extends window.MouseEvent {
  pointerId: number;
  pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}
window.PointerEvent = TestPointerEvent as typeof PointerEvent;
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => undefined;
HTMLElement.prototype.releasePointerCapture ??= () => undefined;
HTMLElement.prototype.scrollIntoView ??= () => undefined;

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

async function clickSelectItem(text: string) {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(item).toBeInstanceOf(HTMLElement);
  await act(async () => {
    item?.click();
  });
  await act(async () => undefined);
  return item;
}

async function clickDropdownItem(text: string) {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(item).toBeInstanceOf(HTMLElement);
  await act(async () => {
    item?.click();
  });
  await act(async () => undefined);
  return item;
}

function openDropdownMenuContent() {
  return document.body.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
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
  vi.useRealTimers();
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
  it("localizes unavailable runtime readiness in the onboarding modal", async () => {
    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          hasClaudeRuntimeReady: false,
          nodes: [{
            id: "local-node",
            name: "本机设备",
            status: "connected",
            daemonVersion: "dev",
            device: { hostname: "local", platform: "macos", arch: "arm64" },
            runtimes: [{ kind: "ClaudeCode", readiness: "unavailable" as const }],
          }],
        }}
      />,
    );

    const dialog = currentDialog();
    expect(dialog.textContent).toContain("ClaudeCode");
    expect(dialog.textContent).toContain("不可用");
    expect(dialog.textContent).not.toContain("unavailable");
  });

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

    expect(container.querySelector('[data-slot="toast"]')?.textContent).toContain("运行时错误");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-slot="toast-close"]')?.click();
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

  it("keeps the standard font size at a 14px body baseline", async () => {
    await mount(
      <SleiAppFrame
        activeView="chat"
        appearance={{ theme: "light", fontSize: "md" }}
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(document.documentElement.style.fontSize).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--app-font-size")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("14px");
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

  it("defaults to the light screenshot theme when appearance is omitted", async () => {
    document.documentElement.classList.remove("dark", "light");

    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
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
  it("renders vertical shadcn fieldset sections with avatar and hides the handle input", async () => {
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
    const dialog = currentDialog();
    const formGroup = document.body.querySelector<HTMLElement>("[data-agent-create-form-group]");
    const legends = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="field-legend"]')).map((legend) => legend.textContent?.replace("*", ""));
    expect(dialog.className).toContain("sm:max-w-[620px]");
    expect(dialog.className).not.toContain("sm:max-w-4xl");
    expect(formGroup?.getAttribute("data-slot")).toBe("field-group");
    expect(formGroup?.className).toContain("flex");
    expect(formGroup?.className).toContain("flex-col");
    expect(formGroup?.querySelector(".md\\:grid-cols-\\[minmax\\(14rem\\,0\\.78fr\\)_minmax\\(0\\,1\\.22fr\\)\\]")).toBeNull();
    expect(document.body.querySelectorAll('[data-slot="field-set"]')).toHaveLength(2);
    expect(document.body.querySelectorAll('[data-slot="field-separator"]')).toHaveLength(1);
    expect(legends).toEqual(["运行环境", "成员信息"]);
    expect(document.body.querySelector('label[for="slei-agent-name"] .text-destructive')?.textContent).toBe("*");
    const memberInline = document.body.querySelector<HTMLElement>("[data-agent-create-member-inline]");
    const avatarButton = document.body.querySelector<HTMLElement>("[data-agent-create-avatar]");
    const nameInput = document.body.querySelector<HTMLInputElement>("#slei-agent-name");
    const runtimeInline = document.body.querySelector<HTMLElement>("[data-agent-runtime-inline]");
    const deviceTrigger = document.body.querySelector<HTMLButtonElement>('[data-slot="select-trigger"][aria-label="关联设备"]');
    const runtimeTrigger = document.body.querySelector<HTMLButtonElement>('[data-slot="select-trigger"][aria-label="运行时"]');
    const modelInput = document.body.querySelector<HTMLInputElement>("#slei-agent-model");
    expect(runtimeInline?.className).toContain("sm:grid-cols-[minmax(0,6fr)_minmax(0,4fr)]");
    expect(document.body.querySelector("[data-agent-runtime-cascade] [data-slot='field-content'] .sm\\:grid-cols-2")).toBeTruthy();
    expect(deviceTrigger?.closest("[data-agent-runtime-inline]")).toBe(runtimeInline);
    expect(runtimeTrigger?.closest("[data-agent-runtime-inline]")).toBe(runtimeInline);
    expect(modelInput?.closest("[data-agent-runtime-inline]")).toBe(runtimeInline);
    expect(memberInline?.className).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(avatarButton?.closest("[data-agent-create-member-inline]")).toBe(memberInline);
    expect(nameInput?.closest("[data-agent-create-member-inline]")).toBe(memberInline);
    expect(document.body.querySelector("#slei-agent-handle")).toBeNull();
    expect(document.body.querySelector("#slei-agent-description")).toBeNull();
  });

  it("uses refined labels, required description, and aligned avatar refresh chrome", async () => {
    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        initialAgentCreateModalOpen
        locale="zh-CN"
        onAgentRolePresetsLoad={() => ({
          presets: [{ id: "researcher", title: "资料调研员", description: "负责围绕指定主题收集资料。", sortOrder: 10 }],
        })}
        runtimeSetup={{ ...runtimeSetup, nodes: readyNodes }}
      />,
    );

    const dialog = currentDialog();
    const title = dialog.querySelector('[data-slot="dialog-title"]');
    const avatarButton = dialog.querySelector<HTMLElement>("[data-agent-create-avatar]");
    const avatarMask = dialog.querySelector<HTMLElement>("[data-agent-create-avatar-mask]");

    expect(title?.textContent).toBe("创建智能体");
    expect(dialog.querySelector('[data-slot="badge"]')).toBeNull();
    expect(dialog.querySelector('[data-slot="dialog-description"]')).toBeNull();
    expect(dialog.textContent).toContain("运行时");
    expect(dialog.textContent).toContain("模型");
    expect(dialog.textContent).toContain("职业设定");
    expect(dialog.textContent).not.toContain("描述来源");
    expect(dialog.textContent).not.toContain("Runtime");
    expect(dialog.textContent).not.toContain("Model");
    expect(dialog.querySelectorAll("label[for='slei-agent-description']")).toHaveLength(0);
    const avatar = avatarButton?.querySelector<HTMLElement>('[data-slot="avatar"]');
    expect(avatarButton?.className).toContain("size-[3.75rem]");
    expect(avatarButton?.className).toContain("[&>[data-slot=avatar]]:size-full");
    expect(avatarButton?.className).not.toContain("size-[3.25rem]");
    expect(avatar?.getAttribute("data-avatar-size")).toBe("large");
    expect(avatarMask?.closest("[data-agent-create-avatar]")).toBe(avatarButton);
    expect(avatarMask?.className).toContain("inset-0");
    expect(avatarMask?.className).toContain("rounded-full");

    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    await act(async () => {
      currentDialog().querySelector<HTMLElement>('[data-slot="radio-group-item"][value="preset"]')?.click();
    });
    await act(async () => undefined);

    const roleDialog = currentDialog();
    const description = roleDialog.querySelector<HTMLTextAreaElement>("#slei-agent-description");
    expect(roleDialog.querySelectorAll("label[for='slei-agent-description']")).toHaveLength(1);
    expect(description?.required).toBe(true);
    expect(description?.getAttribute("aria-required")).toBe("true");
    const presetDescription = roleDialog.querySelector<HTMLElement>("[data-agent-preset-description]");
    const presetTitle = presetDescription?.previousElementSibling as HTMLElement | null;
    expect(presetTitle?.className).toContain("text-sm");
    expect(presetTitle?.className).toContain("font-medium");
    expect(presetDescription?.className).toContain("text-xs");
    expect(presetDescription?.className).toContain("text-muted-foreground");
    expect(presetDescription?.className).toContain("font-normal");

    const presetGroup = presetDescription?.closest<HTMLElement>('[data-slot="radio-group"]');
    const presetCard = presetDescription?.closest<HTMLElement>("[data-agent-preset-card]");
    const presetRadio = presetCard?.querySelector<HTMLElement>('[data-slot="radio-group-item"]');
    const presetField = presetDescription?.closest<HTMLElement>('[data-slot="field"]');
    expect(presetGroup).toBeTruthy();
    expect(presetCard?.getAttribute("data-slot")).toBe("field-label");
    expect(presetCard?.className).toContain("has-data-[state=checked]:border-primary");
    expect(presetCard?.className).toContain("has-data-[state=checked]:bg-primary/5");
    expect(presetField?.getAttribute("data-orientation")).toBe("horizontal");
    expect(presetField?.className).toContain("flex-row");
    expect(presetRadio).toBeTruthy();
    await act(async () => {
      presetCard?.click();
    });
    await act(async () => undefined);

    expect(presetRadio?.getAttribute("data-state")).toBe("checked");
    expect(presetCard?.getAttribute("aria-pressed")).toBeNull();
    expect(presetDescription?.className).toContain("text-muted-foreground");
  });

  it("renders device and runtime as one shadcn cascade field before the model autocomplete input", async () => {
    const onAgentCreate = vi.fn();
    const cascadeNodes = [
      readyNodes[0],
      {
        id: "remote-node",
        name: "远程设备",
        status: "connected" as const,
        daemonVersion: "dev",
        device: { hostname: "remote", platform: "linux", arch: "x64" },
        runtimes: [{ kind: "Codex", readiness: "ready" as const }],
      },
    ];

    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        initialAgentCreateModalOpen
        locale="zh-CN"
        onAgentCreate={onAgentCreate}
        runtimeSetup={{ ...runtimeSetup, nodes: cascadeNodes }}
      />,
    );

    const dialog = currentDialog();
    const cascade = dialog.querySelector<HTMLElement>("[data-agent-runtime-cascade]");
    const runtimeInline = dialog.querySelector<HTMLElement>("[data-agent-runtime-inline]");
    const deviceTrigger = dialog.querySelector<HTMLButtonElement>('[data-slot="select-trigger"][aria-label="关联设备"]');
    const runtimeTrigger = dialog.querySelector<HTMLButtonElement>('[data-slot="select-trigger"][aria-label="运行时"]');
    const modelInput = dialog.querySelector<HTMLInputElement>("#slei-agent-model");

    expect(cascade).toBeTruthy();
    expect(deviceTrigger?.closest('[data-slot="field"]')).toBe(cascade);
    expect(runtimeTrigger?.closest('[data-slot="field"]')).toBe(cascade);
    expect(cascade?.closest("[data-agent-runtime-inline]")).toBe(runtimeInline);
    expect(modelInput?.closest("[data-agent-runtime-inline]")).toBe(runtimeInline);
    expect(cascade?.className).toContain("flex");
    expect(cascade?.querySelector('[data-slot="field-content"]')).toBeTruthy();
    expect(modelInput?.closest('[data-slot="field"]')).not.toBe(cascade);

    await changeField(modelInput, "op");
    const modelOptions = document.body.querySelector<HTMLElement>('[data-agent-model-options]');
    expect(modelOptions?.textContent).not.toContain("Default");
    expect(modelOptions?.textContent).toContain("Opus");
    await clickElement(Array.from(document.body.querySelectorAll<HTMLElement>("[data-agent-model-option]"))
      .find((option) => option.textContent?.includes("Opus")));
    expect(modelInput?.value).toBe("Opus");

    await clickElement(deviceTrigger);
    await clickSelectItem("远程设备");

    const updatedRuntimeTrigger = dialog.querySelector<HTMLButtonElement>('[data-slot="select-trigger"][aria-label="运行时"]');
    expect(updatedRuntimeTrigger?.textContent).toContain("Codex");

    await changeField(dialog.querySelector<HTMLInputElement>("#slei-agent-name"), "远程助手");
    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-profession"), "远程执行员");
    await changeField(currentDialog().querySelector<HTMLTextAreaElement>("#slei-agent-description"), "处理远程任务。");
    await act(async () => {
      currentDialogSubmit().click();
    });

    expect(onAgentCreate).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: "remote-node",
      runtimeKind: "Codex",
      model: "Opus",
    }));
  });

  it("allows an empty model text so Claude Code can use its default model", async () => {
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

    const dialog = currentDialog();
    const modelInput = dialog.querySelector<HTMLInputElement>("#slei-agent-model");
    expect(modelInput?.value).toBe("Sonnet");

    await changeField(modelInput, "");
    await changeField(dialog.querySelector<HTMLInputElement>("#slei-agent-name"), "默认模型助手");
    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-profession"), "默认模型助手");
    await changeField(currentDialog().querySelector<HTMLTextAreaElement>("#slei-agent-description"), "使用 Claude Code 默认模型处理任务。");
    await act(async () => {
      currentDialogSubmit()?.click();
    });

    expect(onAgentCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "",
    }));
  });

  it("keeps the avatar seed stable while editing the agent name until refresh", async () => {
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

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "法");
    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "法律研究员");
    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-profession"), "法律研究员");
    await changeField(currentDialog().querySelector<HTMLTextAreaElement>("#slei-agent-description"), "负责法律资料调研。");
    await act(async () => {
      currentDialogSubmit()?.click();
    });

    expect(onAgentCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "法律研究员",
      avatarSeed: "agent-avatar-new",
    }));
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
    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-slot="radio-group-item"][value="preset"]')?.click();
    });
    await act(async () => undefined);

    const presetList = document.body.querySelector<HTMLElement>("[data-agent-preset-list]");
    const scrollBody = document.body.querySelector<HTMLElement>("[data-agent-create-scroll-body]");
    const footer = document.body.querySelector<HTMLElement>("[data-agent-create-footer]");
    expect(currentDialog().className).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(scrollBody?.className).toContain("overflow-y-auto");
    expect(scrollBody?.querySelector("[data-agent-preset-list]")).toBe(presetList);
    expect(footer?.closest("[data-agent-create-scroll-body]")).toBeNull();
    expect(footer?.textContent).toContain("取消");
    expect(footer?.textContent).toContain("创建");
    expect(presetList?.className).not.toContain("max-h-56");
    expect(presetList?.className).not.toContain("overflow-y-auto");
    expect(document.body.textContent).toContain("教师");

    const presetGroup = document.body.querySelector<HTMLElement>("[data-agent-preset-list] [data-slot='radio-group']");
    expect(presetGroup?.className).toContain("sm:grid-cols-2");
    const presetCard = Array.from(document.body.querySelectorAll<HTMLElement>("[data-agent-preset-card]"))
      .find((card) => card.textContent?.includes("教师") && card.textContent?.includes("课程讲解"));
    await act(async () => {
      presetCard?.click();
    });
    expect(presetCard?.querySelector('[data-slot="radio-group-item"]')?.getAttribute("data-state")).toBe("checked");
    expect(presetCard?.getAttribute("aria-pressed")).toBeNull();
    await act(async () => {
      currentDialogSubmit()?.click();
    });

    expect(onAgentCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "教师助手",
      handle: "@教师助手",
      profession: "教师",
      description: "负责课程讲解和练习反馈。",
      avatarSeed: "agent-avatar-new",
    }));
  });

  it("keeps two-step agent create state while presets fill profession without replacing the random name", async () => {
    const onAgentCreate = vi.fn();
    const onAgentRolePresetsLoad = vi.fn(async () => ({
      categories: [{ id: "education", title: "教育", sortOrder: 10 }],
      presets: [{
        id: "teacher",
        title: "教师",
        profession: "教学助理",
        description: "负责课程讲解和练习反馈。",
        categoryId: "education",
        sortOrder: 10,
      }],
    }));

    await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: createDemoMembers() })}
        initialAgentCreateModalOpen
        locale="zh-CN"
        onAgentCreate={onAgentCreate}
        onAgentRolePresetsLoad={onAgentRolePresetsLoad}
        runtimeSetup={{ ...runtimeSetup, nodes: readyNodes }}
      />,
    );

    const initialName = currentDialog().querySelector<HTMLInputElement>("#slei-agent-name")?.value;
    expect(initialName).toMatch(/^[A-Za-z]+/);
    expect(initialName).not.toBe("Coda");
    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-model"), "");

    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-preset-search"), "教学");
    const presetCard = Array.from(document.body.querySelectorAll<HTMLElement>("[data-agent-preset-card]"))
      .find((card) => card.textContent?.includes("教学助理"));
    await clickElement(presetCard);

    expect(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name")).toBeNull();
    expect(currentDialog().querySelector<HTMLInputElement>("#slei-agent-profession")?.value).toBe("教学助理");
    expect(currentDialog().querySelector<HTMLTextAreaElement>("#slei-agent-description")?.value).toBe("负责课程讲解和练习反馈。");

    await clickElement(currentDialog().querySelector('[data-agent-create-step="runtime"]'));
    expect(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name")?.value).toBe(initialName);
    expect(currentDialog().querySelector<HTMLInputElement>("#slei-agent-model")?.value).toBe("");

    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    expect(currentDialog().querySelector<HTMLInputElement>("#slei-agent-preset-search")?.value).toBe("教学");
    expect(currentDialog().querySelector<HTMLInputElement>("#slei-agent-profession")?.value).toBe("教学助理");

    await act(async () => {
      currentDialogSubmit()?.click();
    });

    expect(onAgentCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: initialName,
      model: "",
      profession: "教学助理",
      description: "负责课程讲解和练习反馈。",
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

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "系统 架构师");
    expect(document.body.textContent).toContain("名称不能包含空格或 -");

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "Coda");
    expect(document.body.textContent).toContain("已有同名成员");

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "一".repeat(33));
    expect(document.body.textContent).toContain("名称不能超过 32 个字符");

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-name"), "系统架构师");
    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    expect(currentDialogSubmit()?.disabled).toBe(true);

    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-profession"), "系统架构师");
    await changeField(currentDialog().querySelector<HTMLTextAreaElement>("#slei-agent-description"), "负责拆解系统设计并维护架构边界。");
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
    await clickElement(currentDialog().querySelector('[data-agent-create-step="role"]'));
    await changeField(currentDialog().querySelector<HTMLInputElement>("#slei-agent-profession"), "法律研究员");
    await changeField(currentDialog().querySelector<HTMLTextAreaElement>("#slei-agent-description"), "负责法律资料调研。");
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

  it("keeps the app shell grid responsive instead of fixing columns inline", async () => {
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
        sidebarWidth={280}
      />,
    );
    const shell = container.querySelector<HTMLElement>("[data-active-view='chat']");
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(shell).not.toBeNull();
    expect(shell?.classList.contains("slei-app-shell")).toBe(true);
    expect(shell?.getAttribute("data-desktop-drag-region")).toBe("deep");
    expect(shell?.style.gridTemplateColumns).toBe("");
    expect(shell?.style.getPropertyValue("--app-sidebar-width")).toBe("280px");
    expect(appCss).toContain(".slei-app-shell");
    expect(appCss).toContain('.slei-app-shell[data-desktop-drag-region="deep"]');
    expect(appCss).toContain("-webkit-app-region: drag");
    expect(appCss).toContain(".slei-app-content,\n.slei-settings-overlay,");
    expect(appCss).toContain("-webkit-app-region: no-drag;");
    expect(appCss).not.toMatch(/^\[data-desktop-drag-region="deep"\] \{/m);
    expect(appCss).toContain("@media (max-width: 760px)");
    expect(appCss).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("renders native-window-safe chrome branding above the sidebar and workspace cards", async () => {
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );
    const chrome = container.querySelector<HTMLElement>('[data-slot="app-chrome"]');
    const nativeControlsSpace = chrome?.querySelector<HTMLElement>('[data-slot="native-window-controls-space"]');
    const divider = chrome?.querySelector<HTMLElement>('[data-slot="app-chrome-divider"]');
    const brand = chrome?.querySelector<HTMLElement>('[data-slot="app-brand"]');
    const brandIcon = brand?.querySelector<HTMLImageElement>(".slei-brand__icon");
    const sidebar = container.querySelector<HTMLElement>(".slei-workspace-sidebar");
    const header = sidebar?.querySelector<HTMLElement>('[data-slot="workspace-sidebar-header"]');
    const primaryNav = header?.querySelector<HTMLElement>('[data-slot="workspace-sidebar-primary-nav"]');
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const asset = readFileSync(join(process.cwd(), "src/assets/brand/slei-bubble.svg"), "utf8");

    expect(chrome).not.toBeNull();
    expect(container.querySelector<HTMLElement>(".slei-app-shell")?.getAttribute("data-desktop-drag-region")).toBe("deep");
    expect(chrome?.hasAttribute("data-desktop-drag-region")).toBe(false);
    expect(nativeControlsSpace).not.toBeNull();
    expect(nativeControlsSpace?.textContent).toBe("");
    expect(nativeControlsSpace?.querySelectorAll("*")).toHaveLength(0);
    expect(nativeControlsSpace?.className).toContain("slei-native-window-controls-space");
    expect(divider).not.toBeNull();
    expect(brand).not.toBeNull();
    expect(brand?.hasAttribute("data-desktop-drag-region")).toBe(false);
    expect(brand?.textContent).toBe("Slei");
    expect(brand?.querySelector(".slei-brand__name")?.textContent).toBe("Slei");
    expect(brand?.querySelector("strong")).toBeNull();
    expect(brand?.querySelector(".slei-brand__slash")).toBeNull();
    expect(brand?.querySelector(".slei-brand__flow")).toBeNull();
    expect(brandIcon).not.toBeNull();
    expect(brandIcon?.getAttribute("alt")).toBe("");
    expect(brandIcon?.getAttribute("src")).toMatch(/^(data:image\/svg\+xml|.*slei-bubble\.svg)/);
    expect(asset).toContain("<path");
    expect(frameSource).toContain("../assets/brand/slei-bubble.svg");
    expect(header).not.toBeNull();
    expect(header?.querySelector("img")).toBeNull();
    expect(header?.textContent).not.toContain("Slei");
    expect(header?.textContent).not.toContain("工作区");
    expect(header?.textContent).not.toContain("local");
    expect(primaryNav).not.toBeNull();
    expect(primaryNav?.className).toContain("grid");
    expect(header?.querySelector<HTMLElement>('[data-slot="workspace-sidebar-titlebar"]')).toBeNull();
    expect(primaryNav?.className).toContain("gap-1");
    const primaryNavButtons = Array.from(primaryNav?.querySelectorAll("button") ?? []);
    expect(primaryNavButtons.map((button) => button.textContent)).toEqual(["搜索", "任务", "已保存"]);
    expect(primaryNav?.querySelector("button")?.className).toContain("h-[32px]");
    expect(primaryNav?.querySelector("button")?.className).toContain("min-h-[32px]");
    expect(primaryNav?.querySelector("button")?.className).toContain("hover:bg-[var(--workspace-sidebar-hover-bg)]");
    expect(container.querySelector<HTMLElement>('[data-window-control="red"]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-window-control="yellow"]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-window-control="green"]')).toBeNull();
    expect(sidebarSource).not.toContain("workspace-sidebar-titlebar");
    expect(sidebarSource).not.toContain("min-h-[44px]");
    expect(sidebarSource).not.toContain('variant={input.activeView === "search" ? "primary" : "outline"}');
    expect(sidebarSource).not.toContain("../assets/brand/slei-bubble.svg");
    expect(sidebarSource).not.toContain("sleiBubbleIcon");
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

  it("keeps search active mutually exclusive from channel and direct message rows", () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      channels: [
        { id: "all", name: "all", description: "默认团队频道", unread: 0, activeSessionId: "session:all" },
        { id: "dev", name: "dev", description: "研发频道描述", unread: 0, activeSessionId: "session:dev" },
      ],
      conversations: [
        { id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" },
      ],
    });
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="dev"
        activeConversationId="dm:a1"
        activeView="search"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const sidebar = host.querySelector(".slei-workspace-sidebar");
    const currentItems = Array.from(sidebar?.querySelectorAll<HTMLElement>('[aria-current]') ?? []);
    const selectedChannel = sidebar?.querySelector<HTMLElement>('[data-channel-id="dev"]');
    const selectedDm = sidebar?.querySelector<HTMLElement>('[data-conversation-id="dm:a1"]');

    expect(currentItems).toHaveLength(1);
    expect(currentItems[0]?.textContent).toContain("搜索");
    expect(selectedChannel?.querySelector('[aria-current="true"]')).toBeNull();
    expect(selectedChannel?.className).not.toContain("bg-[var(--workspace-sidebar-active-bg)]");
    expect(selectedDm?.querySelector('[aria-current="true"]')).toBeNull();
    expect(selectedDm?.className).not.toContain("bg-[var(--workspace-sidebar-active-bg)]");
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

  it("returns to the chat workspace when selecting a sidebar channel from search or tasks", async () => {
    for (const activeView of ["search", "tasks"] as const) {
      const onChannelSelect = vi.fn();
      const onViewChange = vi.fn();
      const data = createSleiFixtures({
        channels: [
          { id: "ops", name: "ops", description: "运维频道描述", unread: 0, activeSessionId: "session:ops" },
          { id: "dev", name: "dev", description: "研发频道描述", unread: 0, activeSessionId: "session:dev" },
        ],
      });
      const container = await mount(
        <SleiAppFrame
          activeChannelId="ops"
          activeView={activeView}
          data={data}
          locale="zh-CN"
          onChannelSelect={onChannelSelect}
          onViewChange={onViewChange}
          runtimeSetup={runtimeSetup}
        />,
      );

      await clickElement(container.querySelector<HTMLButtonElement>('[data-testid="workspace-channel-row-dev"] [data-slot="channel-select-trigger"]'));

      expect(onChannelSelect).toHaveBeenCalledWith("dev");
      expect(onViewChange).toHaveBeenCalledWith("chat");
      await act(async () => {
        mountedRoot?.unmount();
      });
      mountedRoot = undefined;
      mountedContainer?.remove();
      mountedContainer = undefined;
    }
  });

  it("uses a chrome shell with sidebar and workspace cards instead of the old flush grid", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(html).toContain("slei-app-shell");
    expect(html).toContain('data-slot="app-chrome"');
    expect(html).toContain('data-slot="app-content"');
    expect(html).toContain('data-slot="workspace-card"');
    expect(appCss).toContain(".slei-app-shell {");
    expect(appCss).toContain("grid-template-rows: var(--app-chrome-height) minmax(0, 1fr)");
    expect(appCss).toContain(".slei-app-content {");
    expect(appCss).toContain("grid-template-columns: max(var(--app-sidebar-width, 260px), 260px) minmax(0, 1fr)");
    expect(appCss).toContain("padding: var(--app-gap-xs) var(--app-shell-inline-inset) var(--app-shell-bottom-inset)");
    expect(appCss).toContain(".slei-workspace-sidebar-card {");
    expect(appCss).toContain(".slei-workspace-card {");
    expect(html).not.toContain("5.25rem");
    expect(html).not.toContain("grid h-14 w-14 place-items-center");
  });

  it("renders primary sidebar navigation in search, tasks, saved order", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    const searchIndex = html.indexOf(">搜索<");
    const tasksIndex = html.indexOf(">任务<");
    const savedIndex = html.indexOf('data-testid="slei-sidebar-saved"');

    expect(searchIndex).toBeGreaterThanOrEqual(0);
    expect(tasksIndex).toBeGreaterThan(searchIndex);
    expect(savedIndex).toBeGreaterThan(tasksIndex);
  });

  it("opens saved messages from the primary sidebar navigation without opening settings overlay", async () => {
    const onSavedMessagesOpen = vi.fn();
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        onSavedMessagesOpen={onSavedMessagesOpen}
        runtimeSetup={runtimeSetup}
      />,
    );

    await clickElement(container.querySelector('[data-testid="slei-sidebar-saved"]'));

    expect(onSavedMessagesOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="slei-settings-overlay"]')).toBeNull();
  });

  it("opens the full settings page directly from the footer settings button", async () => {
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

    await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));

    expect(onViewChange).not.toHaveBeenCalledWith("settings");
    expect(document.querySelector('[data-testid="slei-sidebar-settings-menu"]')).toBeNull();
    expect(container.querySelector('[data-testid="slei-settings-overlay"]')).toBeNull();
    expect(container.querySelector('[data-testid="slei-settings-sidebar-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("enter");
    expect(container.querySelector('[data-testid="slei-settings-detail-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("enter");
    expect(container.querySelector('[data-testid="slei-sidebar-chat-page"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[data-testid="slei-sidebar-chat-page"]')?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector('[data-testid="slei-workspace-chat-page"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[data-testid="slei-workspace-chat-page"]')?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector('[data-slot="sidebar-card"]')?.getAttribute("data-settings-page-motion")).toBeNull();
    expect(container.querySelector('[data-slot="sidebar-card"]')?.className.split(/\s+/)).not.toContain("slei-settings-page-sidebar-content");
    expect(container.querySelector('[data-slot="sidebar-card"]')?.className.split(/\s+/)).not.toContain("hidden");
    expect(container.querySelector('[data-slot="workspace-card"]')?.getAttribute("data-settings-page-motion")).toBeNull();
    expect(container.querySelector('[data-slot="workspace-card"]')?.className.split(/\s+/)).not.toContain("slei-settings-page-detail-content");
    expect(container.querySelector('[data-slot="workspace-card"]')?.getAttribute("aria-hidden")).toBeNull();
    expect(container.querySelector('[data-slot="workspace-card"]')?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector('[data-testid="slei-settings-overlay-nav"]')?.textContent).toContain("账号资料");
    expect(container.querySelector('[data-testid="slei-settings-overlay-detail"]')?.textContent).toContain("个人资料");
  });

  it("keeps settings overlay mounted in an exit motion state before unmounting on return", async () => {
    vi.useFakeTimers();
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));

    expect(container.querySelector('[data-testid="slei-settings-sidebar-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("enter");
    expect(container.querySelector('[data-testid="slei-settings-detail-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("enter");

    await clickElement(container.querySelector('[data-testid="slei-settings-return"]'));

    expect(container.querySelector('[data-testid="slei-settings-sidebar-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("exit");
    expect(container.querySelector('[data-testid="slei-settings-detail-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("exit");
    expect(container.querySelector('[data-slot="sidebar-card"]')?.getAttribute("data-settings-page-motion")).toBeNull();
    expect(container.querySelector('[data-slot="sidebar-card"]')?.className.split(/\s+/)).not.toContain("hidden");
    expect(container.querySelector('[data-slot="workspace-card"]')?.getAttribute("data-settings-page-motion")).toBeNull();
    expect(container.querySelector('[data-slot="workspace-card"]')?.className.split(/\s+/)).not.toContain("slei-settings-page-detail-content");

    await act(async () => {
      vi.advanceTimersByTime(999);
    });

    expect(container.querySelector('[data-testid="slei-settings-sidebar-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("exit");
    expect(container.querySelector('[data-testid="slei-settings-detail-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("exit");
    expect(container.querySelector('[data-testid="slei-sidebar-settings-page"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="slei-detail-settings-page"]')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(container.querySelector('[data-testid="slei-settings-sidebar-swiper"]')?.getAttribute("data-settings-page-motion")).toBeNull();
    expect(container.querySelector('[data-testid="slei-settings-detail-swiper"]')?.getAttribute("data-settings-page-motion")).toBeNull();
    expect(container.querySelector('[data-testid="slei-sidebar-settings-page"]')).toBeNull();
    expect(container.querySelector('[data-testid="slei-detail-settings-page"]')).toBeNull();
  });

  it("uses horizontal block page transitions for settings without opacity fading", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const overlayCss = appCss.slice(appCss.indexOf(".slei-settings-block-swiper {"), appCss.indexOf(".slei-workspace-sidebar-card {"));

    expect(appCss).toContain("--settings-sidebar-motion-dur: 500ms;");
    expect(appCss).toContain("--settings-detail-motion-dur: 750ms;");
    expect(overlayCss).toContain("transform: translateX(-100%)");
    expect(overlayCss).toContain("transform: translateX(100%)");
    expect(overlayCss).toContain(".slei-settings-block-swiper[data-settings-page-motion=\"enter\"] .slei-settings-sidebar-chat-page");
    expect(overlayCss).toContain(".slei-settings-block-swiper[data-settings-page-motion=\"enter\"] .slei-settings-detail-chat-page");
    expect(overlayCss).toContain(
      "animation: slei-settings-sidebar-settings-enter var(--settings-sidebar-motion-dur) var(--settings-overlay-motion-ease) both;",
    );
    expect(overlayCss).toContain(
      "animation: slei-settings-detail-settings-enter var(--settings-detail-motion-dur) var(--settings-overlay-motion-ease) both;",
    );
    expect(overlayCss).not.toContain(".slei-settings-page-sidebar-content[data-settings-page-motion=\"enter\"]");
    expect(overlayCss).not.toContain(".slei-settings-page-detail-content[data-settings-page-motion=\"enter\"]");
    expect(overlayCss).not.toContain("translateY(100%)");
    expect(overlayCss).not.toContain("opacity:");
  });

  it("renders real members and devices in settings overlay workspace submenus", async () => {
    const onMemberSelect = vi.fn();
    const data = createSleiFixtures({ members: createDemoMembers() });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        onMemberSelect={onMemberSelect}
        runtimeSetup={{ ...runtimeSetup, nodes: readyNodes }}
      />,
    );

    await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));

    const overlay = container.querySelector('[data-testid="slei-settings-overlay-nav"]');
    expect(overlay?.textContent).toContain("Coda");
    expect(overlay?.textContent).toContain("研发团队开发工程师。");
    expect(overlay?.textContent).not.toContain("@Coda");
    expect(overlay?.textContent).toContain("Cindy");
    expect(overlay?.textContent).toContain("本机设备");
    expect(overlay?.textContent).not.toContain("成员列表");
    expect(overlay?.textContent).not.toContain("设备列表");

    await clickElement(Array.from(overlay?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("Cindy")));

    expect(onMemberSelect).toHaveBeenCalledWith("a2");
    expect(container.querySelector('[data-settings-embedded-detail="members"]')).toBeTruthy();

    await clickElement(Array.from(overlay?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("本机设备")));

    expect(container.querySelector('[data-settings-embedded-detail="devices"]')).toBeTruthy();
  });

  it("keeps legacy activeView settings route available for compatibility", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={createSleiFixtures()}
        initialSettingsPanel="account"
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('data-settings-panel="account"');
  });

  it("uses shadcn primitives for the sidebar create overlay while settings opens the full page directly", async () => {
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");
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

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="打开设置"]'));

    expect(onViewChange).not.toHaveBeenCalledWith("settings");
    expect(container.querySelector('[data-testid="slei-settings-sidebar-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("enter");
    expect(container.querySelector('[data-testid="slei-settings-overlay-nav"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="slei-sidebar-settings-menu"]')).toBeNull();
    expect(sidebarSource).not.toContain('data-slot="dialog-portal"');
    expect(sidebarSource).not.toContain('role="dialog"');
    expect(sidebarSource).not.toContain("typeof document");

    await clickElement(container.querySelector<HTMLButtonElement>('button[aria-label="创建频道"]'));

    expect(document.body.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull();
    expect(document.body.querySelector('[data-slot="dialog-content"]')?.getAttribute("role")).toBe("dialog");
    expect(document.body.querySelector('[data-slot="dialog-title"]')?.textContent).toContain("创建频道");
  });

  it("opens channel and DM menus only from row more buttons and highlights the menu row", async () => {
    const onMemberSelect = vi.fn();
    const onViewChange = vi.fn();
    const onConversationSelect = vi.fn();
    const onConversationMessagesClear = vi.fn();
    const onAgentDelete = vi.fn();
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
        onConversationMessagesClear={onConversationMessagesClear}
        onAgentDelete={onAgentDelete}
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

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="频道 dev 更多操作"]'));
    expect(document.body.textContent).toContain("编辑频道");
    expect(document.body.textContent).toContain("删除频道");
    expect(devRow?.className).toContain("bg-[var(--workspace-sidebar-active-bg)]");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => undefined);
    expect(openDropdownMenuContent()).toBeNull();

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="频道 all 更多操作"]'));
    expect(document.body.textContent).toContain("编辑频道");
    expect(document.body.textContent).not.toContain("删除频道");
    expect(allRow?.className).toContain("bg-[var(--workspace-sidebar-active-bg)]");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => undefined);
    expect(openDropdownMenuContent()).toBeNull();

    await act(async () => {
      devRow?.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(openDropdownMenuContent()).toBeNull();

    await act(async () => {
      devRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(openDropdownMenuContent()).toBeNull();

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="Coda 更多操作"]'));
    expect(document.body.textContent).toContain("打开成员资料");
    expect(document.body.textContent).toContain("清空聊天记录");
    expect(document.body.textContent).toContain("删除成员");
    expect(document.body.textContent).not.toContain("打开私聊");
    expect(dmRow?.className).toContain("bg-[var(--workspace-sidebar-active-bg)]");

    await clickDropdownItem("打开成员资料");
    expect(onMemberSelect).toHaveBeenCalledWith("a1");
    expect(onViewChange).toHaveBeenCalledWith("members");

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="Coda 更多操作"]'));
    await clickDropdownItem("清空聊天记录");
    expect(document.body.textContent).toContain("确定清空与 Coda 的聊天记录");
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("清空聊天记录"))
        ?.click();
    });
    expect(onConversationMessagesClear).toHaveBeenCalledWith("dm:agent_coda");
    expect(onConversationSelect).not.toHaveBeenCalled();

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="Coda 更多操作"]'));
    await clickDropdownItem("删除成员");
    expect(document.body.textContent).toContain("确定删除 Coda 吗");
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("删除"))
        ?.click();
    });
    expect(onAgentDelete).toHaveBeenCalledWith("a1");

    const dmWithoutConversationRow = container.querySelector<HTMLElement>('[data-testid="workspace-dm-row-a2"]');
    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="Cindy 更多操作"]'));
    expect(document.body.textContent).not.toContain("清空聊天记录");
    expect(document.body.textContent).toContain("删除成员");
    expect(dmWithoutConversationRow?.className).toContain("bg-[var(--workspace-sidebar-active-bg)]");
  });

  it("keeps the sidebar channel delete menu item visually neutral before confirmation", async () => {
    const data = createSleiFixtures({
      channels: [
        { id: "ops", name: "ops", description: "运维频道描述", unread: 0, activeSessionId: "session:ops" },
        { id: "dev", name: "dev", description: "研发频道描述", unread: 0, activeSessionId: "session:dev" },
      ],
    });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="频道 dev 更多操作"]'));

    const deleteItem = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
      .find((item) => item.textContent?.includes("删除频道"));
    expect(deleteItem).toBeTruthy();
    expect(deleteItem?.getAttribute("data-variant")).not.toBe("destructive");
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

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="频道 dev 更多操作"]'));
    await clickDropdownItem("编辑频道");

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

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="频道 dev 更多操作"]'));
    await clickDropdownItem("编辑频道");

    expect(onChannelSelect).toHaveBeenCalledWith("dev");
    expect(onViewChange).toHaveBeenCalledWith("chat");
  });

  it("confirms channel deletion from the workspace sidebar menu", async () => {
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
    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="频道 all 更多操作"]'));
    expect(document.body.textContent).not.toContain("删除频道");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => undefined);
    expect(openDropdownMenuContent()).toBeNull();

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="频道 dev 更多操作"]'));
    await clickDropdownItem("删除频道");
    expect(onChannelDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("确定删除 #dev？");

    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-slot="alert-dialog-cancel"]')?.click();
    });
    expect(onChannelDelete).not.toHaveBeenCalled();

    await clickElement(container.querySelector<HTMLButtonElement>('[aria-label="频道 dev 更多操作"]'));
    await clickDropdownItem("删除频道");
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

  it("renders sidebar and workspace as separated cards without a flush sidebar divider", () => {
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const sidebarCss = appCss.slice(appCss.indexOf(".slei-workspace-sidebar {"), appCss.indexOf(".slei-workspace-sidebar__header {"));

    expect(sidebarSource).not.toContain("border-r border-sidebar-border/65");
    expect(sidebarSource).toContain("slei-workspace-sidebar h-full min-h-0 text-sidebar-foreground max-[760px]:hidden");
    expect(sidebarCss).not.toContain("inset -1px 0 0");
    expect(appCss).toContain("gap: var(--app-card-gap)");
    expect(appCss).toContain("border: 0.5px solid var(--app-card-border)");
    expect(appCss).toContain("border-radius: var(--app-card-radius)");
    expect(sidebarCss).not.toContain("inset -8px 0 18px");
  });

  it("matches the reference frosted shell spacing, card fill, borders, radii, and shadows", () => {
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const sidebarCss = appCss.slice(appCss.indexOf(".slei-workspace-sidebar {"), appCss.indexOf(".slei-app-shell {"));
    const shellCss = appCss.slice(appCss.indexOf(".slei-app-shell {"), appCss.indexOf(".slei-app-chrome {"));

    expect(appCss).toContain("--glass-bg:");
    expect(appCss).toContain("--glass-border:");
    expect(appCss).toContain("--glass-blur:");
    expect(appCss).toContain("--app-chrome-height: 36px");
    expect(appCss).toContain("--app-native-controls-width: 66px");
    expect(appCss).toContain(".slei-app-chrome__divider {\n  width: 1px;\n  height: 14px;");
    expect(appCss).toContain(".slei-app-chrome__divider {\n    height: 18px;");
    expect(appCss).toContain("--app-card-gap: 8px");
    expect(appCss).toContain("--app-shell-inline-inset: 12px");
    expect(appCss).toContain("--app-shell-bottom-inset: 12px");
    expect(appCss).toContain("--app-card-radius: 16px");
    expect(appCss).toContain("--app-shell-radius: 0px");
    expect(appCss).toContain("--app-shell-bg: rgba(237, 239, 243, 0.72)");
    expect(appCss).toContain("--app-shell-border: transparent");
    expect(appCss).toContain("--app-shell-shadow: none");
    expect(appCss).toContain("--app-card-border: rgba(255, 255, 255, 0.8)");
    expect(appCss).toContain("--app-card-shadow: 0 1px 3px rgba(16, 24, 40, 0.05), 0 12px 28px rgba(16, 24, 40, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.7)");
    expect(appCss).toContain("--workspace-sidebar-bg: rgba(255, 255, 255, 0.62)");
    expect(appCss).toContain("--workspace-glass-bg: rgba(255, 255, 255, 0.76)");
    expect(appCss).toContain("--settings-sidebar-bg: rgb(248 249 251)");
    expect(appCss).toContain("--settings-detail-bg: rgb(249 249 250)");
    expect(appCss).toContain("--settings-section-bg: var(--card)");
    expect(appCss).toContain("--settings-section-border: var(--border)");
    const darkThemeCss = appCss.slice(appCss.indexOf(".dark {"), appCss.indexOf(".light {"));
    expect(darkThemeCss).toContain("--settings-section-bg: rgb(25 32 43)");
    expect(darkThemeCss).toContain("--settings-section-border: rgb(255 255 255 / 0.08)");
    expect(darkThemeCss).not.toContain("--settings-section-bg: var(--card)");
    expect(appCss).toContain("--workspace-sidebar-hover-bg: rgba(0, 0, 0, 0.04)");
    expect(appCss).toContain("--workspace-sidebar-active-bg: rgba(0, 0, 0, 0.08)");
    expect(appCss).toContain("--glass-surface-filter: blur(20px) saturate(150%)");
    expect(appCss).toContain("--chrome-surface-filter: blur(40px) saturate(150%)");
    expect(appCss).not.toContain(".slei-app-shell::before");
    expect(appCss).toContain("background: var(--app-shell-bg)");
    expect(appCss).toContain("border: 0 solid var(--app-shell-border)");
    expect(appCss).toContain("border-radius: var(--app-shell-radius)");
    expect(appCss).toContain("box-shadow: var(--app-shell-shadow)");
    expect(appCss).toContain("padding: 0 16px");
    expect(appCss).not.toContain("padding-top:");
    expect(appCss).toContain("backdrop-filter: var(--chrome-surface-filter)");
    expect(appCss).not.toContain("--app-shell-bg: #");
    expect(shellCss).not.toContain("border-radius: 28px");
    expect(appCss).not.toContain("0 3px 4px color-mix(in srgb, rgb(61 74 95");
    expect(sidebarSource).not.toContain("bg-sidebar/");
    expect(frameSource).not.toContain("bg-sidebar/");
    expect(sidebarCss).toContain("background: transparent");
    expect(sidebarCss).not.toContain("background: var(--glass-sidebar-bg)");
    expect(sidebarCss).not.toContain("-webkit-backdrop-filter: var(--chrome-surface-filter)");
    expect(sidebarCss).not.toContain("backdrop-filter: var(--chrome-surface-filter)");
    expect(appCss).toContain('.slei-workspace-sidebar [data-slot="agent-activity"]');
    expect(appCss).toContain("background: transparent");
    expect(appCss).toContain(".slei-workspace-sidebar-card {\n  background: var(--workspace-sidebar-bg);");
    expect(appCss).toContain(".slei-workspace-card {\n  background: var(--workspace-glass-bg);");
  });

  it("keeps the native window and shell roots transparent so glass surfaces reveal apps behind Slei", () => {
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(frameSource).not.toContain("overflow-hidden bg-background text-foreground");
    expect(frameSource).toContain("overflow-hidden bg-transparent text-foreground");
    expect(frameSource).not.toContain('className="slei-workspace min-h-0 min-w-0 overflow-hidden bg-background"');
    expect(frameSource).not.toContain('className="slei-workspace slei-glass-workspace min-h-0 min-w-0 overflow-hidden bg-transparent"');
    expect(frameSource).toContain('"slei-workspace slei-workspace-card slei-glass-workspace min-h-0 min-w-0 overflow-hidden bg-transparent"');
    expect(appCss).toContain(".slei-glass-workspace {");
    expect(appCss).toContain("backdrop-filter: var(--glass-surface-filter)");
    expect(appCss).toContain("--background: oklch(1 0 0)");
    expect(appCss).toContain("--background: oklch(0.145 0 0)");
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
    expect(sidebarSource).toContain('variant="ghost"');
    expect(sidebarSource).toContain("h-[32px] min-h-[32px]");
    expect(sidebarSource).toContain("hover:bg-[var(--workspace-sidebar-hover-bg)]");
    expect(sidebarSource).toContain("shadow-none");
    expect(sidebarSource).not.toContain('variant={input.activeView === "search" ? "primary" : "outline"}');
    expect(sidebarSource).not.toContain('variant={input.activeView === "tasks" ? "primary" : "outline"}');
  });

  it("renders the active sidebar action as a flat ghost button", () => {
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

    expect(searchButtonOpenTag).toContain("bg-[var(--workspace-sidebar-active-bg)]");
    expect(searchButtonOpenTag).toContain("h-[32px]");
    expect(searchButtonOpenTag).toContain("min-h-[32px]");
    expect(searchButtonOpenTag).toContain("hover:bg-[var(--workspace-sidebar-hover-bg)]");
    expect(searchButtonOpenTag).not.toContain("slei-shell-nav__button--flow");
  });

  it("keeps search icons in the sidebar and member icons registered for shared use", () => {
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");
    const iconsSource = readFileSync(join(process.cwd(), "src/components/icons.tsx"), "utf8");

    expect(sidebarSource).toContain('name="search"');
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

  it("uses Vega neutral accent tokens instead of the old chroma palette", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const accentDeclarations = Array.from(appCss.matchAll(/--accent:\s*oklch\(([^;]+)\);/g), (match) => match[1]);

    expect(accentDeclarations).toHaveLength(3);
    expect(accentDeclarations).toEqual(["0.97 0 0", "0.269 0 0", "0.97 0 0"]);
    expect(accentDeclarations.some((value) => value.endsWith("185") || value.endsWith("190") || value.endsWith("285"))).toBe(false);
  });

  it("keeps workspace sidebar button chrome off shared shadcn button variants", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const sidebarChromeCss = appCss.slice(appCss.indexOf(".slei-workspace-sidebar {"), appCss.indexOf(".slei-workspace-sidebar__header {"));

    expect(sidebarChromeCss).not.toContain("__button");
    expect(sidebarChromeCss).not.toContain("border-color: var(--glass-button-border)");
    expect(sidebarChromeCss).not.toContain("box-shadow: var(--glass-button-shadow)");
    expect(sidebarChromeCss).not.toContain("color-mix(in srgb, var(--primary) 28%, var(--menu-border))");
    expect(sidebarChromeCss).not.toContain("var(--raised-border)");
  });

  it("uses default shadcn buttons for modal confirmation actions", () => {
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const sidebarSource = readFileSync(join(process.cwd(), "src/app/WorkspaceSidebar.tsx"), "utf8");

    expect(sidebarSource).toContain('<Button onClick={() => projectFolderInputRef.current?.click()} type="button" variant="outline">');
    expect(sidebarSource).not.toContain('<Button onClick={() => projectFolderInputRef.current?.click()} type="button">');
    expect(sidebarSource).toContain('aria-label={input.messages.chat.createChannel} className="min-w-20" disabled={creatingChannel} type="submit"');
    expect(frameSource).toContain('<Button type="submit"><SleiIcon name="plus" size={14} />{input.messages.common.create}</Button>');
    expect(frameSource).toContain('<Button disabled={createDisabled} type="submit">{input.messages.common.create}</Button>');
    expect(frameSource).toContain('disabled={input.loading} onClick={() => input.onRefreshRuntime?.()} type="button"');
  });

  it("keeps TooltipProvider at the app frame instead of nesting it in each Tooltip", () => {
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const tooltipSource = readFileSync(join(process.cwd(), "src/components/ui/tooltip.tsx"), "utf8");
    const tooltipRootSource = tooltipSource.slice(tooltipSource.indexOf("function Tooltip("), tooltipSource.indexOf("function TooltipTrigger("));

    expect(frameSource).toContain("<TooltipProvider>");
    expect(tooltipRootSource).not.toContain("<TooltipProvider>");
  });

  it("keeps app chrome branding visually quiet", () => {
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const frameSource = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const asset = readFileSync(join(process.cwd(), "src/assets/brand/slei-bubble.svg"), "utf8");

    expect(frameSource).toContain('className="slei-brand__name"');
    expect(frameSource).not.toContain("messages.shell.appChrome.collaborationFlow");
    expect(frameSource).not.toContain("slei-brand__slash");
    expect(frameSource).not.toContain("slei-brand__flow");
    expect(asset).not.toContain("<filter");
    expect(asset).not.toContain("feDropShadow");
    expect(asset).not.toContain("filter=\"url(");
    expect(appCss).toContain(".slei-brand__icon");
    expect(appCss).toContain("box-shadow: none;");
    expect(appCss).toContain(".slei-brand__name");
    expect(appCss).toContain("font-weight: 500;");
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
    expect(html).toContain(">私聊 4</");
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
    expect(rows[0]?.className).toContain("py-0");
    expect(rows.every((row) => row.querySelector('[data-slot="card-content"]'))).toBe(true);
    expect(rows[0]?.querySelector('[data-slot="card-content"]')?.className).toContain("px-3 py-2.5");
    expect(rows[0]?.querySelector(".grid.min-w-0")?.className).toContain("gap-1.5");
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

  it("routes the chat header member direct-message button through onMemberMessage", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onMemberMessage = vi.fn();
    const [member] = createDemoMembers();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
      members: [{ ...member, channelReadiness: { all: "ready" } }],
    });

    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        onMemberMessage={onMemberMessage}
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    await clickElement(container.querySelector('[data-testid="slei-channel-member-avatar-trigger"]'));
    await clickElement(document.body.querySelector('[data-testid="slei-channel-member-message-button"]'));

    expect(onMemberMessage).toHaveBeenCalledTimes(1);
    expect(onMemberMessage).toHaveBeenCalledWith(member.id);
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

  it("renders sidebar channel hash marks as bold text-color-3 text without italics", () => {
    const data = createSleiFixtures({
      channels: [
        { id: "all", name: "all", description: "默认团队频道", unread: 0, activeSessionId: "session:all" },
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
    const hashMark = host.querySelector<HTMLElement>('[data-channel-id="all"] [data-slot="channel-hash-mark"]');

    expect(hashMark?.tagName).toBe("SPAN");
    expect(hashMark?.textContent).toBe("#");
    expect(hashMark?.className).toContain("font-bold");
    expect(hashMark?.className).not.toContain("italic");
    expect(hashMark?.className).toContain("text-[var(--text-color-3)]");
    expect(hashMark?.querySelector('[data-slei-icon="hash"]')).toBeNull();
  });

  it("uses flat selected states for sidebar channels and direct messages", () => {
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

    expect(selectedChannel?.className).toContain("bg-[var(--workspace-sidebar-active-bg)]");
    expect(selectedChannel?.className).toContain("shadow-none");
    expect(selectedChannel?.className).toContain("backdrop-blur-none");
    expect(selectedChannel?.className).not.toContain("shadow-[0_10px_28px");
    expect(selectedChannel?.className).not.toContain("bg-accent");
    expect(selectedChannel?.className).not.toContain("text-accent-foreground");
    expect(selectedChannel?.closest('[data-slot="scroll-area"]')?.className).not.toContain("-mx-");
    expect(selectedChannel?.closest('[data-slot="scroll-area"]')?.className).not.toContain("-my-");
    expect(selectedChannel?.closest('[data-slot="scroll-area"]')?.querySelector('[data-channel-scroll-content]')?.className).toContain("px-3");
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

    expect(selectedDm?.className).toContain("bg-[var(--workspace-sidebar-active-bg)]");
    expect(selectedDm?.className).toContain("backdrop-blur-none");
    expect(selectedDm?.className).toContain("shadow-none");
    expect(selectedDm?.className).not.toContain("bg-accent");
    expect(selectedDm?.className).not.toContain("text-accent-foreground");
  });

  it("renders direct message rows with the status dot inside the avatar, a sidebar avatar, and a profession badge", () => {
    const longProfession = "资深平台架构与交付协调负责人".repeat(3);
    const members = createDemoMembers().map((member, index) => (
      index === 0
        ? {
            ...member,
            profession: longProfession,
            role: "后备角色",
          }
        : member
    ));
    const data = createSleiFixtures({
      members,
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0, activeSessionId: "session:all" }],
      conversations: [{ id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" }],
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
    const trigger = host.querySelector<HTMLElement>('[data-slot="direct-message-select-trigger"]');
    const directChildren = Array.from(trigger?.children ?? []);
    const avatar = directChildren[0]?.matches('[data-slot="avatar"]')
      ? directChildren[0] as HTMLElement
      : directChildren[0]?.querySelector<HTMLElement>('[data-slot="avatar"]');
    const statusDot = avatar?.querySelector<HTMLElement>('[aria-label="idle"]');
    const nameContainer = trigger?.querySelector<HTMLElement>('[data-slot="direct-message-name"]');
    const name = nameContainer?.querySelector<HTMLElement>("span");
    const badge = nameContainer?.querySelector<HTMLElement>('[data-slot="badge"]');
    const directMessageList = host.querySelector<HTMLElement>('[data-slot="direct-message-list"]');
    const row = host.querySelector<HTMLElement>('[data-testid="workspace-dm-row-a1"]');
    const rowButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="workspace-dm-row-a1"] button'));
    const menuButton = rowButtons.find((button) => button !== trigger);

    expect(directMessageList?.querySelector('[data-direct-message-list-item]')).not.toBeNull();
    expect(directMessageList?.className).not.toContain("pr-2");
    expect(row?.className).toContain("px-2.5");
    expect(trigger?.className).toContain("h-full");
    expect(trigger?.className).toContain("px-0");
    expect(row?.className).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(menuButton).toBeInstanceOf(HTMLElement);
    expect(menuButton?.className).toContain("shrink-0");
    expect(menuButton?.className).toContain("opacity-0");
    expect(menuButton?.className).toContain("size-6");
    expect(menuButton?.className).not.toContain("mr-1");
    expect(statusDot?.getAttribute("role")).toBe("img");
    expect(statusDot?.className).toContain("rounded-full");
    expect(statusDot?.className.split(/\s+/)).toContain("absolute");
    expect(statusDot?.className.split(/\s+/)).toContain("bottom-0");
    expect(statusDot?.className.split(/\s+/)).toContain("right-0");
    expect(statusDot?.parentElement).toBe(avatar);
    expect(avatar?.getAttribute("data-avatar-size")).toBe("sidebar");
    expect(avatar?.getAttribute("data-size")).toBe("default");
    expect(avatar?.className.split(/\s+/)).toContain("size-[1.875rem]");
    expect(avatar?.className.split(/\s+/)).toContain("border-muted-foreground/30");
    expect(avatar?.className.split(/\s+/)).not.toContain("border-border");
    expect(nameContainer?.className).toContain("flex");
    expect(nameContainer?.className).toContain("min-w-0");
    expect(nameContainer?.className).toContain("flex-1");
    expect(nameContainer?.className).toContain("items-center");
    expect(nameContainer?.className).toContain("gap-1.5");
    expect(nameContainer?.className).toContain("overflow-hidden");
    expect(nameContainer?.className).toContain("whitespace-nowrap");
    expect(name?.tagName).toBe("SPAN");
    expect(name?.textContent).toBe("Coda");
    expect(name?.className).toContain("text-[14px]");
    expect(name?.className).toContain("font-normal");
    expect(badge?.getAttribute("data-variant")).toBe("secondary");
    expect(badge?.textContent).toBe(longProfession);
    expect(badge?.className).toContain("min-w-0");
    expect(badge?.className).toContain("max-w-[55%]");
    expect(badge?.className).toContain("shrink");
    expect(badge?.className).toContain("truncate");
  });

  it("renders direct message badges from profession first, then role, and hides empty badges", () => {
    const members = createDemoMembers().slice(0, 3).map((member, index) => ({
      ...member,
      profession: index === 0 ? "  首席体验架构师  " : index === 1 ? "   " : " ",
      role: index === 0 ? "后备角色" : index === 1 ? "  解决方案顾问  " : "   ",
    }));
    const data = createSleiFixtures({
      members,
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0, activeSessionId: "session:all" }],
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

    const firstTrigger = host.querySelector<HTMLElement>('[data-testid="workspace-dm-row-a1"] [data-slot="direct-message-select-trigger"]');
    const firstNameContainer = firstTrigger?.querySelector<HTMLElement>('[data-slot="direct-message-name"]');
    const firstBadge = firstNameContainer?.querySelector<HTMLElement>('[data-slot="badge"]');
    const firstRow = host.querySelector<HTMLElement>('[data-testid="workspace-dm-row-a1"]');

    const secondTrigger = host.querySelector<HTMLElement>('[data-testid="workspace-dm-row-a2"] [data-slot="direct-message-select-trigger"]');
    const secondNameContainer = secondTrigger?.querySelector<HTMLElement>('[data-slot="direct-message-name"]');
    const secondBadge = secondNameContainer?.querySelector<HTMLElement>('[data-slot="badge"]');

    const thirdTrigger = host.querySelector<HTMLElement>('[data-testid="workspace-dm-row-a3"] [data-slot="direct-message-select-trigger"]');
    const thirdNameContainer = thirdTrigger?.querySelector<HTMLElement>('[data-slot="direct-message-name"]');
    const thirdBadge = thirdNameContainer?.querySelector<HTMLElement>('[data-slot="badge"]');

    const channelRow = host.querySelector<HTMLElement>('[data-testid="workspace-channel-row-all"]');

    expect(firstBadge?.textContent).toBe("首席体验架构师");
    expect(firstBadge?.getAttribute("data-variant")).toBe("secondary");
    expect(firstBadge?.className).toContain("min-w-0");
    expect(firstBadge?.className).toContain("max-w-[55%]");
    expect(firstBadge?.className).toContain("shrink");
    expect(firstBadge?.className).toContain("truncate");
    expect(firstRow?.className).toContain("h-10");
    expect(firstRow?.className).toContain("min-h-10");
    expect(firstTrigger?.className).toContain("h-full");

    expect(secondBadge?.textContent).toBe("解决方案顾问");
    expect(secondBadge?.getAttribute("data-variant")).toBe("secondary");

    expect(thirdBadge).toBeNull();
    expect(channelRow?.className).toContain("h-[32px]");
    expect(channelRow?.className).toContain("min-h-[32px]");
  });

  it("shows every direct-message enabled agent before a DM conversation exists", async () => {
    const members = createDemoMembers();
    const onMemberMessage = vi.fn();
    const data = createSleiFixtures({
      members,
      conversations: [],
    });

    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        onMemberMessage={onMemberMessage}
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    const dmRows = Array.from(container.querySelectorAll<HTMLElement>("[data-direct-message-list-item]"));
    const agentMembers = members.filter((member) => member.type === "agent" && member.directMessageEnabled !== false);
    expect(container.textContent).toContain(`私聊 ${agentMembers.length}`);
    expect(dmRows.map((row) => row.dataset.memberId)).toEqual(agentMembers.map((member) => member.id));
    expect(container.querySelector('[data-testid="workspace-dm-row-a1"]')?.textContent).toContain("Coda");

    await clickElement(container.querySelector('[data-testid="workspace-dm-row-a1"] [data-slot="direct-message-select-trigger"]'));

    expect(onMemberMessage).toHaveBeenCalledTimes(1);
    expect(onMemberMessage).toHaveBeenCalledWith("a1");
  });

  it("opens the member creation modal from the direct-message sidebar plus action", async () => {
    const members = createDemoMembers();
    const onMemberMessage = vi.fn();
    const data = createSleiFixtures({ members, conversations: [] });

    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        onMemberMessage={onMemberMessage}
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    await clickElement(container.querySelector('[data-testid="slei-direct-message-create-trigger"]'));

    expect(document.body.querySelector('[data-testid="slei-direct-message-create-dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("创建智能体");
    expect(document.body.textContent).toContain("成员信息");
    expect(document.body.querySelector("#slei-agent-name")).not.toBeNull();
    expect(onMemberMessage).not.toHaveBeenCalled();
  });

  it("selects existing direct-message conversations without recreating them", async () => {
    const members = createDemoMembers();
    const onConversationSelect = vi.fn();
    const onMemberMessage = vi.fn();
    const data = createSleiFixtures({
      members,
      conversations: [{ id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" }],
    });

    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        onConversationSelect={onConversationSelect}
        onMemberMessage={onMemberMessage}
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    await clickElement(container.querySelector('[data-testid="workspace-dm-row-a1"] [data-slot="direct-message-select-trigger"]'));

    expect(onConversationSelect).toHaveBeenCalledTimes(1);
    expect(onConversationSelect).toHaveBeenCalledWith("dm:a1");
    expect(onMemberMessage).not.toHaveBeenCalled();
  });

  it("closes the settings overlay before opening a member direct message", async () => {
    vi.useFakeTimers();
    const members = createDemoMembers();
    const onMemberMessage = vi.fn();
    const data = createSleiFixtures({ members });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        onMemberMessage={onMemberMessage}
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));
    await clickElement(container.querySelector('[data-settings-submenu="members"] button'));
    await clickElement(container.querySelector('[data-testid="slei-member-header-message-button"]'));

    expect(onMemberMessage).toHaveBeenCalledWith("a1");
    expect(container.querySelector('[data-testid="slei-settings-sidebar-swiper"]')?.getAttribute("data-settings-page-motion")).toBe("exit");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(container.querySelector('[data-testid="slei-settings-sidebar-swiper"]')?.getAttribute("data-settings-page-motion")).toBeNull();
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
    const directMessageOrder = () => Array.from(container.querySelectorAll<HTMLElement>("[data-direct-message-list-item]")).map((item) => item.dataset.memberId);
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
    expect(directMessageOrder()).toEqual(["a1", "a2", "a3", "a4"]);
    expect(channelSortButton()?.dataset.sortState).toBe("default");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("升序");
    expect(channelSortButton()?.classList.contains("bg-muted/70")).toBe(false);
    expect(channelSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("default");
    expect(sortIconState(channelSortButton())).toBe("a");
    expect(activeSortIcon(channelSortButton())).toBe("sort");

    await click(channelSortButton()!);
    expect(channelOrder()).toEqual(["alpha", "beta", "zeta"]);
    expect(directMessageOrder()).toEqual(["a1", "a2", "a3", "a4"]);
    expect(channelSortButton()?.dataset.sortState).toBe("asc");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("降序");
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
    expect(channelSortButton()?.classList.contains("bg-muted/70")).toBe(false);
    expect(sortIconState(channelSortButton())).toBe("a");
    expect(activeSortIcon(channelSortButton())).toBe("sort");
    expect(window.localStorage.getItem("slei:sidebar-sort:channels")).toBe("default");

    await click(directMessageSortButton()!);
    expect(channelOrder()).toEqual(["zeta", "alpha", "beta"]);
    expect(directMessageOrder()).toEqual(["a3", "a2", "a1", "a4"]);
    expect(directMessageSortButton()?.dataset.sortState).toBe("asc");
    expect(directMessageSortButton()?.getAttribute("aria-label")).toBe("降序");
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
    expect(Array.from(container.querySelectorAll<HTMLElement>("[data-direct-message-list-item]")).map((item) => item.dataset.memberId)).toEqual(["a3", "a2", "a1", "a4"]);
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
    const nameInput = document.body.querySelector<HTMLInputElement>("#slei-channel-name");
    const nameInputClasses = nameInput?.className.split(/\s+/) ?? [];
    const nameField = nameInput?.closest<HTMLElement>('[data-slot="field"]');
    expect(nameField?.getAttribute("role")).toBe("group");
    expect(nameField?.className).toContain("flex");
    expect(nameField?.className).toContain("gap-3");
    expect(nameInputClasses).toContain("bg-background");
    expect(nameInputClasses).not.toContain("bg-transparent");
    const projectFolderButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("选择项目文件夹"));
    const projectFolderButtonClasses = projectFolderButton?.className.split(/\s+/) ?? [];
    const projectField = projectFolderButton?.closest<HTMLElement>('[data-slot="field"]');
    expect(projectField?.className).toContain("gap-3");
    expect(projectField?.querySelector('[data-slot="field-description"]')?.textContent).toContain("可关联多个项目文件夹");
    expect(projectFolderButtonClasses).toContain("bg-background");
    expect(projectFolderButtonClasses).not.toContain("bg-primary");
    expect(projectFolderButtonClasses).not.toContain("text-primary-foreground");
    const agentCheckbox = document.body.querySelector<HTMLElement>('[aria-label="选择 Agent Coda"]');
    const agentFieldSet = agentCheckbox?.closest<HTMLElement>('[data-slot="field-set"]');
    expect(agentFieldSet?.querySelector('[data-slot="field-legend"]')?.textContent).toBe("选择 Agent");
    expect(agentFieldSet?.className).toContain("min-h-0");
    const agentList = agentCheckbox?.closest<HTMLElement>('[data-slot="scroll-area"]');
    expect(agentList?.className).toContain("bg-background");
    expect(agentList?.className).toContain("border");
    expect(agentList?.className).toContain("min-h-0");
    expect(agentList?.className).toContain("max-h-[min(16rem,34vh)]");
    expect(agentList?.className).toContain("overflow-y-auto");
    expect(agentList?.className).not.toContain("border-white/20");
    expect(agentCheckbox?.className).toContain("border-input");
    expect(agentCheckbox?.className).toContain("dark:bg-input/30");
    expect(agentCheckbox?.className).toContain("data-[state=checked]:bg-primary");
    expect(agentCheckbox?.className).not.toContain("bg-white/10");
    expect(agentCheckbox?.className).not.toContain("border-white/20");
    expect(agentCheckbox?.className).not.toContain("bg-transparent");

    await act(async () => {
      agentCheckbox?.click();
    });

    const selectedAgentOption = agentCheckbox?.closest<HTMLElement>('[data-testid="slei-create-channel-agent-option"]');
    expect(selectedAgentOption?.dataset.selected).toBe("true");
    expect(selectedAgentOption?.className).toContain("border-input");
    expect(selectedAgentOption?.className).toContain("bg-muted/30");
    expect(selectedAgentOption?.className).toContain("text-foreground");
    expect(selectedAgentOption?.className).not.toContain("bg-accent");
    expect(selectedAgentOption?.className).not.toContain("bg-white/20");
    expect(agentCheckbox?.className).toContain("data-[state=checked]:bg-primary");
    expect(agentCheckbox?.className).toContain("data-[state=checked]:text-primary-foreground");
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
    expect(chatHtml).toContain(">私聊 4</");
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
