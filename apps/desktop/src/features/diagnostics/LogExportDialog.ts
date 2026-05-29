import { createDesktopMessages } from "../../i18n";

export function renderLogExportDialog(input: {
  locale: "zh-CN" | "en-US";
  sanitizedPreview: string;
}): string {
  const messages = createDesktopMessages(input.locale).diagnostics;
  const title = messages.exportLogs;
  const hint = messages.sanitizedHint;
  return [title, hint, input.sanitizedPreview].join("\n");
}
