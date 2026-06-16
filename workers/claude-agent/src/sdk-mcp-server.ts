import { createSdkMcpServer, tool as sdkTool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  SLEI_MCP_SERVER_NAME,
  SLEI_PRODUCT_TOOL_DEFINITIONS,
  type SleiProductToolDefinition,
} from "./slei-tools.js";

const SLEI_MCP_INSTRUCTIONS =
  "Use these Slei product tools for app-visible actions. Do not replace them with natural language, JSON text, or file writes.";

export function createSleiSdkMcpServer() {
  return createSdkMcpServer({
    name: SLEI_MCP_SERVER_NAME,
    version: "0.1.0",
    instructions: SLEI_MCP_INSTRUCTIONS,
    alwaysLoad: true,
    tools: SLEI_PRODUCT_TOOL_DEFINITIONS.map(createSdkTool),
  });
}

function createSdkTool(definition: SleiProductToolDefinition) {
  switch (definition.name) {
    case "slei_propose_interactive_card":
      return sdkTool(
        definition.name,
        definition.description,
        {
          kind: z.string(),
          title: z.string(),
          summary: z.string(),
          draft: z.record(z.string(), z.unknown()),
          actionLabel: z.string(),
          doneLabel: z.string(),
        },
        acknowledgeProductToolRequest,
        { alwaysLoad: true },
      );
    case "slei_request_visible_delegation":
      return sdkTool(
        definition.name,
        definition.description,
        {
          target: z.string(),
          summary: z.string(),
          reason: z.string().optional(),
        },
        acknowledgeProductToolRequest,
        { alwaysLoad: true },
      );
    case "slei_request_human_reply":
      return sdkTool(
        definition.name,
        definition.description,
        {
          question: z.string(),
          context: z.string().optional(),
        },
        acknowledgeProductToolRequest,
        { alwaysLoad: true },
      );
  }
}

async function acknowledgeProductToolRequest(): Promise<CallToolResult> {
  return {
    content: [
      {
        type: "text",
        text: "Slei received this product tool request and will show it in the app.",
      },
    ],
  };
}
