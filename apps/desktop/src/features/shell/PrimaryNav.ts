export type NavItem = "chat" | "tasks" | "members" | "computers" | "settings";

export function renderPrimaryNav(active: NavItem, locale: "zh-CN" | "en-US"): string {
  const labels = {
    "zh-CN": {
      chat: "聊天",
      tasks: "任务",
      members: "成员",
      computers: "运行设备",
      settings: "设置",
    },
    "en-US": {
      chat: "Chat",
      tasks: "Tasks",
      members: "Members",
      computers: "Computers",
      settings: "Settings",
    },
  }[locale];

  return (Object.keys(labels) as NavItem[])
    .map((item) => `${item === active ? "[active]" : ""}${labels[item]}`)
    .join(" ");
}
