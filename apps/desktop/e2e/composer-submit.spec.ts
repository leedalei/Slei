import { describe, expect, it } from "vitest";

import { submitComposerDraft } from "../src/app/SleiApp";

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
});
