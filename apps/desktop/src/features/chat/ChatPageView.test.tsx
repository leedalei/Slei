// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSleiFixtures, type SleiMember } from "../../test/fixtures";
import { defaultProfile } from "../../app/model";
import { createDesktopMessages } from "../../i18n";
import { ChatPage } from "./ChatPageView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};
HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};

function memberWithLongMentionText(): SleiMember {
  return {
    id: "agent_architect",
    name: "架构师",
    handle: "@architect-with-an-intentionally-long-handle",
    avatar: "AR",
    type: "agent",
    runtimeStatus: "idle",
    role: "架构设计 Agent，负责与用户头脑风暴、梳理需求、制定技术文档与验收标准，输出清晰的架构设计方案",
    description: "负责架构设计。",
    computer: "Local",
    created: "2026-06-09",
    creator: "lei lee @lei-lee",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "负责架构设计。",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "Idle",
    capabilities: ["architecture"],
  };
}

function dmSkillSlashFixture(
  initialDraft: string,
  options: { onSendMessage?: (body: string) => Promise<void> | void } = {},
) {
  const messages = createDesktopMessages("zh-CN");
  const member = {
    ...memberWithLongMentionText(),
    skills: [
      { id: "guide-create", name: "guide-create", trigger: "Create agents", path: "/tmp/guide/SKILL.md" },
      { id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" },
    ],
  };
  const data = createSleiFixtures({
    conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
    members: [member],
  });

  return {
    element: (
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        initialDraft={initialDraft}
        messages={messages}
        onSendMessage={options.onSendMessage}
        profile={defaultProfile}
      />
    ),
    messages,
  };
}

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

async function mountChatPage(element: React.ReactElement) {
  mountedContainer = document.createElement("div");
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  await act(async () => {
    mountedRoot?.render(element);
  });
  await act(async () => undefined);
  return mountedContainer;
}

function staticMarkupHost(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

function fileDropData(files: File[]) {
  return {
    files,
    types: ["Files"],
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
  };
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

describe("ChatPage DM skill message highlight", () => {
  it("highlights only a known leading DM skill slash token", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = {
      ...memberWithLongMentionText(),
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    };
    const data = createSleiFixtures({
      conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
      members: [member],
      messages: [
        {
          id: "msg_skill",
          author: "Lei",
          role: "human",
          time: "10:00",
          body: "/memory **重点**",
          channelId: "dm_agent_architect",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain("slei-message-skill");
    expect(html).toContain("/memory");
    expect(html).toContain("<strong>重点</strong>");
  });

  it("preserves whitespace-sensitive markdown after a highlighted DM skill token", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = {
      ...memberWithLongMentionText(),
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    };
    const data = createSleiFixtures({
      conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
      members: [member],
      messages: [
        {
          id: "msg_skill_code",
          author: "Lei",
          role: "human",
          time: "10:00",
          body: "/memory\n    code",
          channelId: "dm_agent_architect",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain("slei-message-skill");
    expect(html).toContain("/memory");
    expect(html).toContain("<pre");
    expect(html).toContain("<code>code");
  });

  it("does not highlight middle, unknown, leading-space, or channel slash tokens", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = {
      ...memberWithLongMentionText(),
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    };
    const dmConversation = { id: "dm_agent_architect", kind: "dm" as const, agentId: member.id, createdAt: "0", updatedAt: "0" };

    const renderBody = (body: string, conversation = dmConversation) => {
      const data = createSleiFixtures({
        conversations: [dmConversation],
        members: [member],
        messages: [
          {
            id: `msg_${body.replace(/\W+/g, "_")}`,
            author: "Lei",
            role: "human",
            time: "10:00",
            body,
            channelId: conversation.id,
          },
        ],
      });

      return renderToStaticMarkup(
        <ChatPage
          activeChannel={data.channels[0]}
          activeConversation={conversation}
          data={data}
          messages={messages}
          profile={defaultProfile}
        />,
      );
    };

    expect(renderBody("请用 /memory")).not.toContain("slei-message-skill");
    expect(renderBody("/unknown")).not.toContain("slei-message-skill");
    expect(renderBody(" /memory")).not.toContain("slei-message-skill");

    const channelData = createSleiFixtures({
      members: [member],
      messages: [
        {
          id: "msg_channel_skill",
          author: "Lei",
          role: "human",
          time: "10:00",
          body: "/memory",
          channelId: "all",
        },
      ],
    });

    const channelHtml = renderToStaticMarkup(
      <ChatPage
        activeChannel={channelData.channels[0]}
        data={channelData}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(channelHtml).not.toContain("slei-message-skill");
  });
});

describe("ChatPage mention panel", () => {
  it("renders the merged composer command panel for a channel slash draft", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="/"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const host = staticMarkupHost(html);

    expect(host.querySelector('[data-testid="slei-composer-command-panel"]')).not.toBeNull();
    expect(host.textContent).toContain(messages.chat.insertFileCommand);
    expect(host.textContent).toContain(messages.chat.convertToTaskCommand);
  });

  it("renders the merged composer command panel for a middle slash trigger", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="帮我 /"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const host = staticMarkupHost(html);

    expect(host.querySelector('[data-testid="slei-composer-command-panel"]')).not.toBeNull();
    expect(host.textContent).toContain(messages.chat.insertFileCommand);
    expect(host.textContent).toContain(messages.chat.convertToTaskCommand);
  });

  it("filters fixed composer commands by aliases in Chinese locale", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    for (const initialDraft of ["/fi", "/file"]) {
      const html = renderToStaticMarkup(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialDraft={initialDraft}
          messages={messages}
          profile={defaultProfile}
        />,
      );
      expect(staticMarkupHost(html).textContent).toContain(messages.chat.insertFileCommand);
    }

    for (const initialDraft of ["/task", "/转为"]) {
      const html = renderToStaticMarkup(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialDraft={initialDraft}
          messages={messages}
          profile={defaultProfile}
        />,
      );
      expect(staticMarkupHost(html).textContent).toContain(messages.chat.convertToTaskCommand);
    }
  });

  it("merges fixed commands and DM skill slash options", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
      members: [
        {
          ...member,
          skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        initialDraft="/"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.chat.chooseComposerCommand);
    expect(html).toContain(messages.chat.insertFileCommand);
    expect(html).toContain(messages.chat.convertToTaskCommand);
    expect(html).toContain("/memory");
  });

  it("clicking convert to task removes the slash query and turns on the task switch", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="/task"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-composer-command-id="convert-to-task"]')?.click();
    });

    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')?.value).toBe("");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="slei-as-task-switch"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("clicking insert file removes the slash query and opens the file input", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="/file"
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const fileInput = host.querySelector<HTMLInputElement>('[data-testid="slei-composer-file-input"]')!;
    const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-composer-command-id="insert-file"]')?.click();
    });

    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')?.value).toBe("");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("send button executes an active fixed task command instead of submitting command text", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });
    const onSendMessage = vi.fn();

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="/task"
        messages={messages}
        onSendMessage={onSendMessage}
        profile={defaultProfile}
      />,
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-send-button"]')?.click();
    });

    expect(onSendMessage).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')?.value).toBe("");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="slei-as-task-switch"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("send button executes an active fixed file command instead of submitting command text", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });
    const onSendMessage = vi.fn();

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="/file"
        messages={messages}
        onSendMessage={onSendMessage}
        profile={defaultProfile}
      />,
    );
    const fileInput = host.querySelector<HTMLInputElement>('[data-testid="slei-composer-file-input"]')!;
    const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-send-button"]')?.click();
    });

    expect(onSendMessage).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')?.value).toBe("");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("selecting a DM skill option inserts the skill at the slash trigger position", async () => {
    const { element } = dmSkillSlashFixture("帮我 /me");
    const container = await mountChatPage(element);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-composer-skill-id="memory"]')?.click();
    });

    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')?.value).toBe("帮我 /memory ");
  });

  it("selects a merged composer command option with keyboard", async () => {
    const onSendMessage = vi.fn();
    const { element } = dmSkillSlashFixture("/", { onSendMessage });
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(input.value).toBe("");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="slei-as-task-switch"]')?.getAttribute("aria-checked")).toBe("true");
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("moves the selected merged composer command option with arrow keys", async () => {
    const { element } = dmSkillSlashFixture("/");
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;
    const options = () => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-composer-option-index]"));

    expect(options()[0]?.getAttribute("aria-current")).toBe("true");
    expect(options()[1]?.getAttribute("aria-current")).toBeNull();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    expect(options()[0]?.getAttribute("aria-current")).toBeNull();
    expect(options()[1]?.getAttribute("aria-current")).toBe("true");

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });

    expect(options()[0]?.getAttribute("aria-current")).toBe("true");
    expect(options()[1]?.getAttribute("aria-current")).toBeNull();
  });

  it("selects a DM skill slash option with Tab", async () => {
    const onSendMessage = vi.fn();
    const { element } = dmSkillSlashFixture("/memo", { onSendMessage });
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });

    expect(input.value).toBe("/memory ");
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("keeps Shift+Enter available while the DM skill slash picker is active", async () => {
    const onSendMessage = vi.fn();
    const { element } = dmSkillSlashFixture("/me", { onSendMessage });
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });

    expect(input.value).toBe("/me");
    expect(container.querySelector('[data-testid="slei-composer-command-panel"]')).not.toBeNull();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("clears the leading skill slash query with Escape", async () => {
    const { element } = dmSkillSlashFixture("/me");
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(input.value).toBe("");
    expect(container.querySelector('[data-testid="slei-composer-command-panel"]')).toBeNull();
  });

  it("renders channel titles with a styled literal hash prefix", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const host = staticMarkupHost(html);
    const title = host.querySelector<HTMLElement>('[data-testid="slei-channel-title"]');
    const hashMark = title?.querySelector<HTMLElement>('[data-slot="channel-title-hash-mark"]');

    expect(title?.textContent).toBe("#all");
    expect(title?.className).toContain("text-lg font-semibold");
    expect(title?.getAttribute("aria-label")).toBe("# all");
    expect(hashMark?.tagName).toBe("SPAN");
    expect(hashMark?.textContent).toBe("#");
    expect(hashMark?.className).toContain("mr-2");
    expect(hashMark?.className).toContain("font-bold");
    expect(hashMark?.className).not.toContain("italic");
    expect(hashMark?.className).toContain("text-[var(--text-color-3)]");
    expect(hashMark?.querySelector('[data-slei-icon="hash"]')).toBeNull();
  });

  it("places the channel title copy button on the title row", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const titleStart = html.indexOf('aria-label="# all"');
    const titleTextIndex = html.indexOf('data-slot="channel-title-hash-mark"', titleStart);
    const copyButtonIndex = html.indexOf(`aria-label="${messages.chat.copyMessage}"`, titleStart);

    expect(titleStart).toBeGreaterThanOrEqual(0);
    expect(titleTextIndex).toBeGreaterThan(titleStart);
    expect(copyButtonIndex).toBeGreaterThan(titleTextIndex);
    expect(copyButtonIndex).toBeLessThan(html.indexOf('data-testid="slei-channel-header-actions"'));
  });

  it("renders linked project text and edit button in non-default channel headers", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "kol-content", name: "kol-content", description: "kol-content", projectName: "kol-content", projectPaths: ["/workspace/kol-content"], unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.chat.projectPrefix("/workspace/kol-content"));
    expect(html).toContain(`aria-label="${messages.chat.editProjects}"`);
    expect(html).toContain('data-testid="slei-channel-project-edit"');
  });

  it("opens the linked project editor with compact action buttons", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "kol-content", name: "kol-content", description: "kol-content", projectName: "kol-content", projectPaths: ["/workspace/kol-content"], unread: 0 }],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onChannelProjectPathsChange={vi.fn()}
        profile={defaultProfile}
      />,
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-project-edit"]')?.click();
    });

    const folderButton = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${messages.chat.projectFolderPicker}"]`);
    const cancelButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === messages.common.cancel);
    const saveButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === messages.common.save);

    expect(folderButton?.className).toContain("h-7");
    expect(folderButton?.className).toContain("text-xs");
    expect(cancelButton?.className).toContain("h-7");
    expect(cancelButton?.className).toContain("text-xs");
    expect(saveButton?.className).toContain("h-7");
    expect(saveButton?.className).toContain("text-xs");
  });

  it("shows an empty linked project label instead of the channel description when no project is linked", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "dev-content", name: "dev-content", description: "频道", projectPaths: [], unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.chat.projectPrefix(messages.chat.noLinkedProjects));
    expect(html).not.toContain(">频道</p>");
  });

  it("does not render the project edit button for the all channel", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", projectPaths: [], unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).not.toContain(`aria-label="${messages.chat.editProjects}"`);
    expect(html).not.toContain('data-testid="slei-channel-project-edit"');
  });

  it("makes the full channel header draggable without marking header buttons as drag regions", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const headerMarker = html.indexOf('data-testid="slei-channel-header"');
    const headerStart = html.lastIndexOf("<header", headerMarker);
    const headerEnd = html.indexOf("</header>", headerMarker);
    const headerHtml = html.slice(headerStart, headerEnd);
    const copyButtonStart = headerHtml.indexOf(`aria-label="${messages.chat.copyMessage}"`);
    const membersButtonStart = headerHtml.indexOf('data-testid="slei-channel-member-add-trigger"');

    expect(headerMarker).toBeGreaterThanOrEqual(0);
    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml).toContain('data-tauri-drag-region="deep"');
    expect(headerHtml).toContain("select-none");
    expect(copyButtonStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml.slice(copyButtonStart, copyButtonStart + 220)).not.toContain("data-tauri-drag-region");
    expect(membersButtonStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml.slice(membersButtonStart, membersButtonStart + 260)).not.toContain("data-tauri-drag-region");
  });

  it("keeps the chat workspace transparent while the composer floats in a frosted shell", () => {
    const source = readFileSync(join(process.cwd(), "src/features/chat/ChatPageView.tsx"), "utf8");

    expect(source).toContain('"relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-transparent"');
    expect(source).not.toContain('"relative grid h-full min-h-0 bg-background"');
    expect(source).toContain('border-b bg-transparent px-4 py-3');
    expect(source).not.toContain('border-b bg-background/95 px-4 py-3');
    expect(source).not.toContain('className="border-b bg-transparent px-4 py-2"');
    expect(source).not.toContain('<footer className="border-t bg-transparent">');
    expect(source).not.toContain('<footer className="border-t bg-background/95">');
    expect(source).toContain('data-testid="slei-composer-shell"');
    expect(source).toContain("absolute inset-x-0 bottom-0 z-30 overflow-visible px-4 py-3");
    expect(source).not.toContain("absolute inset-x-0 bottom-0 z-30 overflow-visible p-3");
    expect(source).not.toContain("absolute inset-x-0 bottom-0 z-30 px-4 pb-4 pt-3");
    expect(source).toContain("slei-composer-glass");
    expect(source).toContain("slei-scroll-to-bottom");
    expect(source).toContain("shadow-[0_2px_4px_rgba(0,0,0,0.10)] backdrop-blur-xl");
    expect(source).toContain('<Button aria-label={messages.chat.projectFolderPicker} className="h-7 gap-1 px-2.5 text-xs has-[>svg]:px-2" onClick={() => projectFolderInputRef.current?.click()} size="sm" type="button">');
    expect(source).not.toContain('<Button aria-label={messages.chat.projectFolderPicker} className="h-7 gap-1 px-2.5 text-xs has-[>svg]:px-2" onClick={() => projectFolderInputRef.current?.click()} size="sm" type="button" variant="outline">');
    expect(source).toContain("slei-composer-glass pointer-events-auto mx-auto grid max-w-full gap-3 overflow-visible rounded-2xl border border-border/60 p-3");
    expect(source).not.toContain("slei-composer-glass pointer-events-auto mx-auto grid max-w-full gap-3 overflow-visible rounded-2xl border border-border/60 p-3 backdrop-blur-xl");
    expect(source).toContain("slei-composer-input max-h-[500px] min-h-12 resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0");
    expect(source).not.toContain("slei-composer-input max-h-[500px] min-h-20");
    expect(source).not.toContain('className="slei-composer-input min-h-20 resize-none bg-background/80"');
  });

  it("renders the composer input inside a unified autosizing composer surface", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const surface = host.querySelector<HTMLElement>('[data-testid="slei-composer-surface"]');
    const composerInput = host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]');
    const toolbar = host.querySelector<HTMLElement>('[data-testid="slei-composer-toolbar"]');

    expect(surface).not.toBeNull();
    expect(surface?.className).toContain("p-0");
    expect(surface?.className).not.toContain("p-1");
    expect(surface?.contains(composerInput!)).toBe(true);
    expect(surface?.contains(toolbar!)).toBe(true);
    expect(composerInput?.tagName).toBe("TEXTAREA");
    expect(composerInput?.className).toContain("slei-composer-input");
    expect(composerInput?.className).toContain("max-h-[500px]");
    expect(composerInput?.className).toContain("min-h-12");
    expect(composerInput?.className).not.toContain("min-h-20");
    expect(composerInput?.className).toContain("resize-none");
    expect(composerInput?.className).toContain("border-0");
    expect(composerInput?.className).toContain("bg-transparent");
    expect(composerInput?.className).toContain("px-0");
    expect(composerInput?.className).toContain("py-0");
    expect(composerInput?.className).not.toContain("py-3");
    expect(composerInput?.className).toContain("shadow-none");
    expect(composerInput?.className).toContain("focus-visible:ring-0");
    expect(composerInput?.getAttribute("placeholder")).toBe("输入消息到 #all，输入 / 打开功能菜单");
    expect(composerInput?.getAttribute("aria-label")).toBe("输入消息到 #all，输入 / 打开功能菜单");
    expect(composerInput?.className).not.toContain("bg-white/10");
    expect(composerInput?.className).not.toContain("backdrop-blur-xl");
    expect(composerInput?.className).not.toContain("focus:bg-white/15");
    expect(composerInput?.parentElement?.className).not.toContain("group");
  });

  it("keeps one unrestricted multi-file composer input without a toolbar attachment button", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const fileInputs = host.querySelectorAll<HTMLInputElement>('input[type="file"]');

    expect(fileInputs).toHaveLength(1);
    expect(fileInputs[0]?.getAttribute("accept")).toBeNull();
    expect(fileInputs[0]?.multiple).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="slei-insert-file-button"]')).toBeNull();
  });

  it("uploads dropped composer files and renders image and file previews", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });
    const onAttachmentUpload = vi.fn(async (request) => ({
      attachment: {
        id: `att-${request.name}`,
        name: request.name,
        mimeType: request.mimeType,
        size: 12,
        url: request.mimeType.startsWith("image/") ? "data:image/png;base64,aaa" : undefined,
      },
    }));

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onAttachmentUpload={onAttachmentUpload}
        profile={defaultProfile}
      />,
    );
    const surface = host.querySelector<HTMLElement>('[data-testid="slei-composer-surface"]');
    const imageFile = new File(["image"], "screen.png", { type: "image/png" });
    const textFile = new File(["notes"], "notes.txt", { type: "text/plain" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: fileDropData([imageFile, textFile]) });

    await act(async () => {
      surface?.dispatchEvent(event);
    });
    await act(async () => {
      await vi.waitFor(() => expect(onAttachmentUpload).toHaveBeenCalledTimes(2));
    });

    expect(host.querySelector('img[src="data:image/png;base64,aaa"]')).not.toBeNull();
    expect(host.textContent).toContain("notes.txt");
  });

  it("uploads pasted composer files and renders an attachment preview", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });
    const onAttachmentUpload = vi.fn(async (request) => ({
      attachment: {
        id: `att-${request.name}`,
        name: request.name,
        mimeType: request.mimeType,
        size: 24,
        url: undefined,
      },
    }));

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onAttachmentUpload={onAttachmentUpload}
        profile={defaultProfile}
      />,
    );
    const surface = host.querySelector<HTMLElement>('[data-testid="slei-composer-surface"]');
    const pastedFile = new File(["clip"], "clipboard.pdf", { type: "application/pdf" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: fileDropData([pastedFile]) });

    await act(async () => {
      surface?.dispatchEvent(event);
    });
    await act(async () => {
      await vi.waitFor(() => expect(onAttachmentUpload).toHaveBeenCalledTimes(1));
    });

    expect(host.textContent).toContain("clipboard.pdf");
  });

  it("keeps successful dropped attachments and shows a toast when another upload fails", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });
    const onAttachmentUpload = vi.fn(async (request) => {
      if (request.name === "broken.txt") {
        throw new Error("upload failed");
      }
      return {
        attachment: {
          id: `att-${request.name}`,
          name: request.name,
          mimeType: request.mimeType,
          size: 16,
          url: undefined,
        },
      };
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onAttachmentUpload={onAttachmentUpload}
        profile={defaultProfile}
      />,
    );
    const surface = host.querySelector<HTMLElement>('[data-testid="slei-composer-surface"]');
    const okFile = new File(["ok"], "ok.txt", { type: "text/plain" });
    const brokenFile = new File(["broken"], "broken.txt", { type: "text/plain" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: fileDropData([okFile, brokenFile]) });

    await act(async () => {
      surface?.dispatchEvent(event);
    });
    await act(async () => {
      await vi.waitFor(() => expect(onAttachmentUpload).toHaveBeenCalledTimes(2));
    });

    expect(host.textContent).toContain("ok.txt");
    expect(host.textContent).not.toContain("broken.txt");
    expect(host.textContent).toContain(messages.chat.sendFailed);
  });

  it("keeps long message role descriptions on one truncated header row", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [member],
      messages: [
        {
          id: "msg_long_role",
          author: member.name,
          handle: member.handle,
          role: "agent",
          time: "10:24",
          body: "我会检查这个交付。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain("overflow-hidden whitespace-nowrap");
    expect(html).toContain("min-w-0 flex-1 truncate");
    expect(html).toContain("shrink-0 text-sm text-foreground");
    expect(html.match(/aria-hidden="true">｜/g)?.length).toBe(2);
  });

  it("uses the shared empty illustration for empty channel tasks and files panels", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
      messages: [],
      tasks: [],
    });

    const tasksHtml = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelView="tasks"
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const filesHtml = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelView="files"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(tasksHtml).toContain(messages.chat.channelTaskEmpty);
    expect(tasksHtml).toContain('data-empty-illustration="nodata"');
    expect(filesHtml).toContain(messages.chat.channelFileEmpty);
    expect(filesHtml).toContain('data-empty-illustration="nodata"');
  });

  it("uses the shared empty illustration for an empty chat timeline", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
      messages: [],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.empty.defaultTitle.nodata);
    expect(html).toContain('data-empty-illustration="nodata"');
    expect(html).toContain('data-empty-asset="data"');
    expect(html).toContain("empty-data.png");
  });

  it("renders copy and star actions before the full message send time", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg_timestamp",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "09:08",
          sentAt: "06-16 09:08:07",
          body: "带完整发送时间的消息。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const messageHtml = html.slice(html.indexOf('data-message-id="msg_timestamp"'));
    const timestampIndex = messageHtml.indexOf("06-16");
    const copyIndex = messageHtml.indexOf(`aria-label="${messages.chat.copyMessage}"`);
    const saveIndex = messageHtml.indexOf(`aria-label="${messages.chat.saveMessage}"`);
    const host = document.createElement("div");
    host.innerHTML = messageHtml;
    const actionButtons = Array.from(host.querySelectorAll<HTMLElement>('[data-slot="message-actions"] button'));
    const threadIcon = host.querySelector<SVGElement>('[data-message-thread-open="msg_timestamp"] [data-slei-icon="messageSquare"]');
    const copyIcon = host.querySelector<SVGElement>('[data-slei-icon="copy"]');
    const bookmarkIcon = host.querySelector<SVGElement>('[data-slei-icon="bookmarkOutline"]');

    expect(messageHtml).toContain('data-slot="message-actions"');
    expect(messageHtml).not.toContain("2026-06-16");
    expect(messageHtml).toContain("06-16 09:08");
    expect(messageHtml).not.toContain("09:08:07");
    expect(messageHtml).not.toContain("06-16</span><span>09:08:07");
    expect(messageHtml).toContain("flex shrink-0 items-center gap-1");
    expect(messageHtml).not.toContain("min-w-[7.5rem]");
    expect(actionButtons).toHaveLength(3);
    expect(actionButtons.every((button) => button.className.includes("size-6"))).toBe(true);
    expect(actionButtons.some((button) => button.className.includes("[&_svg]:size-2.5"))).toBe(false);
    expect(threadIcon?.className.baseVal).toContain("size-3");
    expect(copyIcon?.className.baseVal).toContain("size-3");
    expect(bookmarkIcon?.className.baseVal).toContain("size-3");
    expect(host.querySelector(".t-icon-swap")?.className).toContain("size-3");
    expect(timestampIndex).toBeGreaterThan(-1);
    expect(copyIndex).toBeGreaterThan(-1);
    expect(saveIndex).toBeGreaterThan(copyIndex);
    expect(timestampIndex).toBeGreaterThan(saveIndex);
  });

  it("lets the real chat toast close control clear a copied-message toast", async () => {
    const clipboard = { writeText: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    vi.stubGlobal("navigator", { clipboard });
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg_copy_toast",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "09:08",
          body: "复制后显示 toast。",
          channelId: "all",
        },
      ],
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          messages={messages}
          profile={defaultProfile}
        />,
      );
      const message = host.querySelector<HTMLElement>('[data-message-id="msg_copy_toast"]');

      await act(async () => {
        message?.querySelector<HTMLButtonElement>(`button[aria-label="${messages.chat.copyMessage}"]`)?.click();
      });
      await act(async () => undefined);

      expect(host.querySelector('[data-slot="toast"]')?.textContent).toContain(messages.chat.copySuccess);
      expect(host.querySelector('[data-slot="toast-close"]')).not.toBeNull();

      await act(async () => {
        host.querySelector<HTMLButtonElement>('[data-slot="toast-close"]')?.click();
      });

      expect(host.querySelector('[data-slot="toast"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("copies markdown code block text from the code copy icon", async () => {
    const clipboard = { writeText: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    vi.stubGlobal("navigator", { clipboard });
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg_code_copy",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "09:08",
          body: "代码：\n\n```ts\nconst answer = 42;\nconsole.log(answer);\n```",
          channelId: "all",
        },
      ],
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          messages={messages}
          profile={defaultProfile}
        />,
      );
      const message = host.querySelector<HTMLElement>('[data-message-id="msg_code_copy"]');

      await act(async () => {
        message?.querySelector<HTMLButtonElement>('button[data-slot="markdown-code-copy"]')?.click();
      });
      await act(async () => undefined);

      expect(clipboard.writeText).toHaveBeenCalledWith("const answer = 42;\nconsole.log(answer);");
      expect(host.querySelector('[data-slot="toast"]')?.textContent).toContain(messages.chat.copySuccess);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a success toast after saving a message", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg_save_success_toast",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "09:08",
          body: "收藏后显示 toast。",
          channelId: "all",
        },
      ],
    });
    const onMessageSaveToggle = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onMessageSaveToggle={onMessageSaveToggle}
        profile={defaultProfile}
      />,
    );
    const message = host.querySelector<HTMLElement>('[data-message-id="msg_save_success_toast"]');

    await act(async () => {
      message?.querySelector<HTMLButtonElement>(`button[aria-label="${messages.chat.saveMessage}"]`)?.click();
    });
    await act(async () => undefined);

    expect(onMessageSaveToggle).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-slot="toast"]')?.textContent).toContain("收藏成功");
  });

  it("shows an error toast when saving a message fails", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg_save_failure_toast",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "09:08",
          body: "收藏失败后显示 toast。",
          channelId: "all",
        },
      ],
    });
    const onMessageSaveToggle = vi.fn<() => Promise<void>>(() => Promise.reject(new Error("daemon offline")));

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onMessageSaveToggle={onMessageSaveToggle}
        profile={defaultProfile}
      />,
    );
    const message = host.querySelector<HTMLElement>('[data-message-id="msg_save_failure_toast"]');

    await act(async () => {
      message?.querySelector<HTMLButtonElement>(`button[aria-label="${messages.chat.saveMessage}"]`)?.click();
    });
    await act(async () => undefined);

    expect(onMessageSaveToggle).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-slot="toast"]')?.textContent).toContain("收藏失败：daemon offline");
  });

  it("keeps a bottom sentinel for post-send timeline scrolling", () => {
    const source = readChatPageSource();

    expect(source).toContain("timelineViewportRef");
    expect(source).toContain("pendingScrollToBottomRef");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("viewport.scrollTo({");
    expect(source).toContain("behavior: \"smooth\"");
  });

  it("scrolls to the newest message after the user sends a message", async () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-existing", author: "Lei", role: "human", time: "10:00", body: "已有消息", channelId: "all" },
      ],
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialDraft="发送后滚到底部"
          messages={messages}
          onSendMessage={async () => undefined}
          profile={defaultProfile}
        />,
      );
      const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
      const scrollTo = vi.fn();
      setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 1000, scrollTop: 100 });
      Object.defineProperty(timeline, "scrollTo", { configurable: true, value: scrollTo });

      await act(async () => {
        host.querySelector<HTMLButtonElement>('[data-testid="slei-send-button"]')?.click();
      });

      expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    } finally {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
    }
  });

  it("renders the composer send action as an upward arrow icon button", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
    });
    const host = staticMarkupHost(renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="需要发送"
        messages={messages}
        profile={defaultProfile}
      />,
    ));

    const sendButton = host.querySelector<HTMLButtonElement>('[data-testid="slei-send-button"]');
    expect(sendButton?.className).toContain("bg-primary");
    expect(sendButton?.className).toContain("text-primary-foreground");
    expect(sendButton?.className).toContain("size-9");
    expect(sendButton?.className).toContain("rounded-full");
    expect(sendButton?.className).not.toContain("h-8");
    expect(sendButton?.className).not.toContain("px-3");
    expect(sendButton?.textContent?.trim()).toBe("");
    expect(sendButton?.getAttribute("aria-label")).toBe(messages.common.send);
    expect(sendButton?.querySelector('[data-slei-icon="arrowUp"]')).not.toBeNull();
    expect(sendButton?.querySelector('[data-slei-icon="send"]')).toBeNull();
  });

  it("uses the virtualizer last item when scrolling to the latest message", () => {
    const source = readChatPageSource();

    expect(source).not.toContain("timelineVirtualizer.scrollToIndex(timelineMessages.length - 1");
    expect(source).toContain("timelineVirtualizer.scrollToOffset(timelineVirtualizer.getTotalSize() + composerReservePx");
    expect(source).toContain("align: \"end\"");
    expect(source).toContain("behavior: \"smooth\"");
  });

  it("reserves bottom space so the floating composer does not cover timeline messages", () => {
    const source = readChatPageSource();

    expect(source).toContain("const COMPOSER_RESERVE_PX");
    expect(source).toContain("const COMPOSER_RESERVE_PX = 144;");
    expect(source).toContain("const COMPOSER_EXPANDED_RESERVE_PX");
    expect(source).toContain("composerReservePx");
    expect(source).toContain('"--chat-composer-reserve"');
    expect(source).toContain('data-testid="slei-chat-timeline-content"');
    expect(source).toContain("timelineVirtualizer.getTotalSize() + composerReservePx");
    expect(source).toContain("pb-[var(--chat-composer-reserve)]");
  });

  it("keeps the chat timeline scrollbar subtle until the timeline is focused", () => {
    const source = readChatPageSource();
    const css = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
    });
    const host = staticMarkupHost(renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    ));
    const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');

    expect(timeline?.className).toContain("slei-chat-timeline-scrollbar");
    expect(timeline?.getAttribute("tabindex")).toBe("0");
    expect(source).toContain('aria-label={messages.chat.timeline}');
    expect(css).toContain(".slei-chat-timeline-scrollbar {");
    expect(css).toContain("scrollbar-color: color-mix(in srgb, var(--border) 20%, transparent) transparent;");
    expect(css).toContain(".slei-chat-timeline-scrollbar:focus");
    expect(css).toContain(".slei-chat-timeline-scrollbar:focus-within");
    expect(css).toContain(".slei-chat-timeline-scrollbar::-webkit-scrollbar-thumb");
    expect(css).toContain("background-color: color-mix(in srgb, var(--border) 20%, transparent);");
  });

  it("uses measured composer height when autosized content exceeds the baseline reserve", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (typeof this.className === "string" && this.className.includes("slei-composer-glass")) {
        return {
          bottom: 320,
          height: 320,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialDraft={"长输入\n".repeat(30)}
          messages={messages}
          profile={defaultProfile}
        />,
      );

      await act(async () => undefined);

      expect(host.querySelector<HTMLElement>('[data-testid="slei-channel-chat-column"]')?.style.getPropertyValue("--chat-composer-reserve")).toBe("344px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("measures composer reserve after switching from a non-chat view back to chat", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (typeof this.className === "string" && this.className.includes("slei-composer-glass")) {
        return {
          bottom: 344,
          height: 344,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      const element = (initialChannelView: "tasks" | "chat") => (
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialChannelView={initialChannelView}
          initialDraft={"长输入\n".repeat(30)}
          messages={messages}
          profile={defaultProfile}
        />
      );
      const host = await mountChatPage(element("tasks"));

      expect(host.querySelector('[data-testid="slei-composer-shell"]')).toBeNull();
      expect(host.querySelector('[data-testid="slei-channel-chat-column"]')).toBeNull();

      await act(async () => {
        mountedRoot?.render(element("chat"));
      });
      await act(async () => undefined);

      expect(host.querySelector('[data-testid="slei-composer-shell"]')).not.toBeNull();
      expect(host.querySelector<HTMLElement>('[data-testid="slei-channel-chat-column"]')?.style.getPropertyValue("--chat-composer-reserve")).toBe("368px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("enables timeline virtualization only when there are more than 50 messages", () => {
    const source = readChatPageSource();

    expect(source).toContain("const TIMELINE_VIRTUALIZATION_THRESHOLD = 50");
    expect(source).toContain("const timelineUsesVirtualization = timelineMessages.length > TIMELINE_VIRTUALIZATION_THRESHOLD");
    expect(source).toContain("count: timelineUsesVirtualization ? timelineMessages.length : 0");
  });

  it("does not request older messages when the timeline is at the bottom", async () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const messages = createDesktopMessages("zh-CN");
    const onOlderMessagesLoad = vi.fn();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: `msg-${index + 1}`,
        author: "Lei",
        role: "human" as const,
        time: `10:${String(index).padStart(2, "0")}`,
        body: `消息 ${index + 1}`,
        channelId: "all",
      })),
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          messages={messages}
          onOlderMessagesLoad={onOlderMessagesLoad}
          profile={defaultProfile}
        />,
      );
      const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
      setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 3000, scrollTop: 2600 });

      await act(async () => {
        timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
      });

      expect(onOlderMessagesLoad).not.toHaveBeenCalled();
    } finally {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
    }
  });

  it("requests older messages when the user scrolls near the top", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onOlderMessagesLoad = vi.fn();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: `msg-${index + 1}`,
        author: "Lei",
        role: "human" as const,
        time: `10:${String(index).padStart(2, "0")}`,
        body: `消息 ${index + 1}`,
        channelId: "all",
      })),
    });
    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onOlderMessagesLoad={onOlderMessagesLoad}
        profile={defaultProfile}
      />,
    );
    const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
    setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 3000, scrollTop: 32 });

    await act(async () => {
      timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(onOlderMessagesLoad).toHaveBeenCalledTimes(1);
  });

  it("shows a loading status while older messages are loading", async () => {
    let resolveOlderMessages!: () => void;
    const messages = createDesktopMessages("zh-CN");
    const onOlderMessagesLoad = vi.fn(() => new Promise<void>((resolve) => {
      resolveOlderMessages = resolve;
    }));
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: `msg-${index + 1}`,
        author: "Lei",
        role: "human" as const,
        time: `10:${String(index).padStart(2, "0")}`,
        body: `消息 ${index + 1}`,
        channelId: "all",
      })),
    });
    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onOlderMessagesLoad={onOlderMessagesLoad}
        profile={defaultProfile}
      />,
    );
    const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
    setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 3000, scrollTop: 0 });

    await act(async () => {
      timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(host.querySelector('[data-testid="slei-older-messages-loading"]')?.textContent).toContain("正在加载");

    await act(async () => {
      resolveOlderMessages();
    });

    expect(host.querySelector('[data-testid="slei-older-messages-loading"]')).toBeNull();
  });

  it("preserves the viewport anchor after older messages are prepended", () => {
    const source = readChatPageSource();

    expect(source).toContain("pendingOlderMessagesScrollRestoreRef");
    expect(source).toContain("viewport.scrollTop = restore.scrollTop + delta");
  });

  it("shows a floating scroll-to-bottom button when an agent message arrives while the timeline is not at the bottom", async () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const messages = createDesktopMessages("zh-CN");
    const baseData = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-user", author: "Lei", role: "human", time: "10:00", body: "用户消息", channelId: "all" },
      ],
    });
    const nextData = {
      ...baseData,
      messages: [
        ...baseData.messages,
        { id: "msg-agent-new", author: "Nova", role: "agent" as const, time: "10:01", body: "新的 agent 消息", channelId: "all" },
      ],
    };

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={baseData.channels[0]}
          data={baseData}
          messages={messages}
          profile={defaultProfile}
        />,
      );
      const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
      const scrollTo = vi.fn();
      Object.defineProperty(timeline, "scrollTo", { configurable: true, value: scrollTo });
      setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 1000, scrollTop: 100 });
      await act(async () => {
        timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
      });

      await act(async () => {
        mountedRoot?.render(
          <ChatPage
            activeChannel={nextData.channels[0]}
            data={nextData}
            messages={messages}
            profile={defaultProfile}
          />,
        );
      });

      const button = host.querySelector<HTMLButtonElement>('[data-testid="slei-scroll-to-bottom"]');
      expect(button?.textContent).toContain("滚动到底部");

      await act(async () => {
        button?.click();
      });

      expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
      expect(host.querySelector('[data-testid="slei-scroll-to-bottom"]')).toBeNull();
    } finally {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
    }
  });

  it("shows the existing scroll-to-bottom button when the timeline is at least 200px from the bottom", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-1", author: "Lei", role: "human", time: "10:00", body: "第一条", channelId: "all" },
        { id: "msg-2", author: "Nova", role: "agent", time: "10:01", body: "第二条", channelId: "all" },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');

    setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 1000, scrollTop: 400 });
    await act(async () => {
      timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const button = host.querySelector<HTMLButtonElement>('[data-testid="slei-scroll-to-bottom"]');
    expect(button?.textContent).toContain("滚动到底部");
    expect(button?.querySelector('[data-slei-icon="arrowDown"]')).not.toBeNull();
    expect(button?.className).toContain("h-8");
    expect(button?.className).toContain("px-3.5");
    expect(button?.className).toContain("border-white/25");
    expect(button?.className).toContain("bg-white/85");
    expect(button?.className).toContain("backdrop-blur-xl");
    expect(button?.className).toContain("hover:bg-white/95");
    expect(button?.className).toContain("bottom-[var(--chat-composer-reserve)]");
    expect(button?.className).not.toContain("bottom-[calc(var(--chat-composer-reserve)+0.75rem)]");
    expect(button?.className).not.toContain("bottom-2.5");
    const buttonClasses = button?.className.split(/\s+/) ?? [];
    expect(buttonClasses).not.toContain("border-primary");
    expect(buttonClasses).not.toContain("text-primary");
    expect(button?.className).toContain("text-xs");

    setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 1000, scrollTop: 401 });
    await act(async () => {
      timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="slei-scroll-to-bottom"]')).toBeNull();
  });

  it("uses virtualized timeline rendering with an older-message load hook", () => {
    const source = readChatPageSource();

    expect(source).toContain("useVirtualizer");
    expect(source).toContain("timelineVirtualizer.measureElement");
    expect(source).toContain("onOlderMessagesLoad?.()");
  });

  it("requests older messages only from the near-top timeline scroll path", () => {
    const source = readChatPageSource();

    expect(source).toContain("HISTORY_LOAD_SCROLL_TOP_THRESHOLD_PX");
    expect(source).toContain("function requestOlderMessagesIfNearTop()");
    expect(source).toContain("viewport.scrollTop > HISTORY_LOAD_SCROLL_TOP_THRESHOLD_PX");
    expect(source).toContain("olderMessagesRequestInFlightRef.current");
    expect(source).toContain("requestOlderMessagesIfNearTop();");
    expect(source).not.toContain("timelineVirtualItems[0]?.index, timelineMessages.length, onOlderMessagesLoad");
  });

  it("defaults channel and conversation entries without stored scroll to the latest message", () => {
    const source = readChatPageSource();

    expect(source).toContain("initialTimelineScrollTargetRef");
    expect(source).toContain("const timelineScrollTarget =");
    expect(source).toContain("if (timelineUsesVirtualization && timelineMessages.length > 0)");
    expect(source).toContain("timelineVirtualizer.scrollToOffset(timelineVirtualizer.getTotalSize() + composerReservePx");
    expect(source).toContain("top: viewport.scrollHeight");
    expect(source).toContain("behavior: \"smooth\"");
    expect(source).toContain("pendingScrollToBottomRef.current = true");
    expect(source).toContain("[timelineScrollTarget, effectiveChannelView, focusedMessageId]");
  });

  it("scrolls a focused message into view and removes its blink border after the timer", async () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    HTMLElement.prototype.focus = focus;
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0, activeSessionId: "session-search" }],
      channelSessions: [{ id: "session-search", channelId: "all", title: "搜索会话", status: "ready", createdAt: "0", updatedAt: "0" }],
      messages: [
        {
          id: "msg-search-target",
          author: "Lei",
          role: "human",
          time: "10:24",
          body: "来自搜索结果的目标消息。",
          channelId: "all",
          sessionId: "session-search",
        },
      ],
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          activeSessionId="session-search"
          data={data}
          focusedMessageId="msg-search-target"
          messages={messages}
          profile={defaultProfile}
        />,
      );

      const target = host.querySelector<HTMLElement>('[data-message-id="msg-search-target"]');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(target?.dataset.focused).toBe("true");
      expect(target?.classList.contains("slei-message--blink-border")).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(2300);
      });

      expect(target?.dataset.focused).toBeUndefined();
      expect(target?.classList.contains("slei-message--blink-border")).toBe(false);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      HTMLElement.prototype.focus = originalFocus;
      vi.useRealTimers();
    }
  });

  it("keeps mention suggestions constrained to the composer width", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [memberWithLongMentionText()],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="@"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('data-testid="slei-mention-panel"');
    expect(html).toContain("w-full");
    expect(html).toContain("max-w-full");
    expect(html).toContain("min-w-0 flex-1");
    expect(html).toContain("block truncate");
    expect(html).toContain("max-w-[35%] truncate");
  });

  it("renders the channel header title, member count, and header member group without the old panel", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "dev", name: "#dev", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { dev: "ready" },
        },
        {
          ...memberWithLongMentionText(),
          id: "agent_nova",
          name: "Nova",
          handle: "@nova",
          channelReadiness: { dev: "memory_syncing" },
        },
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
          channelReadiness: { dev: "ready" },
        },
        {
          ...memberWithLongMentionText(),
          id: "agent_orion",
          name: "Orion",
          handle: "@orion",
          channelReadiness: { dev: "ready" },
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const host = staticMarkupHost(html);
    const header = host.querySelector('[data-testid="slei-channel-header"]');

    expect(header?.querySelector('[data-testid="slei-channel-title"]')?.textContent).toBe("#dev");
    expect(header?.querySelector('[data-testid="slei-channel-member-count"]')?.textContent).toBe("4 Agent");
    expect(header?.textContent).toContain(messages.chat.projectPrefix(messages.chat.noLinkedProjects));
    expect(header?.querySelector('[data-testid="slei-channel-member-group"]')).not.toBeNull();
    expect(header?.querySelectorAll('[data-testid="slei-channel-member-avatar-trigger"]')).toHaveLength(4);
    expect(header?.querySelector('[data-testid="slei-channel-member-add-trigger"]')).not.toBeNull();
    expect(html).not.toContain('data-testid="slei-channel-member-panel"');
    expect(html).not.toContain('data-testid="slei-channel-member-panel-shell"');
    expect(html).not.toContain('data-testid="slei-channel-members-header-toggle"');
  });

  it("renders channel view tabs inside header actions to the right of the member group", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const source = readChatPageSource();
    const host = staticMarkupHost(html);
    const headerHtml = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    const tabsIndex = html.indexOf('data-testid="slei-channel-view-tabs"');
    const headerActions = host.querySelector('[data-testid="slei-channel-header-actions"]');
    const headerActionsHtml = headerActions?.outerHTML ?? "";
    const memberGroupIndex = headerActionsHtml.indexOf('data-testid="slei-channel-member-group"');
    const headerActionTabsIndex = headerActionsHtml.indexOf('data-testid="slei-channel-view-tabs"');

    expect(html).not.toContain('data-testid="slei-channel-members-edge-toggle"');
    expect(html).not.toContain('data-testid="slei-channel-members-header-toggle"');
    expect(html).toContain('data-testid="slei-channel-view-tabs"');
    expect(tabsIndex).toBeGreaterThanOrEqual(0);
    expect(headerHtml).toContain('data-testid="slei-channel-view-tabs"');
    expect(headerActions?.className).toContain("items-center");
    expect(headerActions?.className).toContain("gap-3");
    expect(headerHtml).not.toContain(messages.chat.newSession);
    expect(headerHtml).not.toContain(messages.chat.history);
    expect(headerHtml).not.toContain('data-testid="slei-channel-header-action-separator"');
    expect(headerHtml).toContain('data-testid="slei-channel-member-group"');
    expect(headerHtml).toContain('data-testid="slei-channel-member-add-trigger"');
    expect(headerHtml).toContain('role="tablist"');
    expect(headerHtml).toContain('data-slot="tabs-list"');
    expect(headerHtml).toContain('data-variant="soft"');
    expect(memberGroupIndex).toBeGreaterThanOrEqual(0);
    expect(headerActionTabsIndex).toBeGreaterThan(memberGroupIndex);
    expect(source).not.toContain('className="border-b bg-transparent px-4 py-2"');
    expect(source).not.toContain('aria-pressed={channelMembersOpen ? "true" : "false"}');
  });

  it("renders embedded chat tasks and files tabs with the soft variant", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const tabsStart = html.indexOf('data-testid="slei-channel-view-tabs"');
    const tabsHtml = html.slice(tabsStart, html.indexOf("</div>", tabsStart));

    expect(tabsStart).toBeGreaterThanOrEqual(0);
    expect(tabsHtml).toContain('data-variant="soft"');
    expect(tabsHtml).toContain(messages.shell.nav.chat);
    expect(tabsHtml).toContain(messages.chat.tasks);
    expect(tabsHtml).toContain(messages.chat.files);
  });

  it("does not render the channel member group in DM headers", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
      members: [member],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const headerHtml = html.slice(html.indexOf("<header"), html.indexOf("</header>"));

    expect(headerHtml).not.toContain('data-testid="slei-channel-member-group"');
    expect(headerHtml).not.toContain('data-testid="slei-channel-member-count"');
    expect(headerHtml).not.toContain('data-testid="slei-channel-member-add-trigger"');
    expect(headerHtml).not.toContain('data-testid="slei-channel-view-tabs"');
  });

  it("keeps the main chat layout one column without an offscreen member panel", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).not.toContain('data-testid="slei-channel-member-panel"');
    expect(html).not.toContain('data-testid="slei-channel-member-panel-shell"');
    expect(html).toContain('data-testid="slei-channel-main-region"');
    expect(html).toContain('data-testid="slei-channel-workspace"');
    expect(html).toContain('data-testid="slei-channel-chat-column"');
    expect(html).toContain("grid-cols-1");
    expect(html).not.toContain("grid-cols-[minmax(0,1fr)_20rem]");
    expect(html).not.toContain("grid-cols-[minmax(0,1fr)_0rem]");
    expect(html).not.toContain("transition-[grid-template-columns]");
    expect(html).not.toContain("transition-[opacity,transform]");
    expect(html).not.toContain("translate-x-0 opacity-100");
    expect(html).toContain("relative h-full min-h-0 overflow-visible");
    expect(html).toContain('data-testid="slei-chat-timeline"');
    expect(html).toContain("h-full min-h-0 overflow-y-auto");
    expect(html).toContain("--chat-composer-reserve:144px");
    expect(html).not.toContain("pointer-events-none translate-x-full");
  });

  it("keeps the header member group while task or file tabs are active without mounting the old panel", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    for (const initialChannelView of ["tasks", "files"] as const) {
      const html = renderToStaticMarkup(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialChannelView={initialChannelView}
          messages={messages}
          profile={defaultProfile}
        />,
      );

      expect(html).not.toContain('data-testid="slei-channel-member-panel"');
      expect(html).not.toContain('data-testid="slei-channel-member-panel-shell"');
      expect(html).toContain('data-testid="slei-channel-member-group"');
      expect(html).toContain("grid-cols-1");
      expect(html).not.toContain("grid-cols-[minmax(0,1fr)_20rem]");
      expect(html).not.toContain('data-testid="slei-channel-members-header-toggle"');
    }
  });

  it("adds multiple selected channel members from a modal", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onChannelMemberAdd = vi.fn().mockResolvedValue(undefined);
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        memberWithLongMentionText(),
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onChannelMemberAdd={onChannelMemberAdd}
        profile={defaultProfile}
      />,
    );

    const addButton = host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-add-trigger"]');
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector('[data-testid="slei-channel-member-add-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");

    const candidateButtons = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="slei-channel-member-add-candidate"]')];
    expect(candidateButtons).toHaveLength(2);
    await act(async () => {
      candidateButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      candidateButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const checkedBoxes = [...document.body.querySelectorAll('[data-testid="slei-channel-member-add-candidate-checkbox"]')]
      .filter((checkbox) => checkbox.getAttribute("data-state") === "checked");
    expect(checkedBoxes).toHaveLength(2);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-add-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChannelMemberAdd).toHaveBeenCalledTimes(2);
    expect(onChannelMemberAdd).toHaveBeenNthCalledWith(1, "agent_architect");
    expect(onChannelMemberAdd).toHaveBeenNthCalledWith(2, "agent_luna");
    expect(document.body.querySelector('[data-testid="slei-channel-member-add-dialog"]')).toBeNull();
  });

  it("toggles an add-member checkbox only once from keyboard activation", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        memberWithLongMentionText(),
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-add-trigger"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const checkbox = document.body.querySelector<HTMLElement>('[data-testid="slei-channel-member-add-candidate-checkbox"]');
    expect(checkbox?.getAttribute("data-state")).toBe("unchecked");

    await act(async () => {
      checkbox?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: " " }));
    });

    expect(checkbox?.getAttribute("data-state")).toBe("checked");

    await act(async () => {
      checkbox?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    });

    expect(checkbox?.getAttribute("data-state")).toBe("unchecked");
  });

  it("keeps selected add-member candidates and the dialog open when add fails", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onChannelMemberAdd = vi.fn().mockRejectedValue(new Error("daemon add failed"));
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        memberWithLongMentionText(),
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onChannelMemberAdd={onChannelMemberAdd}
        profile={defaultProfile}
      />,
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-add-trigger"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const candidate = document.body.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-add-candidate"]');
    await act(async () => {
      candidate?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-add-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChannelMemberAdd).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[data-testid="slei-channel-member-add-dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="slei-channel-member-add-candidate-checkbox"]')?.getAttribute("data-state")).toBe("checked");
  });

  it("caps visible header member avatars and renders an overflow count", () => {
    const messages = createDesktopMessages("zh-CN");
    const members: SleiMember[] = Array.from({ length: 8 }, (_, index) => ({
      ...memberWithLongMentionText(),
      id: `agent_${index}`,
      name: `Agent ${index}`,
      handle: `@agent-${index}`,
      channelReadiness: { all: "ready" as const },
    }));
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members,
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const host = staticMarkupHost(html);

    expect(host.querySelectorAll('[data-testid="slei-channel-member-avatar-trigger"]')).toHaveLength(5);
    expect(host.querySelector('[data-testid="slei-channel-member-overflow-count"]')?.textContent).toBe("+3");
    expect(host.querySelector('[data-testid="slei-channel-member-add-trigger"]')).not.toBeNull();
  });

  it("opens a channel member info card from the header member avatar", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
          role: "产品研究 Agent",
          description: "负责产品研究。",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-avatar-trigger"]')?.click();
    });

    const card = document.body.querySelector('[data-testid="slei-channel-member-info-card"]');
    const removeButton = document.body.querySelector<HTMLButtonElement>(`[aria-label="${messages.chat.removeChannelMember("Luna")}"]`);
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Luna");
    expect(card?.textContent).toContain("@luna");
    expect(card?.textContent).toContain("产品研究 Agent");
    expect(card?.textContent).toContain(messages.chat.memberReady);
    expect(card?.textContent).not.toContain("ready");
    expect(card?.className).toContain("rounded-md");
    expect(card?.className).toContain("border");
    expect(card?.className).toContain("bg-popover");
    expect(card?.className).toContain("shadow-md");
    expect(card?.className).not.toContain("shadow-[0_0_4px");
    expect(removeButton?.textContent?.trim()).toBe("移除");
    expect(card?.textContent).not.toContain(messages.chat.removeChannelMember("Luna"));
    expect(removeButton?.className).toContain("bg-destructive");
    expect(removeButton?.className).toContain("text-white");
    expect(removeButton?.className).toContain("hover:bg-destructive/90");
    expect(removeButton?.className).not.toContain("variant=\"ghost\"");
    expect(removeButton?.className).not.toContain("text-[14px]");
    expect(removeButton?.className).not.toContain("hover:bg-destructive/10");
  });

  it("does not open the member popover from hover-only pointer movement", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const avatar = host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-avatar-trigger"]');
    await act(async () => {
      avatar?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
      avatar?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-info-card"]')).toBeNull();
  });

  it("closes the member popover with Escape after opening from click", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const avatar = host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-avatar-trigger"]');
    await act(async () => {
      avatar?.click();
    });

    const card = document.body.querySelector<HTMLElement>('[data-testid="slei-channel-member-info-card"]');
    expect(card).not.toBeNull();

    await act(async () => {
      card?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-info-card"]')).toBeNull();
  });

  it("closes the member popover when clicking outside after opening from click", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const avatar = host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-avatar-trigger"]');
    await act(async () => {
      avatar?.click();
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-info-card"]')).not.toBeNull();

    await act(async () => {
      host.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-info-card"]')).toBeNull();
  });

  it("keeps the member popover open while focus moves from avatar to remove button", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const avatar = host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-avatar-trigger"]');
    await act(async () => {
      avatar?.click();
    });

    const removeButton = document.body.querySelector<HTMLButtonElement>(`[aria-label="${messages.chat.removeChannelMember("Luna")}"]`);
    expect(removeButton).not.toBeNull();

    await act(async () => {
      removeButton?.focus();
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-info-card"]')).not.toBeNull();

    await act(async () => {
      removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-remove-dialog"]')).not.toBeNull();
  });

  it("removes a channel member only after confirming in a dialog", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onChannelMemberRemove = vi.fn().mockResolvedValue(undefined);
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onChannelMemberRemove={onChannelMemberRemove}
        profile={defaultProfile}
      />,
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-avatar-trigger"]')?.click();
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-info-card"]')).not.toBeNull();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`[aria-label="${messages.chat.removeChannelMember("Luna")}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector('[data-testid="slei-channel-member-remove-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    expect(dialog?.textContent).toContain(messages.chat.removeChannelMember("Luna"));
    expect(dialog?.textContent).toContain(messages.chat.removeChannelMemberConfirm("Luna"));
    expect(onChannelMemberRemove).not.toHaveBeenCalled();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-remove-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChannelMemberRemove).toHaveBeenCalledTimes(1);
    expect(onChannelMemberRemove).toHaveBeenCalledWith("agent_luna");
  });

  it("keeps the remove confirmation open when remove fails", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onChannelMemberRemove = vi.fn().mockRejectedValue(new Error("daemon remove failed"));
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onChannelMemberRemove={onChannelMemberRemove}
        profile={defaultProfile}
      />,
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-avatar-trigger"]')?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`[aria-label="${messages.chat.removeChannelMember("Luna")}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-remove-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChannelMemberRemove).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[data-testid="slei-channel-member-remove-dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="slei-channel-member-info-card"]')).not.toBeNull();
  });

  it("renders channel tabs without new-session or history controls", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0, activeSessionId: "session:channel:all:default" }],
      channelSessions: [{ id: "session:channel:all:default", channelId: "all", title: "新会话", status: "ready", createdAt: "0", updatedAt: "0" }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.shell.nav.chat);
    expect(html).toContain(messages.chat.tasks);
    expect(html).toContain(messages.chat.files);
    expect(html).not.toContain(messages.chat.newSession);
    expect(html).not.toContain(messages.chat.history);
    expect(readChatPageSource()).not.toContain("onChannelNewSession?.(activeChannel.id)");
  });

  it("shows all channel messages without a session history drawer", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0, activeSessionId: "session-new" }],
      channelSessions: [
        { id: "session-old", channelId: "all", title: "旧会话", status: "ready", createdAt: "1", updatedAt: "1" },
        { id: "session-new", channelId: "all", title: "新会话", status: "ready", createdAt: "2", updatedAt: "2" },
      ],
      messages: [
        { id: "msg-old", author: "Lei", role: "human", time: "10:00", body: "旧消息", channelId: "all", sessionId: "session-old" },
        { id: "msg-new", author: "Lei", role: "human", time: "10:01", body: "新消息", channelId: "all", sessionId: "session-new" },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
        sessionDrawerOpen
      />,
    );

    expect(html).toContain("新消息");
    expect(html).toContain("旧消息");
    expect(html).not.toContain("旧会话");
    expect(readChatPageSource()).not.toContain("onChannelSessionSelect?.(activeChannel.id, session.id)");
  });

  it("allows direct messages to be sent as tasks", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      conversations: [{ id: "dm:agent_architect", agentId: member.id, kind: "dm", activeSessionId: "session-dm", createdAt: "0", updatedAt: "0" }],
      members: [member],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const host = staticMarkupHost(html);
    const asTaskSwitch = host.querySelector<HTMLElement>('[data-testid="slei-as-task-switch"]');

    expect(html).toContain(messages.chat.asTask);
    expect(host.querySelector('[data-slot="checkbox"]')).toBeNull();
    expect(asTaskSwitch?.getAttribute("data-slot")).toBe("switch");
    expect(asTaskSwitch?.className).toContain("h-5");
    expect(asTaskSwitch?.className).toContain("w-9");
    expect(asTaskSwitch?.className).toContain("[&_[data-slot=switch-thumb]]:size-4");
    expect(asTaskSwitch?.className).toContain("[&_[data-slot=switch-thumb][data-state=checked]]:translate-x-4");
    expect(asTaskSwitch?.className).toContain("data-[state=checked]:bg-primary");
    expect(asTaskSwitch?.className).not.toContain("bg-white/10");
    expect(asTaskSwitch?.className).not.toContain("border-white/20");
  });

  it("keeps timeline message selectors and actions available on transparent message rows", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-contract",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "10:00",
          body: "保留消息行动作。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onMessageThreadOpen={() => undefined}
        profile={defaultProfile}
      />,
    );
    const host = staticMarkupHost(html);
    const messageRow = host.querySelector<HTMLElement>('[data-message-id="msg-contract"]');

    expect(messageRow).not.toBeNull();
    expect(messageRow?.dataset.slot).toBe("message-row");
    expect(host.querySelector('[data-slot="card"][data-message-id="msg-contract"]')).toBeNull();
    expect(messageRow?.className).toContain("border-transparent");
    expect(messageRow?.className).toContain("bg-transparent");
    expect(messageRow?.className).toContain("hover:bg-muted/45");
    expect(messageRow?.className).toContain("duration-[2s]");
    expect(messageRow?.className).not.toContain("bg-white/10");
    expect(messageRow?.className).not.toContain("backdrop-blur-xl");
    expect(messageRow?.className).not.toContain("bg-card");
    expect(messageRow?.className).not.toContain("bg-primary/5");
    expect(messageRow?.className).not.toContain("hover:border-border");
    expect(messageRow?.className).not.toContain("hover:shadow");
    expect(messageRow?.querySelector('[data-slot="message-actions"]')).not.toBeNull();
    expect(messageRow?.querySelector('[data-message-thread-open="msg-contract"]')).not.toBeNull();
    expect(messageRow?.querySelector(`button[aria-label="${messages.chat.copyMessage}"]`)).not.toBeNull();
    expect(messageRow?.querySelector(`button[aria-label="${messages.chat.saveMessage}"]`)).not.toBeNull();
  });

  it("adds a border only to the focused timeline message", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-focused",
          author: "Lei",
          role: "human",
          time: "10:00",
          body: "搜索定位到这一条。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        focusedMessageId="msg-focused"
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const messageAttrIndex = html.indexOf('data-message-id="msg-focused"');
    const messageHtml = html.slice(html.lastIndexOf("<", messageAttrIndex));
    const messageOpenTag = messageHtml.slice(0, messageHtml.indexOf(">"));

    expect(messageOpenTag).toContain("data-[focused=true]:border-primary/35");
    expect(messageOpenTag).not.toContain("data-[focused=true]:bg-primary/5");
    expect(messageOpenTag).not.toContain("data-[focused=true]:ring-1");
  });

  it("renders create agent and channel cards as flat surfaces", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-cards",
          author: "Yeal",
          role: "agent",
          time: "10:00",
          body: "已准备创建卡片。",
          channelId: "all",
          cards: [
            {
              id: "card_agent",
              kind: "createAgent",
              state: "pending",
              title: "创建 Coda",
              summary: "Coda · ClaudeCode / Sonnet",
              draft: { name: "Coda" },
              actionLabel: "创建",
              doneLabel: "DONE",
            },
            {
              id: "card_channel",
              kind: "createChannel",
              state: "pending",
              title: "创建 #qa",
              summary: "#qa",
              draft: { name: "qa", description: "QA 协作频道", projectPaths: [], agentIds: [] },
              actionLabel: "创建",
              doneLabel: "DONE",
            },
          ],
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const host = staticMarkupHost(html);

    for (const kind of ["createAgent", "createChannel"]) {
      const cardHtml = html.slice(html.indexOf(`data-card-kind="${kind}"`));
      const cardOpenTag = cardHtml.slice(0, cardHtml.indexOf(">"));
      const actionButtonClasses = host.querySelector<HTMLElement>(`[data-card-kind="${kind}"] [data-slot="button"]`)?.className.split(/\s+/) ?? [];

      expect(cardHtml).toContain(`data-card-kind="${kind}"`);
      expect(cardHtml).toContain('data-slot="card"');
      expect(actionButtonClasses).toContain("h-7");
      expect(actionButtonClasses).toContain("px-2.5");
      expect(actionButtonClasses).toContain("text-xs");
      expect(actionButtonClasses).toContain("gap-1");
      expect(actionButtonClasses).not.toContain("h-8");
      expect(cardOpenTag).not.toContain("shadow-[");
      expect(cardOpenTag).not.toContain("hover:shadow");
    }
  });

  it("keeps task root entry status and source message behavior on flat rows", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-task-source",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "10:00",
          body: "把这条变成任务。",
          channelId: "all",
        },
      ],
      tasks: [
        {
          id: "task-msg-task-source",
          title: "把这条变成任务。",
          owner: "Lei",
          status: "in_progress",
          channelId: "all",
          sourceMessageId: "msg-task-source",
          replies: [{ id: "root-msg-task-source", sender: "Lei", body: "把这条变成任务。" }],
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onTaskThreadOpen={() => undefined}
        profile={defaultProfile}
      />,
    );
    const host = staticMarkupHost(html);
    const taskRootCard = host.querySelector<HTMLElement>('[data-task-root-entry="task-msg-task-source"]');
    const replyIcon = taskRootCard?.querySelector<SVGElement>('[data-task-root-entry-replies] [data-slei-icon="messageSquare"]');
    const copyIcon = taskRootCard?.querySelector<SVGElement>('[data-slei-icon="copy"]');
    const bookmarkIcon = taskRootCard?.querySelector<SVGElement>('[data-slei-icon="bookmarkOutline"]');

    expect(taskRootCard).not.toBeNull();
    expect(taskRootCard?.dataset.sourceMessageId).toBe("msg-task-source");
    expect(taskRootCard?.dataset.slot).toBe("card");
    expect(taskRootCard?.className).toContain("bg-transparent");
    expect(taskRootCard?.className).toContain("hover:bg-muted/45");
    expect(taskRootCard?.className).toContain("duration-[2s]");
    expect(taskRootCard?.className).toContain("shadow-none");
    expect(taskRootCard?.className).toContain("after:hidden");
    expect(taskRootCard?.className).not.toContain("hover:border-border");
    expect(taskRootCard?.className).not.toContain("hover:shadow");
    expect(taskRootCard?.querySelector("[data-task-root-entry-status]")?.textContent).toContain(messages.tasks.status.in_progress);
    expect(taskRootCard?.querySelector("[data-task-root-entry-replies]")).not.toBeNull();
    expect(replyIcon?.className.baseVal).toContain("size-2.5");
    expect(copyIcon?.className.baseVal).toContain("size-2.5");
    expect(bookmarkIcon?.className.baseVal).toContain("size-2.5");
    expect(taskRootCard?.querySelector(".t-icon-swap")?.className).toContain("size-2.5");
    expect(Array.from(taskRootCard?.querySelectorAll("button") ?? []).every((button) => button.className.includes("[&_svg]:size-2.5"))).toBe(true);
    expect(taskRootCard?.textContent).toContain("把这条变成任务。");
  });

  it("keeps only the composer input recessed while the outer surface stays flat", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="保持提交行为"
        messages={messages}
        onSendMessage={onSendMessage}
        profile={defaultProfile}
      />,
    );

    const surface = host.querySelector<HTMLElement>('[data-testid="slei-composer-surface"]');
    const textarea = host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]');
    const toolbar = host.querySelector<HTMLElement>('[data-testid="slei-composer-toolbar"]');
    const switchControl = host.querySelector<HTMLElement>('[data-testid="slei-as-task-switch"]');

    expect(surface).not.toBeNull();
    expect(surface?.contains(textarea!)).toBe(true);
    expect(surface?.contains(toolbar!)).toBe(true);
    expect(host.querySelector('[data-slot="checkbox"]')).toBeNull();
    expect(switchControl?.getAttribute("data-slot")).toBe("switch");
    expect(textarea?.className).toContain("max-h-[500px]");
    expect(textarea?.className).toContain("min-h-12");
    expect(textarea?.className).not.toContain("min-h-20");
    expect(textarea?.className).toContain("resize-none");
    expect(textarea?.getAttribute("placeholder")).toBe("输入消息到 #all，输入 / 打开功能菜单");
    expect(surface?.getAttribute("data-slot")).toBe("card");
    expect(surface?.className).toContain("overflow-visible");
    expect(surface?.className).not.toContain("overflow-hidden");
    expect(surface?.className).toContain("p-0");
    expect(surface?.className).not.toContain("p-1");
    expect(surface?.className).not.toContain("p-3");
    expect(surface?.className).toContain("border-transparent");
    expect(surface?.className).not.toContain("border-border");
    expect(surface?.className).not.toContain("slei-shadow-inset");
    expect(host.querySelector('[data-testid="slei-composer-shell"]')?.className).toContain("overflow-visible");
    expect(host.querySelector('[data-testid="slei-composer-shell"]')?.className).not.toContain("overflow-hidden");
    expect(host.querySelector('[data-testid="slei-composer-shell"] > .slei-composer-glass')?.className).toContain("overflow-visible");
    expect(host.querySelector('[data-testid="slei-composer-shell"] > .slei-composer-glass')?.className).not.toContain("overflow-hidden");
    expect(host.querySelector('[data-testid="slei-composer-shell"] form')?.className).toContain("overflow-visible");
    expect(host.querySelector('[data-testid="slei-composer-shell"] form')?.className).not.toContain("overflow-hidden");
    const composerFooterDivs = [
      host.querySelector<HTMLElement>('[data-testid="slei-composer-shell"]'),
      ...Array.from(host.querySelectorAll<HTMLElement>('[data-testid="slei-composer-shell"] div')),
    ].filter((element): element is HTMLElement => Boolean(element));
    expect(composerFooterDivs.length).toBeGreaterThanOrEqual(5);
    for (const element of composerFooterDivs) {
      expect(element.className).toContain("overflow-visible");
      expect(element.className).not.toContain("overflow-hidden");
    }
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(textarea?.className).toContain("slei-composer-input");
    expect(textarea?.parentElement?.className).toContain("overflow-visible");
    expect(textarea?.parentElement?.className).not.toContain("overflow-hidden");
    expect(textarea?.parentElement?.parentElement?.className).toContain("overflow-visible");
    expect(textarea?.parentElement?.parentElement?.parentElement?.className).toContain("overflow-visible");
    expect(textarea?.parentElement?.parentElement?.parentElement?.parentElement?.className).toContain("overflow-visible");
    expect(textarea?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.className).toContain("overflow-visible");
    expect(textarea?.className).toContain("border-0");
    expect(textarea?.className).toContain("px-0");
    expect(textarea?.className).toContain("py-0");
    expect(textarea?.className).not.toContain("px-3");
    expect(textarea?.className).not.toContain("py-3");
    expect(textarea?.className).not.toContain("border-border/60");
    expect(appCss).toContain(".slei-composer-input {");
    expect(appCss).not.toContain("--composer-input-bg");
    expect(appCss).not.toContain("background: var(--composer-input-bg);");
    expect(appCss).toContain(".slei-composer-glass {");
    expect(appCss).toContain("overflow: visible;");
    expect(appCss).toContain("--composer-glass-border: rgba(0, 0, 0, 0.10);");
    expect(appCss).toContain("border-color: var(--composer-glass-border);");
    expect(appCss).toContain("0 0 8px var(--composer-glass-shadow),");
    expect(appCss).toContain("--composer-glass-shadow: rgb(15 23 42 / 0.10);");
    expect(appCss).not.toContain("0 2px 4px var(--composer-glass-shadow),");
    expect(appCss).toContain("-webkit-backdrop-filter: blur(20px);");
    expect(appCss).toContain("backdrop-filter: blur(20px);");
    expect(appCss).not.toContain("saturate(180%)");
    expect(appCss).not.toContain("contrast(1.05)");
    const darkComposerCss = appCss.slice(appCss.indexOf(".dark {"), appCss.indexOf(".light {"));
    const lightComposerCss = appCss.slice(appCss.indexOf(".light {"), appCss.indexOf("@layer utilities"));
    expect(appCss).toContain("--composer-glass-bg: rgba(255, 255, 255, 0.60);");
    expect(appCss).not.toContain("--composer-glass-veil-bg");
    expect(darkComposerCss).toContain("--composer-glass-bg: var(--workspace-glass-bg);");
    expect(darkComposerCss).not.toContain("--composer-glass-bg: rgba(255, 255, 255, 0.60);");
    expect(lightComposerCss).toContain("--composer-glass-bg: rgba(255, 255, 255, 0.60);");
    expect(appCss).not.toContain("--composer-glass-bg: rgba(28, 35, 50, 0.7);");
    expect(appCss).not.toContain("--composer-glass-bg: color-mix(in srgb, var(--workspace-glass-bg) 90%, white 10%);");
    expect(appCss).not.toContain(".slei-composer-glass::before {");
    expect(appCss).not.toContain("backdrop-filter: blur(28px) saturate(185%) contrast(1.05);");
    expect(appCss).not.toContain("backdrop-filter: blur(56px)");
    expect(appCss).toContain("background: var(--composer-glass-bg);");
    expect(appCss).toContain(".slei-composer-glass > * {");
    const composerGlassCss = appCss.slice(appCss.indexOf(".slei-composer-glass {"), appCss.indexOf(".slei-composer-input {"));
    expect(composerGlassCss).not.toContain("color-mix");
    expect(composerGlassCss).not.toContain("isolation");
    expect(composerGlassCss).not.toContain("overflow: hidden;");
    expect(appCss).toContain(".slei-composer-input:focus-visible {");
    expect(appCss).not.toContain("0 0 0 1px color-mix(in srgb, var(--ring) 72%, transparent)");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-send-button"]')?.click();
    });

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith("保持提交行为", {
      asTask: false,
      attachmentIds: [],
      sessionId: undefined,
    });
    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')?.value).toBe("");
  });

  it("renders a message-thread action for normal timeline messages", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-open-thread", author: "Lei", role: "human", time: "10:00", body: "可以独立开子线程的消息", channelId: "all" },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onMessageThreadOpen={() => undefined}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('data-message-thread-open="msg-open-thread"');
    expect(html).toContain(messages.tasks.commentThread);
  });

  it("opens a message thread drawer without creating a thread until reply submit", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-deferred-thread", author: "Lei", role: "human", time: "10:00", body: "## 先看看\n\n- 不要立刻创建子线程\n- `inlineCode`", channelId: "all" },
      ],
    });
    const onMessageThreadOpen = vi.fn();
    const onMessageThreadReplyFromSource = vi.fn();

    const container = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onMessageThreadOpen={onMessageThreadOpen}
        onMessageThreadReplyFromSource={onMessageThreadReplyFromSource}
        profile={defaultProfile}
      />,
    );

    const openButton = container.querySelector<HTMLButtonElement>('[data-message-thread-open="msg-deferred-thread"]');
    expect(openButton).toBeTruthy();
    await act(async () => {
      openButton?.click();
    });

    expect(onMessageThreadOpen).not.toHaveBeenCalled();
    const drawer = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"][aria-label="任务讨论"]');
    const rootMarkdown = drawer?.querySelector<HTMLElement>('[data-slot="task-thread-root-body"] .slei-markdown-message');
    expect(rootMarkdown).toBeTruthy();
    expect(rootMarkdown?.classList.contains("text-sm")).toBe(true);
    expect(rootMarkdown?.classList.contains("leading-relaxed")).toBe(true);
    expect(rootMarkdown?.querySelector("h2")?.textContent).toBe("先看看");
    expect(rootMarkdown?.querySelector("li")?.textContent).toContain("不要立刻创建子线程");
    expect(rootMarkdown?.querySelector("code")?.textContent).toBe("inlineCode");

    const replyInput = document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${messages.tasks.replyPlaceholder}"]`);
    expect(replyInput).toBeTruthy();
    await act(async () => {
      if (!replyInput) return;
      const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(replyInput), "value")?.set;
      if (valueSetter) {
        valueSetter.call(replyInput, "现在发送回复");
      } else {
        replyInput.value = "现在发送回复";
      }
      replyInput.dispatchEvent(new Event("input", { bubbles: true }));
      replyInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const sendButton = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${messages.tasks.sendReply}"]`);
    expect(sendButton).toBeTruthy();
    await act(async () => {
      replyInput?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    });

    expect(onMessageThreadReplyFromSource).toHaveBeenCalledWith(data.messages[0], "现在发送回复");
  });

  it("adds breathing room above normal timeline message cards", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-spaced",
          author: "Yeal",
          handle: "@yeal",
          role: "agent",
          time: "14:20",
          sentAt: "2026-06-11 14:20:53",
          body: "已准备好，可以帮助你创建成员、频道并了解 Slei 的使用方式。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const frameStart = html.indexOf('data-slot="timeline-message-frame"');
    const articleStart = html.indexOf('data-message-id="msg-spaced"', frameStart);
    const frameOpenStart = html.lastIndexOf("<div", frameStart);
    const frameHtml = html.slice(frameOpenStart, articleStart);

    expect(frameStart).toBeGreaterThanOrEqual(0);
    expect(frameOpenStart).toBeGreaterThanOrEqual(0);
    expect(articleStart).toBeGreaterThan(frameStart);
    expect(frameHtml).toContain("pt-3");
  });

  it("renders channel message markdown with card foreground text for dark theme contrast", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-dark-contrast",
          author: "Yeal",
          role: "agent",
          time: "14:20",
          body: "暗色模式下正文必须可读。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const host = staticMarkupHost(html);
    const messageElement = host.querySelector<HTMLElement>('[data-message-id="msg-dark-contrast"]');
    const markdownElement = messageElement?.querySelector<HTMLElement>(".slei-markdown-message");
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(messageElement).not.toBeNull();
    expect(markdownElement).not.toBeNull();
    expect(markdownElement?.classList.contains("text-card-foreground")).toBe(true);
    expect(markdownElement?.getAttribute("style")).toContain("--markdown-foreground:var(--card-foreground)");
    expect(markdownElement?.classList.contains("text-foreground")).toBe(false);
    expect(appCss).toContain("color: var(--markdown-foreground, var(--text-primary));");
    expect(appCss).not.toContain(".slei-markdown-message {\n  color: var(--text-primary);");
  });

  it("keeps task root entries visually aligned with normal transparent message rows", () => {
    const source = readFileSync(join(process.cwd(), "src/features/chat/TaskRootEntry.tsx"), "utf8");

    expect(source).toContain("bg-transparent");
    expect(source).toContain("hover:bg-muted/45");
    expect(source).toContain("duration-[2s]");
    expect(source).not.toContain("hover:border-border");
    expect(source).toContain("CARD_FLAT_CLASS");
    expect(source).toContain("<Card");
    expect(source).not.toContain("border border-primary");
  });
});

function readChatPageSource() {
  return readFileSync(join(process.cwd(), "src/features/chat/ChatPageView.tsx"), "utf8");
}

function setScrollMetrics(element: HTMLElement | null, metrics: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
  if (!element) return;
  Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(element, "scrollTop", { configurable: true, value: metrics.scrollTop, writable: true });
}
