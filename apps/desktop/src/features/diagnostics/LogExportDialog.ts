export function renderLogExportDialog(input: {
  locale: "zh-CN" | "en-US";
  sanitizedPreview: string;
}): string {
  const title = input.locale === "zh-CN" ? "导出日志" : "Export logs";
  const hint = input.locale === "zh-CN" ? "已移除敏感内容" : "Sensitive content removed";
  return [title, hint, input.sanitizedPreview].join("\n");
}
