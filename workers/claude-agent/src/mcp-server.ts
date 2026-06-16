import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { isSleiProductToolName, SLEI_PRODUCT_TOOL_DEFINITIONS } from "./slei-tools.js";

export function listSleiMcpTools() {
  return SLEI_PRODUCT_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export async function callSleiMcpTool(
  name: string,
  _args: unknown,
): Promise<CallToolResult> {
  if (!isSleiProductToolName(name)) {
    throw new Error(`unknown Slei MCP tool: ${name}`);
  }

  return {
    content: [
      {
        type: "text",
        text: "Slei received this product tool request and will show it in the app.",
      },
    ],
  };
}

export async function runSleiMcpServer(): Promise<void> {
  const server = new Server(
    { name: "slei", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Use these Slei product tools for app-visible actions. Do not replace them with natural language, JSON text, or file writes.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listSleiMcpTools(),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callSleiMcpTool(request.params.name, request.params.arguments),
  );

  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSleiMcpServer();
}
