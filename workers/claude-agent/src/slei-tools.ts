import type { ProductToolRequestedEvent } from "./protocol";

export type SleiToolInvocation = {
  run_id: string;
  agent_id: string;
  payload: Record<string, unknown>;
};

export type SleiTool = {
  name: ProductToolRequestedEvent["tool_name"];
  handle(invocation: SleiToolInvocation): ProductToolRequestedEvent;
};

export function createSleiTools(): SleiTool[] {
  return [
    tool("slei_propose_interactive_card"),
    tool("slei_request_visible_delegation"),
    tool("slei_request_human_reply"),
  ];
}

export function parseFreeformAssistantText(_text: string): ProductToolRequestedEvent[] {
  return [];
}

function tool(name: ProductToolRequestedEvent["tool_name"]): SleiTool {
  return {
    name,
    handle(invocation) {
      return {
        type: "product_tool_requested",
        run_id: invocation.run_id,
        agent_id: invocation.agent_id,
        tool_name: name,
        payload: invocation.payload,
      };
    },
  };
}
