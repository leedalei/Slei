import { createDesktopMessages } from "../../i18n";
import { escapeHtmlText } from "../shell/htmlEscape";

export function renderLogExportDialog(input: {
  locale: "zh-CN" | "en-US";
  sanitizedPreview: string;
}): string {
  const messages = createDesktopMessages(input.locale).diagnostics;
  const title = messages.exportLogs;
  const hint = messages.sanitizedHint;
  return `<section class="grid gap-3 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-border shadow-[var(--overlay-shadow-md)]" data-slei-log-export-dialog><header class="grid gap-1" data-slei-page-header><h1>${escapeHtmlText(title)}</h1><p>${escapeHtmlText(hint)}</p></header><pre class="rounded-lg border border-border bg-background/70 p-3 text-xs text-foreground" data-slot="log-preview">${escapeHtmlText(input.sanitizedPreview)}</pre></section>`;
}
