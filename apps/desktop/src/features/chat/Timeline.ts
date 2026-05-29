import { renderMessageEntry } from "./MessageEntry";
import type { ChatMessage } from "./types";

export function renderTimeline(messages: ChatMessage[], locale: "zh-CN" | "en-US" = "zh-CN"): string {
  return messages.map((message) => renderMessageEntry(message, locale)).join("\n");
}
