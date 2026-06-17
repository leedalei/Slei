import { describe, expect, it } from "vitest";

import { createChannelArchiveNoticeMessage, sendChatComposerMessage, submitComposerDraft, submitComposerDraftWithFeedback } from "../src/app/SleiApp";
import { createChannelAgentActivityMessage, createChannelAgentActivityMessages, waitForChannelAgentReply } from "../src/test/channel-agent-reply-utils";
import { createDesktopMessages } from "../src/i18n";
import { defaultProfile } from "../src/app/model";

describe("chat composer submit behavior", () => {
  it("clears draft state only after send succeeds", async () => {
    const sent: Array<{ body: string; sessionId?: string }> = [];

    const result = await submitComposerDraft({
      draft: "  hello  ",
      asTask: true,
      attachments: [],
      sessionId: "session-current",
      onSendMessage: async (body, options) => {
        sent.push({ body, sessionId: options?.sessionId });
      },
    });

    expect(sent).toEqual([{ body: "  hello  ", sessionId: "session-current" }]);
    expect(result).toEqual({ sent: true, draft: "", attachments: [], asTask: false });
  });

  it("propagates send failures so callers keep the existing draft", async () => {
    await expect(
      submitComposerDraft({
        draft: "keep me",
        asTask: false,
        attachments: [],
        sessionId: "session-current",
        onSendMessage: async () => {
          throw new Error("send failed");
        },
      }),
    ).rejects.toThrow("send failed");
  });

  it("keeps the draft and surfaces toast feedback when the UI submit path fails", async () => {
    const toasts: string[] = [];

    const result = await submitComposerDraftWithFeedback({
      draft: "keep me",
      asTask: true,
      attachments: [],
      sessionId: "session-current",
      sendFailedMessage: "发送失败",
      onSendFailure: (message) => toasts.push(message),
      onSendMessage: async () => {
        throw new Error("send failed");
      },
    });

    expect(result).toEqual({ sent: false, draft: "keep me", attachments: [], asTask: true });
    expect(toasts).toEqual(["发送失败：send failed"]);
  });

  it("surfaces string send failures from the desktop bridge", async () => {
    const toasts: string[] = [];

    await submitComposerDraftWithFeedback({
      draft: "keep me",
      asTask: false,
      attachments: [],
      sendFailedMessage: "发送失败",
      onSendFailure: (message) => toasts.push(message),
      onSendMessage: async () => {
        throw "daemon request failed: 404 Not Found: channel not found";
      },
    });

    expect(toasts).toEqual(["发送失败：daemon request failed: 404 Not Found: channel not found"]);
  });

  it("routes channel sends through the channel bridge and direct messages through conversations", async () => {
    const calls: string[] = [];
    const bridge = {
      sendChannelMessage: async (channelId: string, request: { authorId: string; body: string }) => {
        calls.push(`channel:${channelId}:${request.authorId}:${request.body}`);
        return { outcome: { messageId: "msg_channel_dev_1", action: "archive_only" } };
      },
      sendConversationMessage: async (conversationId: string, request: { authorId: string; body: string; sessionId?: string }) => {
        calls.push(`conversation:${conversationId}:${request.authorId}:${request.sessionId}:${request.body}`);
        return {
          message: {
            id: "msg_dm_1",
            conversationId,
            sessionId: request.sessionId,
            authorId: request.authorId,
            body: request.body,
            createdAt: "2026-06-03T00:00:00.000Z",
          },
        };
      },
    };

    await sendChatComposerMessage({
      bridge,
      activeChannelId: "dev",
      body: " ship channel ",
      profile: { ...defaultProfile, handle: "@lei" },
    });
    await sendChatComposerMessage({
      bridge,
      activeChannelId: "all",
      activeConversationId: "dm:agent_coda",
      activeSessionId: "session-current",
      body: " ship dm ",
      profile: { ...defaultProfile, handle: "@lei" },
    });

    expect(calls).toEqual([
      "channel:dev:human:lei:ship channel",
      "conversation:dm:agent_coda:human:local:session-current:ship dm",
    ]);
  });

  it("does not show a daemon-disconnected notice for daemon archive decisions", () => {
    const notice = createChannelArchiveNoticeMessage(
      { messageId: "msg_channel_all_1", action: "archive_only" },
      "all",
      createDesktopMessages("zh-CN"),
    );

    expect(notice).toBeNull();
  });

  it("builds a visible notice when channel send is only archived locally", () => {
    const notice = createChannelArchiveNoticeMessage(
      { messageId: "msg_channel_all_1", action: "local_archive_only" },
      "all",
      createDesktopMessages("zh-CN"),
    );

    expect(notice).toMatchObject({
      id: "archive-notice-msg_channel_all_1",
      author: "系统",
      role: "system",
      body: "daemon 未连接，消息已本地保存；当前不会触发智能体回复。",
      channelId: "all",
      status: "done",
    });
  });

  it("builds pending agent activity when the daemon requests a channel reply", () => {
    const activity = createChannelAgentActivityMessage(
      { messageId: "msg_channel_all_2", action: "request_agent_reply", assigneeAgentId: "agent_alice", assigneeAgentIds: ["agent_alice"] },
      "all",
      [
        {
          id: "agent_alice",
          name: "Alice",
          handle: "@alice",
          avatar: "AL",
          type: "agent",
          runtimeStatus: "idle",
          role: "频道协调员",
          description: "Routes all messages.",
          computer: "本机设备",
          created: "2026-06-04",
          creator: "system",
          runtime: "ClaudeCode",
          model: "Sonnet",
          instructions: "",
          permissions: [],
          environmentVariables: [],
          createdAgents: [],
          activity: "",
          capabilities: [],
        },
      ],
    );

    expect(activity).toMatchObject({
      id: "agent-activity-msg_channel_all_2-agent_alice",
      author: "Alice",
      handle: "@alice",
      role: "agent",
      channelId: "all",
      status: "pending",
    });
  });

  it("builds one pending activity per routed channel reply target", () => {
    const baseMember = {
      avatar: "AG",
      type: "agent" as const,
      runtimeStatus: "idle" as const,
      role: "工程师",
      description: "",
      computer: "本机设备",
      created: "2026-06-04",
      creator: "system",
      runtime: "ClaudeCode",
      model: "Sonnet",
      instructions: "",
      permissions: [],
      environmentVariables: [],
      createdAgents: [],
      activity: "",
      capabilities: [],
    };

    const activities = createChannelAgentActivityMessages(
      {
        messageId: "msg_channel_all_multi",
        action: "request_agent_reply",
        assigneeAgentId: "agent_alice",
        assigneeAgentIds: ["agent_alice", "agent_coda"],
      },
      "all",
      [
        { ...baseMember, id: "agent_alice", name: "Alice", handle: "@alice" },
        { ...baseMember, id: "agent_coda", name: "Coda", handle: "@coda" },
      ],
    );

    expect(activities.map((activity) => activity.id)).toEqual([
      "agent-activity-msg_channel_all_multi-agent_alice",
    ]);
  });

  it("does not show pending activity for channel coordinators", () => {
    const activity = createChannelAgentActivityMessage(
      { messageId: "msg_channel_all_3", action: "request_agent_reply", assigneeAgentId: "agent_coordinator_all", assigneeAgentIds: ["agent_coordinator_all"] },
      "all",
      [],
    );

    expect(activity).toBeNull();
  });

  it("shows pending activity for the system guide because it can reply", () => {
    const activity = createChannelAgentActivityMessage(
      { messageId: "msg_channel_all_4", action: "request_agent_reply", assigneeAgentId: "agent_guide_local_node", assigneeAgentIds: ["agent_guide_local_node"] },
      "all",
      [
        {
          id: "agent_guide_local_node",
          name: "Yeal",
          handle: "@yeal",
          avatar: "YE",
          type: "agent",
          runtimeStatus: "idle",
          role: "引导员",
          description: "回答关于 Slei App 如何使用的问题。",
          computer: "本机设备",
          created: "2026-06-04",
          creator: "system",
          runtime: "ClaudeCode",
          model: "Sonnet",
          instructions: "",
          permissions: [],
          environmentVariables: [],
          createdAgents: [],
          activity: "",
          capabilities: [],
          systemOwned: true,
          directMessageEnabled: true,
        },
      ],
    );

    expect(activity).toMatchObject({
      id: "agent-activity-msg_channel_all_4-agent_guide_local_node",
      author: "Yeal",
      handle: "@yeal",
      status: "pending",
    });
  });

  it("refreshes channel agent reply timeout when streaming chunks update", async () => {
    let polls = 0;
    const progressBodies: string[] = [];
    const bridge = {
      listConversationMessages: async () => {
        polls += 1;
        if (polls === 1) {
          return { messages: [] };
        }
        if (polls === 2) {
          return {
            messages: [{
              id: "run-1",
              conversationId: "dm:agent_guide_local_node",
              authorId: "agent_guide_local_node",
              body: "chunk 1",
              status: "running",
              createdAt: "2026-06-04T00:00:00.000Z",
            }],
          };
        }
        if (polls === 3) {
          return {
            messages: [{
              id: "run-1",
              conversationId: "dm:agent_guide_local_node",
              authorId: "agent_guide_local_node",
              body: "chunk 1 chunk 2",
              status: "running",
              createdAt: "2026-06-04T00:00:00.000Z",
            }],
          };
        }
        return {
          messages: [{
            id: "run-1",
            conversationId: "dm:agent_guide_local_node",
            authorId: "agent_guide_local_node",
            body: "chunk 1 chunk 2 done",
            status: "done",
            createdAt: "2026-06-04T00:00:00.000Z",
          }],
        };
      },
    };

    const reply = await waitForChannelAgentReply(
      bridge,
      "dm:agent_guide_local_node",
      "agent_guide_local_node",
      new Set(),
      {
        idleTimeoutMs: 100,
        pollIntervalMs: 1,
        onProgress: (message) => progressBodies.push(message.body),
      },
    );

    expect(reply?.body).toBe("chunk 1 chunk 2 done");
    expect(progressBodies).toEqual(["chunk 1", "chunk 1 chunk 2", "chunk 1 chunk 2 done"]);
  });
});
