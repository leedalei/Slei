// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { createSleiFixtures, type SleiMember } from "../../test/fixtures";
import type { SleiTask } from "../../app/types";
import { TasksPage } from "./TasksPageView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};

function agentMember(id: string, name: string): SleiMember {
  return {
    id,
    name,
    handle: `@${name.toLowerCase()}`,
    avatar: name.slice(0, 2).toUpperCase(),
    type: "agent",
    runtimeStatus: "idle",
    role: "Developer",
    description: "Builds features.",
    computer: "Local",
    created: "2026-06-17",
    creator: "user",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "Builds features.",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "Idle",
    capabilities: ["Code"],
  };
}

const coda = agentMember("agent_coda", "Coda");
const alice = agentMember("agent_alice", "Alice");

const tasks: SleiTask[] = [
  {
    id: "task_ai_coda",
    title: "AI channel task for Coda",
    owner: "Coda",
    status: "in_review",
    channelId: "ai",
    assigneeId: "agent_coda",
  },
  {
    id: "task_ai_alice",
    title: "AI channel task for Alice",
    owner: "Alice",
    status: "in_progress",
    channelId: "ai",
    assigneeId: "agent_alice",
  },
  {
    id: "task_design_coda",
    title: "Design channel task for Coda",
    owner: "Coda",
    status: "done",
    channelId: "design",
    assigneeId: "agent_coda",
  },
];

function pageData() {
  return createSleiFixtures({
    channels: [
      { id: "ai", name: "AI咨询", description: "AI research", unread: 0 },
      { id: "design", name: "设计", description: "Design", unread: 0 },
    ],
    members: [coda, alice],
    tasks,
  });
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mountTasksPage(
  activeTaskId?: string,
  handlers: Pick<ComponentProps<typeof TasksPage>, "onTaskReply"> = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<TasksPage activeTaskId={activeTaskId} data={pageData()} messages={createDesktopMessages("zh-CN")} {...handlers} />);
  });
  await act(async () => undefined);

  return container;
}

async function changeSelect(label: string, value: string) {
  const trigger = container?.querySelector(`[data-slot="select-trigger"][aria-label="${label}"]`) as HTMLButtonElement | null;
  expect(trigger).not.toBeNull();
  const view = container!.ownerDocument.defaultView!;
  if (!view.PointerEvent) {
    view.PointerEvent = view.MouseEvent as typeof PointerEvent;
  }
  await act(async () => {
    trigger!.click();
  });
  await act(async () => undefined);

  const optionLabel = {
    ai: "#AI咨询",
    design: "#设计",
    agent_coda: "Coda",
    agent_alice: "Alice",
    all: label === "频道" ? "所有频道" : "所有负责人",
  }[value] ?? value;
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find((candidate) => candidate.textContent?.includes(optionLabel));
  expect(item).not.toBeNull();
  await act(async () => {
    item!.click();
  });
  await act(async () => undefined);
}

async function clickTab(text: string) {
  const tab = Array.from(container?.querySelectorAll('button[role="tab"]') ?? []).find((button) => button.textContent?.includes(text)) as HTMLButtonElement | undefined;
  expect(tab).toBeDefined();
  const view = container!.ownerDocument.defaultView!;
  if (!view.PointerEvent) {
    view.PointerEvent = view.MouseEvent as typeof PointerEvent;
  }
  await act(async () => {
    tab!.dispatchEvent(new view.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }));
    tab!.dispatchEvent(new view.PointerEvent("pointerup", { bubbles: true, button: 0, ctrlKey: false }));
    tab!.click();
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("TasksPage filters", () => {
  it("makes the whole tasks header draggable while keeping filters and tabs interactive", async () => {
    await mountTasksPage();

    const header = container?.querySelector('[data-testid="slei-tasks-header"]');
    const channelSelect = header?.querySelector(`[data-slot="select-trigger"][aria-label="频道"]`);
    const tabsList = header?.querySelector('[data-slot="tabs-list"]');
    const boardTab = Array.from(header?.querySelectorAll('button[role="tab"]') ?? []).find((button) => button.textContent?.includes("看板"));

    expect(header).not.toBeNull();
    expect(header?.getAttribute("data-tauri-drag-region")).toBe("deep");
    expect(header?.className).toContain("select-none");
    expect(channelSelect).not.toBeNull();
    expect(channelSelect?.hasAttribute("data-tauri-drag-region")).toBe(false);
    expect(tabsList?.getAttribute("data-variant")).toBe("soft");
    expect(boardTab).toBeDefined();
    expect(boardTab?.hasAttribute("data-tauri-drag-region")).toBe(false);
  });

  it("keeps task toolbar filters compact and lets view tabs use the default translucent surface", async () => {
    await mountTasksPage();

    const header = container?.querySelector('[data-testid="slei-tasks-header"]');
    const filterTriggers = Array.from(header?.querySelectorAll<HTMLElement>('[data-slot="select-trigger"]') ?? []);
    const tabsList = header?.querySelector<HTMLElement>('[data-slot="tabs-list"]');
    const boardTab = Array.from(header?.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]') ?? [])
      .find((button) => button.textContent?.includes("看板"));

    expect(filterTriggers).toHaveLength(2);
    for (const trigger of filterTriggers) {
      const classes = trigger.className.split(/\s+/);
      expect(classes).toContain("w-56");
      expect(classes).not.toContain("w-full");
    }
    expect(tabsList?.className).toContain("bg-white/10");
    expect(tabsList?.className).toContain("backdrop-blur-xl");
    expect(tabsList?.className).not.toContain("bg-card/70");
    expect(tabsList?.className).not.toContain("backdrop-blur-none");
    expect(tabsList?.className).not.toContain("shadow-none");
    expect(boardTab?.className).not.toContain("data-[state=active]:before:hidden");
  });

  it("uses task-view icons that match board and list semantics", async () => {
    await mountTasksPage();
    const iconsSource = readFileSync(join(process.cwd(), "src/components/icons.tsx"), "utf8");

    const header = container?.querySelector('[data-testid="slei-tasks-header"]');
    const boardTab = Array.from(header?.querySelectorAll('button[role="tab"]') ?? []).find((button) => button.textContent?.includes("看板"));
    const listTab = Array.from(header?.querySelectorAll('button[role="tab"]') ?? []).find((button) => button.textContent?.includes("列表"));

    expect(boardTab?.querySelector('[data-slei-icon="kanban"]')).not.toBeNull();
    expect(listTab?.querySelector('[data-slei-icon="listDetails"]')).not.toBeNull();
    expect(iconsSource).toContain("Kanban");
    expect(iconsSource).toContain("kanban: Kanban");
    expect(iconsSource).not.toContain("kanban: SquareKanban");
    expect(boardTab?.querySelector('[data-slei-icon="tasks"]')).toBeNull();
    expect(listTab?.querySelector('[data-slei-icon="file"]')).toBeNull();
  });

  it("shows task source channel and assignee metadata on cards", async () => {
    await mountTasksPage();

    const text = container?.textContent ?? "";

    expect(text).toContain("来自 #AI咨询");
    expect(text).toContain("交给 Coda");
    expect(text).toContain("3 个频道任务");
    expect(container?.querySelector('[data-slei-status="in_review"]')).not.toBeNull();
    expect(container?.querySelector('[data-slei-status="in_progress"]')).not.toBeNull();
    expect(container?.querySelector('[data-slei-status="done"]')).not.toBeNull();
  });

  it("uses the shared selectable card state for the active task card", async () => {
    await mountTasksPage("task_ai_coda");

    const selectedTask = container?.querySelector<HTMLElement>('[data-task-id="task_ai_coda"]');

    expect(selectedTask?.getAttribute("data-slot")).toBe("selectable-card");
    expect(selectedTask?.getAttribute("data-selected")).toBe("true");
    expect(selectedTask?.className).toContain("bg-white/20");
    expect(selectedTask?.className).not.toContain("bg-accent");
  });

  it("filters tasks by channel and assignee before switching views", async () => {
    await mountTasksPage();

    expect(container?.textContent).toContain("AI channel task for Coda");
    expect(container?.textContent).toContain("AI channel task for Alice");
    expect(container?.textContent).toContain("Design channel task for Coda");

    await changeSelect("频道", "ai");

    expect(container?.textContent).toContain("AI channel task for Coda");
    expect(container?.textContent).toContain("AI channel task for Alice");
    expect(container?.textContent).not.toContain("Design channel task for Coda");

    await changeSelect("负责人", "agent_coda");

    expect(container?.textContent).toContain("AI channel task for Coda");
    expect(container?.textContent).not.toContain("AI channel task for Alice");
    expect(container?.textContent).not.toContain("Design channel task for Coda");

    await clickTab("列表");

    expect(container?.textContent).toContain("AI channel task for Coda");
    expect(container?.textContent).not.toContain("AI channel task for Alice");
    expect(container?.textContent).not.toContain("Design channel task for Coda");

    await changeSelect("频道", "design");
    await changeSelect("负责人", "agent_alice");

    expect(container?.textContent).toContain("列表");
    expect(container?.textContent).not.toContain("列表 0");
    const listEmptyTitle = container?.querySelector('[data-empty-variant="nodata"] h2');
    expect(listEmptyTitle?.textContent).toBe("暂无数据");
    expect(container?.textContent).not.toContain("AI channel task for Coda");
    expect(container?.textContent).not.toContain("Design channel task for Coda");
  });

  it("uses the shared empty illustration for empty board columns", async () => {
    await mountTasksPage();

    await changeSelect("频道", "design");
    await changeSelect("负责人", "agent_alice");
    await clickTab("看板");

    expect(container?.textContent).toContain("待指派");
    expect(container?.textContent).not.toContain("待指派 0");
    const pendingColumn = container?.querySelector('[data-slot="card"][aria-label="待指派"]');
    expect(pendingColumn?.getAttribute("role")).toBe("region");
    expect(pendingColumn?.className.split(/\s+/)).toContain("bg-card/45");
    expect(pendingColumn?.className.split(/\s+/)).not.toContain("bg-card");
    const pendingEmptyTitle = pendingColumn?.querySelector('[data-empty-variant="nodata"] h2');
    expect(pendingEmptyTitle?.textContent).toBe("暂无数据");
    expect(container?.querySelectorAll('[data-empty-illustration="nodata"]').length).toBeGreaterThan(0);
  });

  it("keeps board status columns arranged horizontally with overflow instead of stacking vertically", async () => {
    await mountTasksPage();

    const statusColumns = ["待指派", "进行中", "待评审", "已完成"].map((label) =>
      container?.querySelector<HTMLElement>(`[data-slot="card"][aria-label="${label}"]`),
    );
    const boardGrid = statusColumns[0]?.parentElement;
    const boardClasses = boardGrid?.className.split(/\s+/) ?? [];
    const columnClasses = statusColumns[0]?.className.split(/\s+/) ?? [];

    expect(statusColumns.every(Boolean)).toBe(true);
    expect(new Set(statusColumns.map((column) => column?.parentElement)).size).toBe(1);
    expect(boardClasses).toContain("grid-flow-col");
    expect(boardClasses).toContain("auto-cols-[minmax(17rem,1fr)]");
    expect(boardClasses).toContain("overflow-x-auto");
    expect(boardClasses).not.toContain("xl:grid-cols-4");
    expect(columnClasses).toContain("min-w-0");
  });

  it("opens the task thread as an unmasked right slide-over with a bottom reply composer", async () => {
    const onTaskReply = vi.fn().mockResolvedValue(undefined);
    await mountTasksPage("task_ai_coda", { onTaskReply });

    const drawer = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"][aria-label="任务讨论"]');
    const footer = drawer?.querySelector<HTMLElement>('[data-slot="sheet-footer"]');
    const composer = footer?.querySelector<HTMLElement>('[data-slot="task-thread-composer"]');
    const textarea = drawer?.querySelector<HTMLTextAreaElement>('textarea[placeholder="请输入回复"]');
    const sendButton = drawer?.querySelector<HTMLButtonElement>('button[aria-label="发送回复"]');

    expect(drawer).not.toBeNull();
    expect(drawer?.getAttribute("data-side")).toBe("right");
    expect(drawer?.className).toContain("data-[state=open]:slide-in-from-right");
    expect(drawer?.className).toContain("bg-white/70");
    expect(drawer?.className).toContain("before:hidden");
    expect(document.body.querySelector('[data-slot="sheet-overlay"]')).toBeNull();

    expect(footer).not.toBeNull();
    expect(footer?.className).toContain("sticky");
    expect(footer?.className).toContain("bottom-0");
    expect(footer?.className).not.toContain("border-t");
    expect(composer).not.toBeNull();
    expect(composer?.className).toContain("relative");
    expect(composer?.className).toContain("shadow");
    expect(textarea).not.toBeNull();
    expect(textarea?.getAttribute("placeholder")).toBe("请输入回复");
    expect(textarea?.className).toContain("border");
    expect(textarea?.className).toContain("border-slate-300/90");
    expect(textarea?.className).toContain("pr-16");
    expect(sendButton).toBeDefined();
    expect(sendButton?.textContent?.trim()).toBe("");
    expect(sendButton?.className).toContain("absolute");
    expect(sendButton?.className).toContain("rounded-full");
    expect(sendButton?.className).toContain("right-3");
    expect(sendButton?.getAttribute("data-size")).toBe("icon");
    expect(sendButton?.querySelector('[data-slei-icon="send"]')).not.toBeNull();
    expect(sendButton?.disabled).toBe(true);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea!), "value")?.set;
      if (valueSetter) {
        valueSetter.call(textarea, "继续处理");
      } else {
        textarea!.value = "继续处理";
      }
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      textarea?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(sendButton?.disabled).toBe(false);

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    });
    expect(onTaskReply).toHaveBeenCalledWith("task_ai_coda", "继续处理");

    expect(composer?.contains(textarea!)).toBe(true);
    expect(composer?.contains(sendButton!)).toBe(true);
  });
});
