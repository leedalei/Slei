// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { createSleiFixtures, type SleiMember } from "../../test/fixtures";
import type { SleiTask, SleiTaskReply } from "../../app/types";
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
    replies: [{ id: "reply_ai_coda", sender: "Coda", role: "agent", body: "已完成初步处理" }],
    replyCount: 1,
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

function pageDataWithTasks(inputTasks: SleiTask[]) {
  return createSleiFixtures({
    channels: [
      { id: "ai", name: "AI咨询", description: "AI research", unread: 0 },
      { id: "design", name: "设计", description: "Design", unread: 0 },
    ],
    members: [coda, alice],
    tasks: inputTasks,
  });
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mountTasksPage(
  activeTaskId?: string,
  handlers: Pick<ComponentProps<typeof TasksPage>, "onTaskReply" | "onTaskStatusChange"> = {},
  data = pageData(),
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<TasksPage activeTaskId={activeTaskId} data={data} messages={createDesktopMessages("zh-CN")} {...handlers} />);
  });
  await act(async () => undefined);

  return container;
}

async function renderTasksPage(activeTaskId: string | undefined, data: ReturnType<typeof pageData>) {
  await act(async () => {
    root?.render(<TasksPage activeTaskId={activeTaskId} data={data} messages={createDesktopMessages("zh-CN")} />);
  });
  await act(async () => undefined);
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
  vi.unstubAllGlobals();
});

describe("TasksPage filters", () => {
  it("makes the whole tasks header draggable while keeping filters and tabs interactive", async () => {
    await mountTasksPage();

    const header = container?.querySelector('[data-testid="slei-tasks-header"]');
    const channelSelect = header?.querySelector(`[data-slot="select-trigger"][aria-label="频道"]`);
    const tabsList = header?.querySelector('[data-slot="tabs-list"]');
    const boardTab = Array.from(header?.querySelectorAll('button[role="tab"]') ?? []).find((button) => button.textContent?.includes("看板"));

    expect(header).not.toBeNull();
    expect(header?.getAttribute("data-desktop-drag-region")).toBe("deep");
    expect(container?.querySelector("[data-tauri-drag-region]")).toBeNull();
    expect(header?.className).toContain("select-none");
    expect(channelSelect).not.toBeNull();
    expect(channelSelect?.hasAttribute("data-desktop-drag-region")).toBe(false);
    expect(tabsList?.getAttribute("data-variant")).toBe("soft");
    expect(boardTab).toBeDefined();
    expect(boardTab?.hasAttribute("data-desktop-drag-region")).toBe(false);
  });

  it("keeps task toolbar filters compact and lets view tabs use the shared segmented surface", async () => {
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
    expect(tabsList?.className).toContain("h-8");
    expect(tabsList?.className).toContain("rounded-lg");
    expect(tabsList?.className).toContain("p-0.5");
    expect(tabsList?.className).not.toContain("bg-white/10");
    expect(tabsList?.className).not.toContain("backdrop-blur-xl");
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

  it("shows the source channel above the task id and the assignee next to the status", async () => {
    await mountTasksPage();

    const text = container?.textContent ?? "";
    const codaTask = container?.querySelector<HTMLElement>('[data-task-id="task_ai_coda"]');
    const metadata = codaTask?.querySelector<HTMLElement>('[data-task-card-metadata]');
    const assignee = codaTask?.querySelector<HTMLElement>('[data-task-card-assignee]');
    const idBadge = codaTask?.querySelector<HTMLElement>('[data-task-card-id]');

    expect(metadata).not.toBeNull();
    expect(metadata!.textContent).toContain("来自#AI咨询");
    expect(metadata?.querySelector('[data-slei-icon="hash"]')).toBeNull();
    expect(text).not.toContain("交给 Coda");
    expect(assignee).not.toBeNull();
    expect(assignee!.textContent).toContain("Coda");
    expect(assignee?.querySelector('[data-slot="avatar"]')).not.toBeNull();
    expect(assignee?.className).toContain("[&_[data-slot=avatar]]:size-[18px]");
    expect(codaTask?.className).toContain("w-full");
    expect(codaTask?.className).toContain("min-w-0");
    expect(codaTask?.className).toContain("max-w-full");
    expect(codaTask?.className).toContain("overflow-hidden");
    expect(idBadge?.className).toContain("min-w-0");
    expect(idBadge?.className).toContain("max-w-full");
    expect(idBadge?.className).toContain("shrink");
    expect(idBadge?.className).toContain("truncate");
    expect(codaTask?.querySelector('[data-slei-status="in_review"]')?.parentElement).toBe(assignee?.parentElement);
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
    expect(selectedTask?.className).toContain("bg-accent");
    expect(selectedTask?.className).toContain("text-accent-foreground");
    expect(selectedTask?.className).not.toContain("bg-white/20");
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
    expect(boardClasses).toContain("grid-cols-[repeat(4,minmax(17rem,1fr))]");
    expect(boardClasses).toContain("overflow-x-auto");
    expect(boardClasses).not.toContain("grid-flow-col");
    expect(boardClasses).not.toContain("auto-cols-[minmax(17rem,1fr)]");
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
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const taskThreadCss = appCss.slice(appCss.indexOf(".slei-task-thread-surface {"), appCss.indexOf(".slei-task-thread-input:focus-visible {"));

    expect(drawer).not.toBeNull();
    expect(drawer?.getAttribute("data-side")).toBe("right");
    expect(drawer?.className).toContain("data-[state=open]:slide-in-from-right");
    expect(drawer?.className).toContain("slei-task-thread-surface");
    expect(drawer?.className).not.toContain("bg-background/80");
    expect(drawer?.className).not.toContain("dark:bg-background/70");
    expect(drawer?.className).not.toContain("bg-white/70");
    expect(drawer?.className).not.toContain("border-white/35");
    expect(drawer?.className).toContain("before:hidden");
    expect(document.body.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
    expect(appCss).toContain("--task-thread-surface-bg: var(--app-card-bg);");
    expect(appCss).toContain("--task-thread-header-bg: color-mix(in srgb, var(--app-card-bg) 94%, transparent);");
    expect(appCss).toContain("--task-thread-composer-bg: var(--workspace-glass-bg);");
    expect(taskThreadCss).not.toContain("28 35 50");
    expect(taskThreadCss).not.toContain("bg-background");

    expect(footer).not.toBeNull();
    expect(footer?.className).toContain("sticky");
    expect(footer?.className).toContain("bottom-0");
    expect(footer?.className).not.toContain("border-t");
    expect(composer).not.toBeNull();
    expect(composer?.className).toContain("relative");
    expect(composer?.className).toContain("slei-task-thread-composer");
    expect(composer?.className).toContain("backdrop-blur-xl");
    expect(composer?.className).not.toContain("bg-background/55");
    expect(composer?.className).not.toContain("dark:bg-background/35");
    expect(composer?.className).not.toContain("bg-white");
    expect(textarea).not.toBeNull();
    expect(textarea?.getAttribute("placeholder")).toBe("请输入回复");
    expect(textarea?.className).toContain("border-0");
    expect(textarea?.className).toContain("slei-composer-input");
    expect(textarea?.className).toContain("slei-task-thread-input");
    expect(textarea?.className).not.toContain("border-border/60");
    expect(textarea?.className).toContain("bg-transparent");
    expect(textarea?.className).toContain("placeholder:text-muted-foreground");
    expect(textarea?.className).not.toContain("focus-visible:bg-background/40");
    expect(textarea?.className).not.toContain("dark:focus-visible:bg-background/25");
    expect(textarea?.className).not.toContain("border-slate-300/90");
    expect(textarea?.className).not.toContain("bg-white/55");
    expect(textarea?.className).toContain("max-h-[min(320px,40vh)]");
    expect(textarea?.className).toContain("pr-16");
    expect(textarea?.style.overflowY).toBe("hidden");
    expect(sendButton).toBeDefined();
    expect(sendButton?.textContent?.trim()).toBe("");
    expect(sendButton?.className).toContain("absolute");
    expect(sendButton?.className).toContain("rounded-full");
    expect(sendButton?.className).toContain("right-3");
    expect(sendButton?.className).toContain("size-9");
    expect(sendButton?.querySelector('[data-slei-icon="arrowUp"]')).not.toBeNull();
    expect(sendButton?.querySelector('[data-slei-icon="send"]')).toBeNull();
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

  it("scrolls the task thread to the latest message after task data loads", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const scrollTo = vi.fn();
    await mountTasksPage("task_ai_coda", {}, pageDataWithTasks([]));

    expect(document.body.querySelector('[data-slot="sheet-content"][aria-label="任务讨论"]')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();

    await renderTasksPage("task_ai_coda", pageDataWithTasks([
      {
        ...tasks[0],
        replies: [
          { id: "reply-1", sender: "Coda", role: "agent", body: "先检查数据加载" },
          { id: "reply-2", sender: "lei lee", role: "human", body: "继续往下看" },
        ],
      },
    ]));

    const viewport = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"][aria-label="任务讨论"] [data-slot="scroll-area-viewport"]');
    setScrollMetrics(viewport, { clientHeight: 320, scrollHeight: 1280, scrollTop: 0 });
    Object.defineProperty(viewport, "scrollTo", { configurable: true, value: scrollTo });

    await renderTasksPage("task_ai_coda", pageDataWithTasks([
      {
        ...tasks[0],
        replies: [
          { id: "reply-1", sender: "Coda", role: "agent", body: "先检查数据加载" },
          { id: "reply-2", sender: "lei lee", role: "human", body: "继续往下看" },
          { id: "reply-3", sender: "Coda", role: "agent", body: "最新消息" },
        ],
      },
    ]));

    expect(scrollTo).toHaveBeenCalledWith({ top: 1280, behavior: "smooth" });

    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("renders task replies with the same header metadata and actions as chat messages", async () => {
    const clipboard = { writeText: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    vi.stubGlobal("navigator", { clipboard });
    await mountTasksPage("task_ai_coda", {}, pageDataWithTasks([
      {
        ...tasks[0],
        replies: [
          { id: "reply-agent", sender: "Coda", role: "agent", body: "Agent 回复", time: "06-17 10:30", sentAt: "2026-06-17 10:30:00" } satisfies SleiTaskReply,
        ],
      },
    ]));

    const replies = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="sheet-content"][aria-label="任务讨论"] [data-reply-role]'));
    const reply = replies[0];
    const avatar = reply?.querySelector<HTMLElement>('[data-slot="avatar"]');
    const metadata = reply?.querySelector<HTMLElement>('[data-slot="task-reply-metadata"]');
    const actions = reply?.querySelector<HTMLElement>('[data-slot="task-reply-actions"]');
    const copyButton = actions?.querySelector<HTMLButtonElement>('button[aria-label="复制"]');
    const time = actions?.querySelector<HTMLTimeElement>("time");

    expect(replies).toHaveLength(1);
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute("data-avatar-size")).toBe("default");
    expect(avatar?.className.split(/\s+/)).toContain("size-8");
    expect(avatar?.getAttribute("aria-label")).toBe("Coda");
    expect(metadata?.textContent).toContain("Coda");
    expect(metadata?.textContent).toContain("@coda");
    expect(metadata?.textContent).toContain("Developer");
    expect(actions).not.toBeNull();
    expect(copyButton).not.toBeNull();
    expect(time?.textContent).toBe("06-17 10:30");
    expect(time?.getAttribute("dateTime")).toBe("2026-06-17 10:30:00");
    expect(reply?.textContent).toContain("Agent 回复");

    await act(async () => {
      copyButton!.click();
    });

    expect(clipboard.writeText).toHaveBeenCalledWith("Agent 回复");
  });

  it("changes task status from the drawer timeline after confirmation", async () => {
    const onTaskStatusChange = vi.fn().mockResolvedValue(undefined);
    await mountTasksPage("task_ai_coda", { onTaskStatusChange });

    const drawer = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"][aria-label="任务讨论"]');
    const timeline = drawer?.querySelector<HTMLElement>('[data-slot="task-status-timeline"]');
    const doneNode = drawer?.querySelector<HTMLButtonElement>('[data-task-status-node="done"]');
    expect(timeline).not.toBeNull();
    expect(timeline?.className).not.toContain("bg-white");
    expect(timeline?.className).not.toContain("shadow");
    expect(timeline?.className).not.toContain("border");
    expect(timeline?.className).not.toContain("mx-auto");
    expect(timeline?.className).toContain("inline-grid");
    expect(timeline?.className).toContain("justify-start");
    expect(drawer?.querySelectorAll('[data-task-status-node]')).toHaveLength(4);
    expect(drawer?.querySelectorAll('[data-task-status-icon]')).toHaveLength(4);
    expect(drawer?.querySelector('[data-task-status-node="pending_assignment"]')?.className).toContain("justify-items-start");
    expect(drawer?.querySelector('[data-task-status-node="pending_assignment"]')?.className).toContain("focus-visible:ring-[3px]");
    expect(drawer?.querySelector('[data-task-status-node-content="pending_assignment"]')?.className).toContain("justify-items-center");
    expect(drawer?.querySelector('[data-task-status-node-content="pending_assignment"]')?.className).toContain("gap-2");
    expect(drawer?.querySelector('[data-task-status-icon="in_review"]')?.className).toContain("ring-background");
    expect(drawer?.querySelector('[data-task-status-icon="in_review"]')?.className).toContain("bg-primary");
    expect(drawer?.querySelector('[data-task-status-icon="in_review"]')?.className).not.toContain("bg-linear-to-r");
    expect(drawer?.querySelector('[data-task-status-icon="in_review"]')?.className).not.toContain("from-cyan-500");
    expect(drawer?.querySelector('[data-task-status-icon="in_review"]')?.className).not.toContain("to-blue-500");
    expect(drawer?.querySelector('[data-task-status-icon="in_review"]')?.getAttribute("data-reached")).toBe("true");
    expect(drawer?.querySelector('[data-task-status-icon="done"]')?.className).toContain("bg-muted");
    expect(drawer?.querySelector('[data-task-status-icon="done"]')?.className).toContain("text-muted-foreground");
    expect(drawer?.querySelector('[data-task-status-icon="done"]')?.className).not.toContain("bg-slate-100");
    expect(drawer?.querySelector('[data-task-status-icon="done"]')?.className).not.toContain("bg-linear-to-r");
    expect(drawer?.querySelector('[data-task-status-icon="done"]')?.getAttribute("data-reached")).toBe("false");
    expect(drawer?.querySelector('[data-task-status-label="done"]')?.className).toContain("text-center");
    expect(drawer?.querySelector('[data-task-status-label="done"]')?.className).toContain("text-[10px]");
    expect(drawer?.querySelector('[data-task-status-node="pending_assignment"] [data-slei-icon="user"]')).not.toBeNull();
    expect(drawer?.querySelector('[data-task-status-node="in_progress"] [data-slei-icon="loader"]')).not.toBeNull();
    expect(drawer?.querySelector('[data-task-status-node="in_review"] [data-slei-icon="approval"]')).not.toBeNull();
    expect(drawer?.querySelector('[data-task-status-node="done"] [data-slei-icon="check"]')).not.toBeNull();
    expect(drawer?.querySelector('[data-task-status-node="in_review"]')?.getAttribute("data-current")).toBe("true");
    expect(doneNode).not.toBeNull();
    expect(doneNode?.disabled).toBe(false);
    expect(drawer?.querySelector('[data-slot="select-trigger"][aria-label="变更任务状态"]')).toBeNull();

    await act(async () => {
      doneNode!.click();
    });
    await act(async () => undefined);

    expect(onTaskStatusChange).not.toHaveBeenCalled();
    const confirm = drawer?.querySelector<HTMLButtonElement>('[data-slot="task-status-confirm-action"]');
    expect(drawer?.querySelector('[data-slot="task-status-confirm"]')).not.toBeNull();
    expect(drawer?.textContent).toContain("确认变更任务状态");
    expect(drawer?.textContent).toContain("待评审 -> 已完成");
    expect(confirm).not.toBeNull();

    await act(async () => {
      confirm!.click();
    });

    expect(onTaskStatusChange).toHaveBeenCalledWith("task_ai_coda", "done");
  });

  it("keeps zero-reply task timeline at pending and disables forward status nodes", async () => {
    const onTaskStatusChange = vi.fn().mockResolvedValue(undefined);
    const data = pageData();
    data.tasks = [
      {
        id: "task_empty",
        title: "刚创建的任务",
        owner: "Lei",
        status: "in_progress",
        channelId: "ai",
        replies: [],
        replyCount: 0,
      },
    ];
    await mountTasksPage("task_empty", { onTaskStatusChange }, data);

    const drawer = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"][aria-label="任务讨论"]');
    const pendingIcon = drawer?.querySelector('[data-task-status-icon="pending_assignment"]');
    const inProgressIcon = drawer?.querySelector('[data-task-status-icon="in_progress"]');
    const inProgressNode = drawer?.querySelector<HTMLButtonElement>('[data-task-status-node="in_progress"]');
    const inReviewNode = drawer?.querySelector<HTMLButtonElement>('[data-task-status-node="in_review"]');
    const doneNode = drawer?.querySelector<HTMLButtonElement>('[data-task-status-node="done"]');

    expect(pendingIcon?.getAttribute("data-reached")).toBe("true");
    expect(inProgressIcon?.getAttribute("data-reached")).toBe("false");
    expect(drawer?.querySelector('[data-task-status-node="pending_assignment"]')?.getAttribute("data-current")).toBe("true");
    expect(inProgressNode?.disabled).toBe(true);
    expect(inReviewNode?.disabled).toBe(true);
    expect(doneNode?.disabled).toBe(true);

    await act(async () => {
      doneNode?.click();
    });

    expect(drawer?.querySelector('[data-slot="task-status-confirm"]')).toBeNull();
    expect(onTaskStatusChange).not.toHaveBeenCalled();
  });

  it("scrolls the task thread to the latest reply when replies change", async () => {
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    const data = pageData();
    data.tasks = data.tasks.map((task) =>
      task.id === "task_ai_coda"
        ? {
            ...task,
            replies: [
              { id: "r1", sender: "Coda", role: "agent", body: "第一条" },
            ],
            replyCount: 1,
          }
        : task,
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    try {
      await act(async () => {
        root?.render(<TasksPage activeTaskId="task_ai_coda" data={data} messages={createDesktopMessages("zh-CN")} />);
      });
      await act(async () => undefined);
      scrollTo.mockClear();

      const nextData = {
        ...data,
        tasks: data.tasks.map((task) =>
          task.id === "task_ai_coda"
            ? {
                ...task,
                replies: [
                  ...(task.replies ?? []),
                  { id: "r2", sender: "Lei", role: "human" as const, body: "新增回复" },
                ],
                replyCount: 2,
              }
            : task,
        ),
      };

      await act(async () => {
        root?.render(<TasksPage activeTaskId="task_ai_coda" data={nextData} messages={createDesktopMessages("zh-CN")} />);
      });
      await act(async () => undefined);

      expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "smooth" });
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });
});

function setScrollMetrics(element: HTMLElement | null, metrics: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
  if (!element) return;
  Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(element, "scrollTop", { configurable: true, value: metrics.scrollTop, writable: true });
}
