import type { ComputerNode } from "./types";

export function renderNodeList(nodes: ComputerNode[], locale: "zh-CN" | "en-US"): string {
  return nodes
    .map((node) => `${node.name} ${statusLabel(node.status, locale)}`)
    .join("\n");
}

export function statusLabel(
  status: ComputerNode["status"],
  locale: "zh-CN" | "en-US",
): string {
  if (locale === "zh-CN") {
    return status === "connected" ? "已连接" : "离线";
  }
  return status === "connected" ? "Connected" : "Offline";
}
