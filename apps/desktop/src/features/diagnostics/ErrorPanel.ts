import { createDesktopMessages } from "../../i18n";
import { escapeHtmlAttribute, escapeHtmlText } from "../shell/htmlEscape";

type ErrorCode = "E101" | "E201" | "E301" | "E401";

export function renderErrorPanel(input: { locale: "zh-CN" | "en-US"; code: ErrorCode }): string {
  const message = createDesktopMessages(input.locale).diagnostics.recovery[input.code];
  return `<section class="rounded-xl border border-destructive/35 bg-card p-4 text-sm shadow-sm" data-slei-panel data-variant="surface" data-slei-diagnostics-error="${escapeHtmlAttribute(input.code)}"><strong>${escapeHtmlText(input.code)}</strong> <span>${escapeHtmlText(message)}</span></section>`;
}
