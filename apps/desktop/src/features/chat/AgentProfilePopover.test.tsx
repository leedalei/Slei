/* @vitest-environment jsdom */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { createDemoMembers } from "../../test/fixtures";
import { TaskThreadDrawer } from "../tasks/TaskThreadDrawer";
import { AgentProfilePopover } from "./AgentProfilePopover";
import { TaskRootEntry } from "./TaskRootEntry";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Rendered = {
  host: HTMLElement;
  root: Root;
};

function installBrowserMocks() {
  const view = window as Window & typeof globalThis;

  view.PointerEvent ??= view.MouseEvent as typeof PointerEvent;
  view.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => undefined;
  HTMLElement.prototype.releasePointerCapture ??= () => undefined;
}

async function renderUi(ui: ReactElement): Promise<Rendered> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(ui);
  });
  await act(async () => undefined);

  return { host, root };
}

async function clickElement(element: Element | null | undefined) {
  expect(element).toBeInstanceOf(HTMLElement);
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => undefined);
}

function expectDocumentOrder(elements: HTMLElement[]) {
  for (let index = 0; index < elements.length - 1; index += 1) {
    expect(elements[index].compareDocumentPosition(elements[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

function messageButton() {
  return document.body.querySelector<HTMLButtonElement>('[data-testid="slei-agent-profile-message-button"]');
}

function expectDefaultFullWidthMessageButton(button: HTMLButtonElement | null) {
  const classes = button?.className.split(/\s+/) ?? [];
  expect(button).not.toBeNull();
  expect(button?.textContent?.trim()).toBe("私聊");
  expect(classes).toContain("w-full");
  expect(button?.className).toContain("bg-primary");
  expect(button?.className).toContain("h-9");
  expect(button?.className).not.toContain("bg-destructive");
  expect(classes).not.toContain("border");
  expect(button?.querySelector("svg")).toBeNull();
}

beforeEach(() => {
  installBrowserMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AgentProfilePopover", () => {
  it("renders the requested profile order with a yellow busy status and default full-width message button", async () => {
    const messages = createDesktopMessages("zh-CN");
    const member = {
      ...createDemoMembers()[0],
      name: "Yeal",
      handle: "@yeal",
      profession: "引导员",
      description: "回答关于 Slei App 如何使用的问题，用于帮助和引导用户建立自己的团队。",
      runtimeStatus: "busy" as const,
      directMessageEnabled: true,
    };
    const onMessage = vi.fn();
    const onOpenChange = vi.fn();
    const rendered = await renderUi(
      <AgentProfilePopover
        action={<button data-testid="profile-header-action" type="button">移除</button>}
        member={member}
        messages={messages}
        onMessage={onMessage}
        onOpenChange={onOpenChange}
        open
        status={{ kind: "runtime", status: "busy" }}
      />,
    );

    try {
      const card = document.body.querySelector<HTMLElement>('[data-testid="slei-agent-profile-card"]');
      const header = card?.querySelector<HTMLElement>('[data-slot="agent-profile-header"]');
      const identity = card?.querySelector<HTMLElement>('[data-slot="agent-profile-identity"]');
      const metadata = card?.querySelector<HTMLElement>('[data-slot="agent-profile-metadata"]');
      const description = card?.querySelector<HTMLElement>('[data-slot="agent-profile-description"]');
      const statusDot = metadata?.querySelector<HTMLElement>('[data-slot="agent-profile-status-dot"]');
      const button = messageButton();

      expect(card).not.toBeNull();
      expect(header).not.toBeNull();
      expect(identity).not.toBeNull();
      expect(metadata).not.toBeNull();
      expect(description).not.toBeNull();
      expect(statusDot).not.toBeNull();
      expect(header?.querySelector('[data-slot="avatar"]')).not.toBeNull();
      expect(header?.querySelector('[data-testid="profile-header-action"]')).not.toBeNull();
      expect(header?.className).toContain("items-center");
      expect(header?.className).not.toContain("items-start");
      expect(identity?.textContent).toContain("Yeal");
      expect(identity?.textContent).toContain("引导员");
      expect(metadata?.textContent).toContain("@yeal");
      expect(metadata?.textContent).toContain("忙碌");
      expect(description?.textContent).toContain("回答关于 Slei App");
      expect(statusDot?.className).toContain("bg-amber-500");
      expect(statusDot?.className).not.toContain("bg-blue-500");
      expect(card?.querySelector('[data-slot="avatar-badge"]')).toBeNull();
      expectDefaultFullWidthMessageButton(button);
      expectDocumentOrder([header!, identity!, metadata!, description!, button!]);

      await clickElement(button);

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(onMessage.mock.invocationCallOrder[0]);
    } finally {
      act(() => rendered.root.unmount());
      rendered.host.remove();
    }
  });

  it("keeps maximum-length names and professions constrained on the shared identity row", async () => {
    const messages = createDesktopMessages("zh-CN");
    const member = {
      ...createDemoMembers()[0],
      name: "名称同样很长的智能体成员需要保留可见空间",
      profession: "职".repeat(32),
    };
    const rendered = await renderUi(
      <AgentProfilePopover
        member={member}
        messages={messages}
        onOpenChange={() => undefined}
        open
        status={{ kind: "runtime", status: "idle" }}
      />,
    );

    try {
      const identity = document.body.querySelector<HTMLElement>('[data-slot="agent-profile-identity"]');
      const name = identity?.querySelector<HTMLElement>("strong");
      const profession = identity?.querySelector<HTMLElement>('[data-slot="badge"]');
      const identityClasses = identity?.className.split(/\s+/) ?? [];
      const nameClasses = name?.className.split(/\s+/) ?? [];
      const professionClasses = profession?.className.split(/\s+/) ?? [];

      expect(identityClasses).toContain("overflow-hidden");
      expect(nameClasses).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "truncate"]));
      expect(professionClasses).toEqual(expect.arrayContaining(["max-w-[60%]", "min-w-0", "shrink", "truncate"]));
      expect(professionClasses).not.toContain("shrink-0");
    } finally {
      act(() => rendered.root.unmount());
      rendered.host.remove();
    }
  });

  it("uses localized busy text and omits optional description and message action when messaging is disabled", async () => {
    const messages = createDesktopMessages("en-US");
    const member = {
      ...createDemoMembers()[0],
      description: "",
      runtimeStatus: "busy" as const,
      directMessageEnabled: false,
    };
    const rendered = await renderUi(
      <AgentProfilePopover
        member={member}
        messages={messages}
        onMessage={vi.fn()}
        onOpenChange={() => undefined}
        open
        status={{ kind: "runtime", status: "busy" }}
      />,
    );

    try {
      const card = document.body.querySelector<HTMLElement>('[data-testid="slei-agent-profile-card"]');
      expect(card?.textContent).toContain("Busy");
      expect(card?.querySelector('[data-slot="agent-profile-description"]')).toBeNull();
      expect(messageButton()).toBeNull();
    } finally {
      act(() => rendered.root.unmount());
      rendered.host.remove();
    }
  });

  it("exposes the shared default message action from a task source message", async () => {
    const messages = createDesktopMessages("zh-CN");
    const member = { ...createDemoMembers()[0], directMessageEnabled: true };
    const rendered = await renderUi(
      <TaskRootEntry
        messages={messages}
        onMemberMessage={() => undefined}
        onOpen={() => undefined}
        profileMember={member}
        side="incoming"
        sourceMessage={{
          id: "task-source",
          authorId: member.id,
          author: member.name,
          handle: member.handle,
          avatar: member.avatar,
          role: "agent",
          time: "10:00",
          body: "任务源消息",
          channelId: "all",
        }}
        task={{ id: "task-1", title: "任务源消息", owner: member.name, status: "in_progress" }}
      />,
    );

    try {
      await clickElement(rendered.host.querySelector('[data-testid="slei-agent-profile-trigger"]'));
      expectDefaultFullWidthMessageButton(messageButton());
    } finally {
      act(() => rendered.root.unmount());
      rendered.host.remove();
    }
  });

  it("exposes the shared default message action from an agent task-thread reply", async () => {
    const messages = createDesktopMessages("zh-CN");
    const member = { ...createDemoMembers()[0], directMessageEnabled: true };
    const rendered = await renderUi(
      <TaskThreadDrawer
        mentionMembers={[member]}
        messages={messages}
        onClose={() => undefined}
        onMemberMessage={() => undefined}
        open
        task={{
          id: "task-1",
          title: "任务线程",
          owner: member.name,
          status: "in_progress",
          replies: [{ id: "reply-1", memberId: member.id, sender: member.name, role: "agent", body: "线程回复" }],
        }}
      />,
    );

    try {
      const reply = document.body.querySelector<HTMLElement>('[data-reply-role="agent"]');
      await clickElement(reply?.querySelector('[data-testid="slei-agent-profile-trigger"]'));
      expectDefaultFullWidthMessageButton(messageButton());
    } finally {
      act(() => rendered.root.unmount());
      rendered.host.remove();
    }
  });
});
