import type { ProductToolRequestedEvent } from "./protocol.js";

export const SLEI_MCP_SERVER_NAME = "slei";

export const SLEI_PRODUCT_TOOL_NAMES = [
  "slei_propose_interactive_card",
  "slei_request_visible_delegation",
  "slei_request_human_reply",
] as const satisfies readonly ProductToolRequestedEvent["tool_name"][];

export type JsonSchema = Record<string, unknown>;

export type SleiProductToolDefinition = {
  name: ProductToolRequestedEvent["tool_name"];
  description: string;
  inputSchema: JsonSchema;
};

export const SLEI_PRODUCT_TOOL_DEFINITIONS: readonly SleiProductToolDefinition[] = [
  {
    name: "slei_propose_interactive_card",
    description:
      "Propose a typed Slei interactive card for user confirmation. Use kind createAgent when Yeal should create a real member/agent.",
    inputSchema: {
      type: "object",
      required: ["kind", "title", "summary", "draft", "actionLabel", "doneLabel"],
      properties: {
        kind: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
        draft: { type: "object", additionalProperties: true },
        actionLabel: { type: "string" },
        doneLabel: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "slei_request_visible_delegation",
    description: "Request a visible Slei delegation to another member or agent.",
    inputSchema: {
      type: "object",
      required: ["target", "summary"],
      properties: {
        target: { type: "string" },
        summary: { type: "string" },
        reason: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "slei_request_human_reply",
    description: "Ask the human user for a visible reply before continuing.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string" },
        context: { type: "string" },
      },
      additionalProperties: false,
    },
  },
];

export type SleiToolInvocation = {
  run_id: string;
  tool_use_id: string;
  agent_id: string;
  payload: Record<string, unknown>;
};

export type SleiTool = {
  name: ProductToolRequestedEvent["tool_name"];
  handle(invocation: SleiToolInvocation): ProductToolRequestedEvent;
};

export function createSleiTools(): SleiTool[] {
  return SLEI_PRODUCT_TOOL_NAMES.map(productTool);
}

export function createSleiMcpServer(): Record<string, unknown> {
  return {
    name: SLEI_MCP_SERVER_NAME,
    version: "0.1.0",
    instructions:
      "Use these Slei product tools for app-visible actions. Do not replace them with natural language, JSON text, or file writes.",
    alwaysLoad: true,
    tools: SLEI_PRODUCT_TOOL_DEFINITIONS,
  };
}

export function toSleiMcpToolName(name: ProductToolRequestedEvent["tool_name"]): string {
  return `mcp__${SLEI_MCP_SERVER_NAME}__${name}`;
}

export function fromSleiMcpToolName(name: string): ProductToolRequestedEvent["tool_name"] | null {
  const prefix = `mcp__${SLEI_MCP_SERVER_NAME}__`;
  const productName = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return isSleiProductToolName(productName) ? productName : null;
}

export function createSleiToolAliases(): Record<string, string> {
  return Object.fromEntries(
    SLEI_PRODUCT_TOOL_NAMES.map((name) => [name, toSleiMcpToolName(name)]),
  );
}

export function parseFreeformAssistantText(_text: string): ProductToolRequestedEvent[] {
  return [];
}

function productTool(name: ProductToolRequestedEvent["tool_name"]): SleiTool {
  return {
    name,
    handle(invocation) {
      return {
        type: "product_tool_requested",
        run_id: invocation.run_id,
        tool_use_id: invocation.tool_use_id,
        agent_id: invocation.agent_id,
        tool_name: name,
        payload: invocation.payload,
      };
    },
  };
}

export function isSleiProductToolName(
  name: string,
): name is ProductToolRequestedEvent["tool_name"] {
  return SLEI_PRODUCT_TOOL_NAMES.includes(name as ProductToolRequestedEvent["tool_name"]);
}
