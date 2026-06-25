import { createDesktopMessages } from "../../i18n";
import { escapeHtmlAttribute, escapeHtmlText } from "../shell/htmlEscape";

export function renderRuntimeStep(input: {
  locale: "zh-CN" | "en-US";
  runtimeReady: boolean;
}): string {
  const messages = createDesktopMessages(input.locale).onboarding;
  const status = input.runtimeReady ? "connected" : "offline";
  const message = input.runtimeReady ? messages.runtimeReady : messages.runtimeUnavailableNoGuide;
  return `<section class="rounded-xl border border-border bg-card p-4 text-card-foreground" data-slot="card" data-onboarding-step="runtime" data-slei-status="${escapeHtmlAttribute(status)}">${escapeHtmlText(message)}</section>`;
}
