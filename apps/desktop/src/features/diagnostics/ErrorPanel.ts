const recovery = {
  "zh-CN": {
    E101: "检查本地 daemon 是否启动，然后重连。",
    E201: "检查 runtime 权限和模型配置。",
    E301: "重新连接事件流，系统会按序号恢复。",
    E401: "检查工作区访问权限后重试。",
  },
  "en-US": {
    E101: "Check the local daemon and reconnect.",
    E201: "Check runtime permissions and model configuration.",
    E301: "Reconnect the event stream; Slei will resume by sequence.",
    E401: "Review workspace access before retrying.",
  },
} as const;

type ErrorCode = keyof (typeof recovery)["zh-CN"];

export function renderErrorPanel(input: { locale: "zh-CN" | "en-US"; code: ErrorCode }): string {
  return `${input.code} ${recovery[input.locale][input.code]}`;
}
