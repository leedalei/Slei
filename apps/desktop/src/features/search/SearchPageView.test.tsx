// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../../i18n";
import type { GlobalSearchQuery, GlobalSearchReceipt } from "../../lib/daemon-bridge";
import { createSleiFixtures, type SleiMember } from "../../test/fixtures";
import { defaultProfile } from "../../app/model";
import { SearchPage } from "./SearchPageView";

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
    description: `${name} builds product flows.`,
    computer: "Local",
    created: "2026-06-17",
    creator: "Lei",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "Builds features.",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "Idle",
    capabilities: ["code"],
    directMessageEnabled: true,
  };
}

const receipt: GlobalSearchReceipt = {
  query: "coda",
  totals: { agents: 1, channels: 1, messages: 1 },
  agents: [
    {
      kind: "agent",
      agentId: "agent_coda",
      title: "Coda",
      subtitle: "@coda",
      avatarSeed: "agent_coda",
      matchedFields: ["title"],
    },
  ],
  channels: [
    {
      kind: "channel",
      channelId: "channel_release",
      title: "#release",
      subtitle: "Coda release work",
      matchedFields: ["subtitle"],
    },
  ],
  messages: [
    {
      kind: "message",
      sourceKind: "channel",
      messageId: "msg_coda",
      channelId: "channel_release",
      sessionId: "session_release",
      authorLabel: "Coda",
      sourceLabel: "#release",
      snippet: "Coda shipped the global search page.",
      createdAt: "2026-06-17T08:00:00.000Z",
      matchedFields: ["snippet"],
    },
  ],
};

function searchReceipt(query: string, title: string): GlobalSearchReceipt {
  return {
    query,
    totals: { agents: 1, channels: 0, messages: 0 },
    agents: [
      {
        kind: "agent",
        agentId: `agent_${query}`,
        title,
        subtitle: `@${query}`,
        avatarSeed: `agent_${query}`,
        matchedFields: ["title"],
      },
    ],
    channels: [],
    messages: [],
  };
}

function deferredReceipt() {
  let resolve!: (receipt: GlobalSearchReceipt) => void;
  const promise = new Promise<GlobalSearchReceipt>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mount(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
  await act(async () => undefined);
  return container;
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
  document.body.innerHTML = "";
});

function renderSearchPage(input: Partial<Parameters<typeof SearchPage>[0]> = {}) {
  const messages = input.messages ?? createDesktopMessages("en-US");
  const data = input.data ?? createSleiFixtures({
    channels: [
      { id: "all", name: "all", description: "Default channel", unread: 0 },
      { id: "channel_release", name: "release", description: "Release work", unread: 0 },
    ],
    members: [agentMember("agent_coda", "Coda"), agentMember("agent_ada", "Ada")],
  });

  return mount(
    <SearchPage
      data={data}
      messages={messages}
      onGlobalSearch={async () => ({ query: "", totals: { agents: 0, channels: 0, messages: 0 }, agents: [], channels: [], messages: [] })}
      profile={defaultProfile}
      timeZone="Asia/Shanghai"
      {...input}
    />,
  );
}

function inputByLabel(rootElement: HTMLElement, label: string): HTMLInputElement {
  const input = rootElement.querySelector(`input[aria-label="${label}"]`);
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

function searchEmptyState(rootElement: HTMLElement) {
  return rootElement.querySelector<HTMLElement>('[data-slot="search-results"] [role="status"][data-empty-size]');
}

async function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(rootElement: HTMLElement, label: string | RegExp) {
  const button = Array.from(rootElement.querySelectorAll("button")).find((candidate) => {
    const name = `${candidate.getAttribute("aria-label") ?? ""} ${candidate.textContent ?? ""}`;
    return typeof label === "string" ? name.includes(label) : label.test(name);
  });
  expect(button).toBeInstanceOf(HTMLButtonElement);
  await act(async () => {
    button?.click();
  });
  await act(async () => undefined);
  return button as HTMLButtonElement;
}

async function clickButtonWithExactText(rootElement: HTMLElement, text: string) {
  const button = Array.from(rootElement.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
  expect(button).toBeInstanceOf(HTMLButtonElement);
  await act(async () => {
    button?.click();
  });
  await act(async () => undefined);
  return button as HTMLButtonElement;
}

async function openSelect(rootElement: HTMLElement, label: string) {
  const trigger = Array.from(rootElement.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]')).find((candidate) => {
    const name = `${candidate.getAttribute("aria-label") ?? ""} ${candidate.textContent ?? ""}`;
    return name.includes(label);
  });
  expect(trigger).toBeInstanceOf(HTMLButtonElement);
  await act(async () => {
    trigger?.click();
  });
  await act(async () => undefined);
  return trigger as HTMLButtonElement;
}

async function clickSelectItem(text: string) {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find((candidate) => candidate.textContent?.includes(text));
  expect(item).toBeInstanceOf(HTMLElement);
  await act(async () => {
    item?.click();
  });
  await act(async () => undefined);
  return item as HTMLElement;
}

async function submitSearchForm(rootElement: HTMLElement) {
  const form = rootElement.querySelector("form");
  expect(form).toBeInstanceOf(HTMLFormElement);
  await act(async () => {
    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => undefined);
}

describe("SearchPage global search UI", () => {
  it("renders the empty query placeholder and does not call daemon search", async () => {
    const onGlobalSearch = vi.fn();
    const rootElement = await renderSearchPage({ onGlobalSearch });
    const results = rootElement.querySelector('[data-slot="search-results"]');
    const emptyState = searchEmptyState(rootElement);
    const searchSurface = rootElement.querySelector('[data-slot="search-input-surface"]');
    const searchInput = inputByLabel(rootElement, "Global search input");

    expect(rootElement.textContent).toContain("Search agents, channels, and messages");
    expect(searchSurface).toBeInstanceOf(HTMLElement);
    expect(searchSurface?.hasAttribute("data-slei-panel")).toBe(true);
    expect(searchSurface?.getAttribute("data-variant")).toBe("inset");
    expect(searchInput.className).toContain("bg-transparent");
    expect(searchInput.className).toContain("dark:bg-transparent");
    expect(searchInput.className).not.toContain("dark:bg-muted/30");
    expect(results).toBeInstanceOf(HTMLDivElement);
    expect(results?.className).toContain("mx-auto grid w-full max-w-5xl");
    expect(results?.className).not.toContain("p-6");
    expect(results?.parentElement?.className).toContain("px-6 py-6");
    expect(emptyState?.dataset.emptySize).toBe("lg");
    expect(emptyState?.className).not.toContain("border");
    expect(emptyState?.className).not.toContain("bg-");
    expect(results?.querySelector('[data-empty-illustration="nodata"]')).not.toBeNull();
    expect(results?.querySelector<HTMLImageElement>('img[data-empty-asset="search"]')?.getAttribute("src")).toContain("empty-search.png");
    expect(onGlobalSearch).not.toHaveBeenCalled();
  });

  it("does not call daemon search when submitting a whitespace query and keeps the placeholder state", async () => {
    const onGlobalSearch = vi.fn();
    const rootElement = await renderSearchPage({ onGlobalSearch });

    await changeInput(inputByLabel(rootElement, "Global search input"), "   ");
    await clickButton(rootElement, "Search");

    expect(onGlobalSearch).not.toHaveBeenCalled();
    expect(rootElement.textContent).toContain("Search agents, channels, and messages");
    expect(rootElement.textContent).toContain("Enter a keyword to search; filters can narrow results by member, channel, or time range");
  });

  it("submits daemon-backed search requests and renders grouped highlighted results", async () => {
    const onGlobalSearch = vi.fn(async (_query: GlobalSearchQuery) => receipt);
    const rootElement = await renderSearchPage({ onGlobalSearch });

    await changeInput(inputByLabel(rootElement, "Global search input"), " coda ");
    await clickButton(rootElement, "Search");

    expect(onGlobalSearch).toHaveBeenCalledWith({
      q: "coda",
      timeZone: "Asia/Shanghai",
      agentLimit: 20,
      channelLimit: 20,
      messageLimit: 80,
    });
    expect(rootElement.textContent).toContain("Agents");
    expect(rootElement.textContent).toContain("Channels");
    expect(rootElement.textContent).toContain("Messages");
    expect(rootElement.textContent).toContain("Coda");
    expect(rootElement.querySelectorAll("mark").length).toBeGreaterThan(0);
    expect(rootElement.querySelector('[data-search-result-kind="agent"]')?.closest("[data-slei-panel]")?.getAttribute("data-variant")).toBe("listItem");
    expect(rootElement.querySelector('[data-search-result-kind="channel"]')?.closest("[data-slei-panel]")?.getAttribute("data-variant")).toBe("listItem");
    expect(rootElement.querySelector('[data-search-result-kind="message"]')?.closest("[data-slei-panel]")?.getAttribute("data-variant")).toBe("listItem");
  });

  it("renders result sections as a non-exclusive accordion", async () => {
    const onGlobalSearch = vi.fn(async (_query: GlobalSearchQuery) => receipt);
    const rootElement = await renderSearchPage({ onGlobalSearch });

    await changeInput(inputByLabel(rootElement, "Global search input"), " coda ");
    await clickButton(rootElement, "Search");

    const accordion = rootElement.querySelector('[data-slot="search-results-accordion"]');
    const items = Array.from(rootElement.querySelectorAll<HTMLElement>('[data-slot="accordion-item"]'));
    const triggers = Array.from(rootElement.querySelectorAll<HTMLButtonElement>('[data-slot="accordion-trigger"]'));
    const agentsTrigger = triggers.find((trigger) => trigger.textContent?.includes("Agents"));
    const channelsTrigger = triggers.find((trigger) => trigger.textContent?.includes("Channels"));

    expect(accordion?.getAttribute("data-type")).toBe("multiple");
    expect(items.length).toBe(3);
    expect(items[0]?.className).toContain("border-b");
    expect(items[0]?.className).not.toContain("border-0");
    expect(items[2]?.className).toContain("last:border-b-0");
    expect(triggers.length).toBe(3);
    expect(agentsTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(channelsTrigger?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      agentsTrigger?.click();
    });

    expect(agentsTrigger?.getAttribute("aria-expanded")).toBe("false");
    expect(channelsTrigger?.getAttribute("aria-expanded")).toBe("true");
  });

  it("ignores stale search results after clearing the query before the request resolves", async () => {
    const pending = deferredReceipt();
    const onGlobalSearch = vi.fn(() => pending.promise);
    const rootElement = await renderSearchPage({ onGlobalSearch });

    await changeInput(inputByLabel(rootElement, "Global search input"), "coda");
    await clickButton(rootElement, "Search");
    await clickButton(rootElement, "Clear search query");

    await act(async () => {
      pending.resolve(searchReceipt("coda", "Stale Coda"));
      await pending.promise;
    });
    await act(async () => undefined);

    expect(rootElement.textContent).toContain("Search agents, channels, and messages");
    expect(rootElement.textContent).not.toContain("Stale Coda");
  });

  it("does not duplicate the same in-flight search through the form submit path", async () => {
    const pending = deferredReceipt();
    const onGlobalSearch = vi.fn(() => pending.promise);
    const rootElement = await renderSearchPage({ onGlobalSearch });

    await changeInput(inputByLabel(rootElement, "Global search input"), "coda");
    await clickButton(rootElement, "Search");
    await submitSearchForm(rootElement);

    expect(onGlobalSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest search results when an older request resolves last", async () => {
    const first = deferredReceipt();
    const second = deferredReceipt();
    const onGlobalSearch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const rootElement = await renderSearchPage({ onGlobalSearch });

    await changeInput(inputByLabel(rootElement, "Global search input"), "alpha");
    await clickButton(rootElement, "Search");
    await changeInput(inputByLabel(rootElement, "Global search input"), "beta");
    await clickButton(rootElement, "Search");

    await act(async () => {
      second.resolve(searchReceipt("beta", "Fresh Beta"));
      await second.promise;
    });
    await act(async () => undefined);
    expect(rootElement.textContent).toContain("Fresh Beta");

    await act(async () => {
      first.resolve(searchReceipt("alpha", "Stale Alpha"));
      await first.promise;
    });
    await act(async () => undefined);

    expect(rootElement.textContent).toContain("Fresh Beta");
    expect(rootElement.textContent).not.toContain("Stale Alpha");
  });

  it("renders real From, Channel, and Time dropdown data and sends selected filters", async () => {
    const onGlobalSearch = vi.fn(async (_query: GlobalSearchQuery) => receipt);
    const rootElement = await renderSearchPage({ onGlobalSearch });

    const filterTriggers = Array.from(rootElement.querySelectorAll<HTMLElement>('[data-slot="select-trigger"]'));
    expect(filterTriggers.length).toBe(3);
    expect(filterTriggers.every((trigger) => trigger.querySelector("svg"))).toBe(true);

    await openSelect(rootElement, "From");
    expect(document.body.textContent).toContain("Lei");
    expect(document.body.textContent).toContain("Coda");
    await clickSelectItem("Coda");

    await openSelect(rootElement, "Channel");
    expect(document.body.textContent).toContain("#release");
    await clickSelectItem("#release");

    await openSelect(rootElement, "Any time");
    await clickSelectItem("Last 7 days");

    await changeInput(inputByLabel(rootElement, "Global search input"), "coda");
    await clickButton(rootElement, "Search");

    expect(onGlobalSearch).toHaveBeenLastCalledWith({
      q: "coda",
      fromId: "agent_coda",
      channelId: "channel_release",
      timeRange: "last7Days",
      timeZone: "Asia/Shanghai",
      agentLimit: 20,
      channelLimit: 20,
      messageLimit: 80,
    });
  });

  it("does not render a Relevant filter", async () => {
    const rootElement = await renderSearchPage();

    expect(rootElement.textContent).not.toContain("Relevant");
  });

  it("renders the no-result placeholder without background or border at the same size as the empty-query placeholder", async () => {
    const messages = createDesktopMessages("zh-CN");
    const rootElement = await renderSearchPage({
      messages,
      onGlobalSearch: async () => ({ query: "不存在", totals: { agents: 0, channels: 0, messages: 0 }, agents: [], channels: [], messages: [] }),
    });

    await changeInput(inputByLabel(rootElement, "全局搜索输入框"), "不存在");
    await clickButtonWithExactText(rootElement, "搜索");

    const emptyState = searchEmptyState(rootElement);
    expect(rootElement.textContent).toContain(messages.search.noResultTitle);
    expect(emptyState?.dataset.emptySize).toBe("lg");
    expect(emptyState?.className).not.toContain("border");
    expect(emptyState?.className).not.toContain("bg-");
    expect(rootElement.querySelector<HTMLImageElement>('img[data-empty-asset="search"]')?.getAttribute("src")).toContain("empty-search.png");
  });

  it("renders localized generic error copy without visible raw thrown details", async () => {
    const messages = createDesktopMessages("zh-CN");
    const rootElement = await renderSearchPage({
      messages,
      onGlobalSearch: async () => {
        throw new Error("backend timeout in English");
      },
    });

    await changeInput(inputByLabel(rootElement, "全局搜索输入框"), "coda");
    await clickButtonWithExactText(rootElement, "搜索");

    expect(rootElement.textContent).toContain(messages.search.errorDescription);
    expect(searchEmptyState(rootElement)?.dataset.emptySize).toBe("lg");
    expect(searchEmptyState(rootElement)?.className).not.toContain("border");
    expect(searchEmptyState(rootElement)?.className).not.toContain("bg-");
    expect(rootElement.textContent).not.toContain("backend timeout in English");
  });

  it("renders zh-CN channel and human message labels without leaking daemon English copy", async () => {
    const messages = createDesktopMessages("zh-CN");
    const localizedReceipt: GlobalSearchReceipt = {
      query: "发布",
      totals: { agents: 0, channels: 1, messages: 1 },
      agents: [],
      channels: [
        {
          kind: "channel",
          channelId: "channel_release",
          title: "#release",
          subtitle: "Channel",
          matchedFields: ["title"],
        },
      ],
      messages: [
        {
          kind: "message",
          sourceKind: "channel",
          messageId: "msg_human_release",
          channelId: "channel_release",
          sessionId: "session_release",
          authorId: "human:local",
          authorLabel: "Me",
          sourceLabel: "Channel",
          snippet: "发布检查已经完成",
          createdAt: "2026-06-17T08:00:00.000Z",
          matchedFields: ["snippet"],
        },
      ],
    };
    const rootElement = await renderSearchPage({
      messages,
      profile: { displayName: "李雷", handle: "@leelei", avatar: "李" },
      data: createSleiFixtures({
        channels: [
          { id: "channel_release", name: "release", description: "发布频道", unread: 0 },
        ],
        members: [agentMember("agent_coda", "Coda")],
      }),
      onGlobalSearch: async () => localizedReceipt,
    });

    await changeInput(inputByLabel(rootElement, "全局搜索输入框"), "发布");
    await clickButtonWithExactText(rootElement, "搜索");

    expect(rootElement.textContent).toContain("发布频道");
    expect(rootElement.textContent).toContain("李雷");
    expect(rootElement.textContent).not.toContain("Channel");
    expect(rootElement.textContent).not.toContain("Me");
    expect(rootElement.textContent).not.toContain("@me");
  });

  it("renders a non-empty date for DM message results with epoch-second createdAt values", async () => {
    const dmReceipt: GlobalSearchReceipt = {
      query: "hello",
      totals: { agents: 0, channels: 0, messages: 1 },
      agents: [],
      channels: [],
      messages: [
        {
          kind: "message",
          sourceKind: "dm",
          messageId: "msg_epoch",
          conversationId: "dm:agent_coda",
          sessionId: "session:dm:agent_coda",
          authorId: "agent_coda",
          authorName: "Coda",
          authorHandle: "@coda",
          sourceLabel: "Coda",
          snippet: "hello from epoch seconds",
          createdAt: "1780390800",
          matchedFields: ["snippet"],
        },
      ],
    };
    const rootElement = await renderSearchPage({ onGlobalSearch: async () => dmReceipt });

    await changeInput(inputByLabel(rootElement, "Global search input"), "hello");
    await clickButton(rootElement, "Search");

    const resultButton = Array.from(rootElement.querySelectorAll("button")).find((button) => button.textContent?.includes("hello from epoch seconds"));
    expect(resultButton?.textContent).toMatch(/\d{2}[-/]\d{2}/);
  });

  it("calls result selection callbacks with the selected result ids", async () => {
    const onAgentResultSelect = vi.fn();
    const onChannelResultSelect = vi.fn();
    const onMessageResultSelect = vi.fn();
    const onResultSelect = vi.fn();
    const rootElement = await renderSearchPage({
      onGlobalSearch: async () => receipt,
      onAgentResultSelect,
      onChannelResultSelect,
      onMessageResultSelect,
      onResultSelect,
    });

    await changeInput(inputByLabel(rootElement, "Global search input"), "coda");
    await clickButton(rootElement, "Search");
    await clickButton(rootElement, /Open agent Coda/);
    await clickButton(rootElement, /Open channel #release/);
    await clickButton(rootElement, /Open message msg_coda/);

    expect(onAgentResultSelect).toHaveBeenCalledWith("agent_coda");
    expect(onChannelResultSelect).toHaveBeenCalledWith("channel_release");
    expect(onMessageResultSelect).toHaveBeenCalledWith(receipt.messages[0]);
    expect(onResultSelect).not.toHaveBeenCalled();
  });
});
