// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { createSleiFixtures, type SleiMember } from "../../test/fixtures";
import type { SleiTask } from "../../app/types";
import { TasksPage } from "./TasksPageView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function mountTasksPage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<TasksPage data={pageData()} messages={createDesktopMessages("zh-CN")} />);
  });
  await act(async () => undefined);

  return container;
}

async function changeSelect(label: string, value: string) {
  const select = container?.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
  expect(select).not.toBeNull();
  await act(async () => {
    select!.value = value;
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
  it("shows task source channel and assignee metadata on cards", async () => {
    await mountTasksPage();

    const text = container?.textContent ?? "";

    expect(text).toContain("来自 #AI咨询");
    expect(text).toContain("交给 Coda");
    expect(text).toContain("3 个频道任务");
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

    expect(container?.textContent).toContain("列表 0");
    expect(container?.textContent).not.toContain("AI channel task for Coda");
    expect(container?.textContent).not.toContain("Design channel task for Coda");
  });
});
