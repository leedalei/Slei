export function renderAttentionBadge(required: boolean, locale: "zh-CN" | "en-US"): string {
  if (!required) {
    return "";
  }
  return locale === "zh-CN" ? "需要用户关注" : "Needs human attention";
}

