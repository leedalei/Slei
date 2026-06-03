import { describe, expect, it } from "vitest";

import { sendChatComposerMessage, submitComposerDraft } from "../src/app/SleiApp";
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
});
