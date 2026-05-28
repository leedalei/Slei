export function renderConnectionStep(input: {
  locale: "zh-CN" | "en-US";
  daemonConnected: boolean;
}): string {
  if (input.daemonConnected) {
    return input.locale === "zh-CN" ? "Daemon 已连接" : "Daemon connected";
  }
  return input.locale === "zh-CN"
    ? "Daemon 未启动 无法完成"
    : "Daemon is not running Cannot finish";
}
