import { createDesktopMessages } from "../../i18n";

export function renderLanguageSettings(locale: "zh-CN" | "en-US"): string {
  const messages = createDesktopMessages(locale).settings;
  return `${messages.language} ${messages.languageName}`;
}
