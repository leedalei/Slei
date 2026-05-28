import { renderMessageEntry } from "./MessageEntry";
import type { ChatMessage } from "./types";

export function renderTimeline(messages: ChatMessage[]): string {
  return messages.map(renderMessageEntry).join("\n");
}
