import { renderFeatureShell } from "../shell/AppShell";
import { renderChannelHeader } from "./ChannelHeader";
import { renderChannelSidebar } from "./ChannelSidebar";
import { renderComposer } from "./Composer";
import { renderTimeline } from "./Timeline";
import type { ChatMessage } from "./types";

export function renderChatPage(input: {
  locale: "zh-CN" | "en-US";
  channel: { name: string };
  messages: ChatMessage[];
  composer: { asTask: boolean };
  lastSequence: number;
}): string {
  const content = [
    renderChannelHeader(input.channel.name),
    renderTimeline(input.messages, input.locale),
    renderComposer({ channelName: input.channel.name, asTask: input.composer.asTask, locale: input.locale }),
    `reconnect after ${input.lastSequence}`,
  ].join("\n");

  return renderFeatureShell({
    active: "chat",
    locale: input.locale,
    sidebar: renderChannelSidebar([input.channel.name], input.channel.name),
    content,
  });
}
