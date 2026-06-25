import { createDesktopMessages } from "../../i18n";
import { escapeHtmlText } from "../shell/htmlEscape";

export function renderProfileStep(locale: "zh-CN" | "en-US"): string {
  return `<section class="rounded-xl border border-border bg-card p-4 text-card-foreground" data-slot="card" data-onboarding-step="profile">${escapeHtmlText(createDesktopMessages(locale).onboarding.profileStep)}</section>`;
}
