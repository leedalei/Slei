import { createDesktopMessages } from "../../i18n";

export function renderRuntimeStep(input: {
  locale: "zh-CN" | "en-US";
  runtimeReady: boolean;
}): string {
  const messages = createDesktopMessages(input.locale).onboarding;
  if (input.runtimeReady) {
    return messages.runtimeReady;
  }
  return messages.runtimeUnavailableNoGuide;
}
