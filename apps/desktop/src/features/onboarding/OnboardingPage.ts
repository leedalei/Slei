import { createDesktopMessages } from "../../i18n";
import { escapeHtmlText } from "../shell/htmlEscape";
import { renderConnectionStep } from "./ConnectionStep";
import { renderProfileStep } from "./ProfileStep";
import { renderRuntimeStep } from "./RuntimeStep";

export function renderOnboardingPage(input: {
  locale: "zh-CN" | "en-US";
  hasProfile: boolean;
  daemonConnected: boolean;
  runtimeReady: boolean;
}): string {
  const title = createDesktopMessages(input.locale).onboarding.welcome;
  const steps = [
    input.hasProfile ? "" : renderProfileStep(input.locale),
    renderConnectionStep(input),
    renderRuntimeStep(input),
  ]
    .filter(Boolean)
    .join(" ");
  return `<section class="grid gap-4 p-6" data-slei-onboarding-page><header class="grid gap-1" data-slei-page-header><h1>${escapeHtmlText(title)}</h1></header><div class="grid gap-3">${steps}</div></section>`;
}
