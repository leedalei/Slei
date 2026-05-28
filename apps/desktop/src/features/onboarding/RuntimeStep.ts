export function renderRuntimeStep(input: {
  locale: "zh-CN" | "en-US";
  runtimeReady: boolean;
}): string {
  if (input.runtimeReady) {
    return input.locale === "zh-CN" ? "运行时已就绪" : "Runtime ready";
  }
  return input.locale === "zh-CN"
    ? "运行时不可用 不会创建引导员"
    : "Runtime unavailable Guide Agent will not be created";
}
