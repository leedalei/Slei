import type { ToolCall } from "./types";

export function renderToolCallBlock(tool: ToolCall): string {
  return `Tool: ${tool.name} ${tool.status}`;
}
