import { createDesktopMessages } from "../../i18n";

export function renderAttentionBadge(required: boolean, locale: "zh-CN" | "en-US"): string {
  if (!required) {
    return "";
  }
  return createDesktopMessages(locale).tasks.attentionRequired;
}
