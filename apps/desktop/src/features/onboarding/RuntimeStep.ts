import { createDesktopMessages } from "../../i18n";

export function renderRuntimeStep(input: {
  locale: "zh-CN" | "en-US";
  runtimeReady: boolean;
}): string {
  const messages = createDesktopMessages(input.locale).onboarding;
  const status = input.runtimeReady ? "connected" : "offline";
  const message = input.runtimeReady ? messages.runtimeReady : messages.runtimeUnavailableNoGuide;
  return `<section class="rounded-xl border border-border/60 bg-card p-4 shadow-sm" data-slei-panel data-variant="surface" data-onboarding-step="runtime" data-slei-status="${status}">${message}</section>`;
}
