import { createDesktopMessages } from "../../i18n";

export function renderComposer(input: { channelName: string; asTask: boolean; locale?: "zh-CN" | "en-US" }): string {
  const messages = createDesktopMessages(input.locale ?? "en-US").chat;
  return [
    messages.inputToChannel(input.channelName),
    input.asTask ? `${messages.asTask} checked` : messages.asTask,
  ].join(" ");
}
