import { createDesktopMessages } from "../../i18n";

export function renderProfileStep(locale: "zh-CN" | "en-US"): string {
  return createDesktopMessages(locale).onboarding.profileStep;
}
