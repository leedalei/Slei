/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditableDetailField, SleiAppFrame } from "../src/app/SleiApp";
import { ComputersPage } from "../src/features/computers/ComputersPageView";
import { MembersPage } from "../src/features/members/MembersPageView";
import { createDesktopMessages } from "../src/i18n";
import { createDemoMembers, createSleiFixtures } from "../src/test/fixtures";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = createSleiFixtures({ members: createDemoMembers() });
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: data.nodes,
};
const messages = createDesktopMessages("zh-CN");

function countAlerts(html: string) {
  return html.match(/role="alert"/g)?.length ?? 0;
}

function renderMemberDetails(onAgentUpdate: Parameters<typeof MembersPage>[0]["onAgentUpdate"]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <MembersPage
        activeMemberId="a1"
        data={data}
        messages={messages}
        nodes={data.nodes}
        onAgentUpdate={onAgentUpdate}
      />,
    );
  });

  return { host, root };
}

function renderComputerDetails(input: {
  activeNodeId: string;
  onComputerRename: Parameters<typeof ComputersPage>[0]["onComputerRename"];
}) {
  const nodes = [
    data.nodes[0],
    {
      ...data.nodes[0],
      id: "remote-node",
      name: "Remote Studio",
      device: {
        ...data.nodes[0].device,
        hostname: "remote-studio.local",
      },
    },
  ].filter(Boolean);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  function render(activeNodeId: string) {
    act(() => {
      root.render(
        <ComputersPage
          activeNodeId={activeNodeId}
          members={[]}
          messages={messages}
          nodes={nodes}
          onComputerRename={input.onComputerRename}
        />,
      );
    });
  }

  render(input.activeNodeId);

  return { host, render, root };
}

function cleanupRoot(root: Root, host: HTMLElement) {
  act(() => {
    root.unmount();
  });
  host.remove();
}

function buttonByText(host: HTMLElement, text: string) {
  return [...host.querySelectorAll("button")].find((button) => button.textContent === text) ?? null;
}

async function clickElement(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("Expected clickable element");
  await act(async () => {
    element.click();
  });
}

async function changeInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  await act(async () => {
    if (valueSetter) {
      valueSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitClosestForm(input: HTMLInputElement | HTMLTextAreaElement) {
  const form = input.closest("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("Expected input to be inside a form");
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
}

describe("detail page editing pattern", () => {
  it("renders detail fields as read-only until the label edit icon is used", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        ariaLabel="编辑显示名称"
        label="显示名称"
        onSave={() => undefined}
        value="Coda"
      />,
    );

    expect(html).toContain('aria-label="编辑显示名称"');
    expect(html).toContain("slei-editable-field");
    expect(html).toContain("slei-editable-field__label");
    expect(html).toContain("显示名称");
    expect(html).toContain("Coda");
    expect(html).not.toContain('aria-label="显示名称输入"');
    expect(html).not.toContain("保存");
    expect(html).not.toContain("取消");
  });

  it("renders edit mode as an input with save and cancel actions", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        ariaLabel="编辑显示名称"
        initialEditing
        label="显示名称"
        onSave={() => undefined}
        value="Coda"
      />,
    );

    expect(html).toContain("<form");
    expect(html).toContain('aria-label="显示名称输入"');
    expect(html).toContain("保存");
    expect(html).toContain("取消");
  });

  it("renders saving and error state for edit mode", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        ariaLabel="编辑显示名称"
        error="保存失败"
        initialEditing
        label="显示名称"
        saving
        onSave={() => undefined}
        value="Lei"
      />,
    );

    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("aria-describedby=");
    expect(html).toContain('role="alert"');
    expect(html).toContain("保存失败");
    expect(html).toContain('data-editable-saving="true"');
  });

  it("renders allow-empty edit mode without validation alert", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        allowEmpty
        ariaLabel="编辑描述"
        initialEditing
        label="描述"
        onSave={() => undefined}
        value=""
      />,
    );

    expect(html).toContain("<input");
    expect(html).toContain('aria-label="描述输入"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("text-destructive");
  });

  it("keeps compact editable field compatibility hooks", () => {
    const html = renderToStaticMarkup(
      <EditableDetailField
        ariaLabel="编辑运行时"
        label="Runtime"
        onSave={() => undefined}
        readClassName="slei-badge"
        sectionClassName="slei-config-editable"
        value="ClaudeCode"
      />,
    );

    expect(html).toContain("slei-config-editable");
    expect(html).toContain("slei-editable-field");
    expect(html).toContain("slei-editable-field__label");
    expect(html).toContain("slei-badge");
    expect(html).toContain("ClaudeCode");
  });

  it("uses the same edit trigger pattern on member and computer details", () => {
    const membersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="members" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    const computersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(membersHtml).toContain('aria-label="编辑显示名称"');
    expect(membersHtml).toContain('aria-label="编辑描述"');
    expect(membersHtml).toContain('aria-label="编辑运行时"');
    expect(membersHtml).toContain('aria-label="编辑 Model"');
    expect(membersHtml).toContain("显示名称");
    expect(membersHtml).toContain("描述");
    expect(membersHtml).not.toContain('aria-label="显示名称输入"');
    expect(computersHtml).toContain('aria-label="编辑设备名称"');
    expect(computersHtml).not.toContain('aria-label="设备名称输入"');
    expect(computersHtml).not.toContain('aria-label="编辑系统信息"');
  });

  it("renders member field save failure state from the frame contract", () => {
    const membersHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="members"
        data={data}
        locale="zh-CN"
        memberFieldErrors={{ name: "保存失败" }}
        runtimeSetup={readyRuntime}
        savingMemberField="name"
      />,
    );

    expect(membersHtml).toContain("slei-editable-field");
    expect(membersHtml).toContain('aria-label="编辑显示名称"');
    expect(membersHtml).toContain('role="alert"');
    expect(membersHtml).toContain("保存失败");
    expect(membersHtml).toContain('data-editable-saving="true"');
    expect(countAlerts(membersHtml)).toBe(1);
  });

  it("renders computer rename pending and error state from the frame contract", () => {
    const selectedNodeId = data.nodes[0]?.id ?? "";
    const computersHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="computers"
        computerRenameError="保存失败"
        data={data}
        locale="zh-CN"
        renamingComputerId={selectedNodeId}
        runtimeSetup={readyRuntime}
      />,
    );

    expect(computersHtml).toContain('aria-label="编辑设备名称"');
    expect(computersHtml).toContain('role="alert"');
    expect(computersHtml).toContain("保存失败");
    expect(computersHtml).toContain('data-editable-saving="true"');
    expect(countAlerts(computersHtml)).toBe(1);
  });

  it("rolls back visible member details when async save fails while preserving the editor draft", async () => {
    const onAgentUpdate = vi.fn(async () => {
      throw new Error("保存失败");
    });
    const { host, root } = renderMemberDetails(onAgentUpdate);

    try {
      expect(host.querySelector("h1")?.textContent).toBe("Coda");

      await clickElement(host.querySelector('[aria-label="编辑显示名称"]'));
      const input = host.querySelector('[aria-label="显示名称输入"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("Expected display name input");

      await changeInputValue(input, "Rejected Name");
      await submitClosestForm(input);

      expect(onAgentUpdate).toHaveBeenCalledWith("a1", { name: "Rejected Name" });
      expect(host.querySelector("h1")?.textContent).toBe("Coda");
      expect(input.value).toBe("Rejected Name");
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("保存失败");

      await clickElement(buttonByText(host, "取消"));

      expect(host.querySelector("form")).toBeNull();
      expect(host.querySelector("h1")?.textContent).toBe("Coda");
      expect(host.textContent).toContain("Coda");
      expect(host.textContent).not.toContain("Rejected Name");
    } finally {
      cleanupRoot(root, host);
    }
  });

  it("does not carry a failed computer rename error to another selected node", async () => {
    const onComputerRename = vi.fn(async () => {
      throw new Error("保存失败");
    });
    const firstNodeId = data.nodes[0]?.id ?? "";
    const { host, render, root } = renderComputerDetails({ activeNodeId: firstNodeId, onComputerRename });

    try {
      await clickElement(host.querySelector('[aria-label="编辑设备名称"]'));
      const firstInput = host.querySelector('[aria-label="设备名称输入"]');
      if (!(firstInput instanceof HTMLInputElement)) throw new Error("Expected device name input");

      await changeInputValue(firstInput, "Rejected Computer");
      await submitClosestForm(firstInput);

      expect(host.querySelector('[role="alert"]')?.textContent).toBe("保存失败");
      await clickElement(buttonByText(host, "取消"));

      render("remote-node");
      expect(host.querySelector("h1")?.textContent).toBe("Remote Studio");
      await clickElement(host.querySelector('[aria-label="编辑设备名称"]'));

      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.textContent).not.toContain("保存失败");
    } finally {
      cleanupRoot(root, host);
    }
  });
});
