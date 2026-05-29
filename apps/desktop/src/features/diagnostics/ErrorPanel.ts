import { createDesktopMessages } from "../../i18n";

type ErrorCode = "E101" | "E201" | "E301" | "E401";

export function renderErrorPanel(input: { locale: "zh-CN" | "en-US"; code: ErrorCode }): string {
  return `${input.code} ${createDesktopMessages(input.locale).diagnostics.recovery[input.code]}`;
}
