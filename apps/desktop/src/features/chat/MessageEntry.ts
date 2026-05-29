import { createDesktopMessages } from "../../i18n";
import { sanitizeMarkdown } from "../../lib/markdown";
import { renderToolCallBlock } from "./ToolCallBlock";
import type { ChatMessage } from "./types";

export function renderMessageEntry(message: ChatMessage, locale: "zh-CN" | "en-US" = "zh-CN"): string {
  const messages = createDesktopMessages(locale);
  return [
    message.sender,
    sanitizeMarkdown(message.body),
    message.streaming ? messages.chat.typing : "",
    ...message.toolCalls.map(renderToolCallBlock),
  ]
    .filter(Boolean)
    .join(" ");
}
