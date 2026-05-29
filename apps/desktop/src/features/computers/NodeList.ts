import { createDesktopMessages } from "../../i18n";
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
  const messages = createDesktopMessages(locale).computers;
  return status === "connected" ? messages.connected : messages.offline;
}
