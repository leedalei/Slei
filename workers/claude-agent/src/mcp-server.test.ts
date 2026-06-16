import { describe, expect, it } from "vitest";

import { callSleiMcpTool, listSleiMcpTools } from "./mcp-server.js";

describe("Slei stdio MCP server helpers", () => {
  it("lists Slei product tools with MCP schemas", () => {
    expect(listSleiMcpTools().map((tool) => tool.name).sort()).toEqual([
      "slei_propose_interactive_card",
      "slei_request_human_reply",
      "slei_request_visible_delegation",
    ]);
  });

  it("acknowledges tool calls without mutating product state", async () => {
    await expect(
      callSleiMcpTool("slei_request_visible_delegation", {
        target: "@alice",
        summary: "Review this",
      }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("Slei received") }],
    });
  });

  it("rejects unknown tools", async () => {
    await expect(callSleiMcpTool("unknown_tool", {})).rejects.toThrow(
      "unknown Slei MCP tool: unknown_tool",
    );
  });
});
