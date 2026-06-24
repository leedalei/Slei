import { createDesktopMessages } from "../../i18n";
import { escapeHtmlAttribute, escapeHtmlText } from "../shell/htmlEscape";

export function renderConnectionStep(input: {
  locale: "zh-CN" | "en-US";
  daemonConnected: boolean;
}): string {
  const messages = createDesktopMessages(input.locale).onboarding;
  const status = input.daemonConnected ? "connected" : "offline";
  const message = input.daemonConnected ? messages.connectionConnected : messages.connectionUnavailable;
  return `<section class="rounded-xl border border-border/60 bg-card p-4" data-slei-panel data-variant="surface" data-onboarding-step="connection" data-slei-status="${escapeHtmlAttribute(status)}">${escapeHtmlText(message)}</section>`;
}
