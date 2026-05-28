import type { DaemonBridge } from "../lib/daemon-bridge";

export async function renderAppShell(input: {
  bridge: DaemonBridge;
  locale?: "zh-CN" | "en-US";
}): Promise<string> {
  const locale = input.locale ?? "zh-CN";
  const status = await input.bridge.daemonStatus();
  const labels = translations[locale];

  return [
    labels.chat,
    labels.tasks,
    labels.members,
    labels.computers,
    labels.settings,
    status.connected ? labels.connected : labels.offline,
  ].join(" ");
}

const translations = {
  "zh-CN": {
    chat: "聊天",
    tasks: "任务",
    members: "成员",
    computers: "运行设备",
    settings: "设置",
    connected: "已连接",
    offline: "离线",
  },
  "en-US": {
    chat: "Chat",
    tasks: "Tasks",
    members: "Members",
    computers: "Computers",
    settings: "Settings",
    connected: "Connected",
    offline: "Offline",
  },
};
