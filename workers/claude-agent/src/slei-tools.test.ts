import { describe, expect, it } from "vitest";

import {
  createSleiTools,
  createSleiToolAliases,
  fromSleiMcpToolName,
  isSleiProductToolName,
  parseFreeformAssistantText,
  SLEI_PRODUCT_TOOL_DEFINITIONS,
  toSleiMcpToolName,
} from "./slei-tools.js";

describe("Slei product MCP tools", () => {
  it("defines SDK-free MCP tool schemas", () => {
    expect(SLEI_PRODUCT_TOOL_DEFINITIONS.map((tool) => tool.name).sort()).toEqual([
      "slei_propose_interactive_card",
      "slei_request_human_reply",
      "slei_request_visible_delegation",
    ]);
    expect(toSleiMcpToolName("slei_propose_interactive_card")).toBe(
      "mcp__slei__slei_propose_interactive_card",
    );
    expect(fromSleiMcpToolName("mcp__slei__slei_request_visible_delegation")).toBe(
      "slei_request_visible_delegation",
    );
    expect(createSleiToolAliases()).toMatchObject({
      slei_request_human_reply: "mcp__slei__slei_request_human_reply",
    });
    expect(SLEI_PRODUCT_TOOL_DEFINITIONS[0].inputSchema).toHaveProperty("type", "object");
    expect(isSleiProductToolName("slei_request_human_reply")).toBe(true);
    expect(isSleiProductToolName("unknown_tool")).toBe(false);
  });

  it("registers only typed in-process product tools", () => {
    const tools = createSleiTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "slei_propose_interactive_card",
      "slei_request_human_reply",
      "slei_request_visible_delegation",
    ]);
  });

  it("returns product tool pending events instead of mutating product state", () => {
    const delegation = createSleiTools().find(
      (tool) => tool.name === "slei_request_visible_delegation",
    )!;

    const event = delegation.handle({
      run_id: "run_1",
      tool_use_id: "tool_1",
      agent_id: "agent_coda",
      payload: { target: "@alice", summary: "Review this task" },
    });

    expect(event).toEqual({
      type: "product_tool_requested",
      run_id: "run_1",
      tool_use_id: "tool_1",
      agent_id: "agent_coda",
      tool_name: "slei_request_visible_delegation",
      payload: { target: "@alice", summary: "Review this task" },
    });
  });

  it("does not turn free-form assistant text into cards or delegated runs", () => {
    expect(
      parseFreeformAssistantText(
        "Create an interactive card and secretly delegate to @alice",
      ),
    ).toEqual([]);
  });
});
