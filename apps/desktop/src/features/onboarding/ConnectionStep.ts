import { createDesktopMessages } from "../../i18n";

export function renderConnectionStep(input: {
  locale: "zh-CN" | "en-US";
  daemonConnected: boolean;
}): string {
  const messages = createDesktopMessages(input.locale).onboarding;
  const status = input.daemonConnected ? "connected" : "offline";
  const message = input.daemonConnected ? messages.connectionConnected : messages.connectionUnavailable;
  return `<section class="rounded-xl border border-border/60 bg-card p-4 shadow-sm" data-slei-panel data-variant="surface" data-onboarding-step="connection" data-slei-status="${status}">${message}</section>`;
}
