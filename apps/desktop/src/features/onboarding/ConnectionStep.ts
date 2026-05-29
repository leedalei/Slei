import { createDesktopMessages } from "../../i18n";

export function renderConnectionStep(input: {
  locale: "zh-CN" | "en-US";
  daemonConnected: boolean;
}): string {
  const messages = createDesktopMessages(input.locale).onboarding;
  if (input.daemonConnected) {
    return messages.connectionConnected;
  }
  return messages.connectionUnavailable;
}
