import { createDesktopMessages } from "../../i18n";
import { escapeHtmlText } from "../shell/htmlEscape";

export function renderProfileStep(locale: "zh-CN" | "en-US"): string {
  return `<section class="rounded-xl border border-border/60 bg-card p-4 shadow-sm" data-slei-panel data-variant="surface" data-onboarding-step="profile">${escapeHtmlText(createDesktopMessages(locale).onboarding.profileStep)}</section>`;
}
