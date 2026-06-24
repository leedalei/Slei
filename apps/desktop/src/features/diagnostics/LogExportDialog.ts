import { createDesktopMessages } from "../../i18n";
import { escapeHtmlText } from "../shell/htmlEscape";

export function renderLogExportDialog(input: {
  locale: "zh-CN" | "en-US";
  sanitizedPreview: string;
}): string {
  const messages = createDesktopMessages(input.locale).diagnostics;
  const title = messages.exportLogs;
  const hint = messages.sanitizedHint;
  return `<section class="slei-soft-dialog grid gap-3 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-border shadow-lg" data-slei-log-export-dialog><header class="grid gap-1" data-slei-page-header><h1>${escapeHtmlText(title)}</h1><p>${escapeHtmlText(hint)}</p></header><pre class="rounded-lg bg-muted/40 p-3 text-xs" data-slei-panel data-variant="inset">${escapeHtmlText(input.sanitizedPreview)}</pre></section>`;
}
