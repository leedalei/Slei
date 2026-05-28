import { sanitizeMarkdown } from "../../lib/markdown";
import { renderToolCallBlock } from "./ToolCallBlock";
import type { ChatMessage } from "./types";

export function renderMessageEntry(message: ChatMessage): string {
  return [
    message.sender,
    sanitizeMarkdown(message.body),
    message.streaming ? "正在输入" : "",
    ...message.toolCalls.map(renderToolCallBlock),
  ]
    .filter(Boolean)
    .join(" ");
}
