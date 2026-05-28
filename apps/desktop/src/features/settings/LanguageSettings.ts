export function renderLanguageSettings(locale: "zh-CN" | "en-US"): string {
  const label = locale === "zh-CN" ? "语言" : "Language";
  const value = locale === "zh-CN" ? "中文" : "English";
  return `${label} ${value}`;
}
