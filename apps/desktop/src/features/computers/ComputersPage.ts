import { renderFeatureShell } from "../shell/AppShell";
import { renderNodeList } from "./NodeList";
import { renderNodeProfile } from "./NodeProfile";
import type { ComputerNode } from "./types";

export function renderComputersPage(input: {
  locale: "zh-CN" | "en-US";
  nodes: ComputerNode[];
}): string {
  const title = input.locale === "zh-CN" ? "运行设备" : "Computers";
  const sidebar = renderNodeList(input.nodes, input.locale);
  const content = [
    title,
    ...input.nodes.map((node) => renderNodeProfile(node, input.locale)),
  ].join("\n");

  return renderFeatureShell({
    active: "computers",
    locale: input.locale,
    sidebar,
    content,
  });
}
