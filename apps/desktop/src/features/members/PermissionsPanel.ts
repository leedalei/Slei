import type { AgentView } from "./types";

export function renderPermissionsPanel(agent: AgentView, locale: "zh-CN" | "en-US"): string {
  const permission = agent.workspaceOverride ?? agent.permission;
  if (locale === "zh-CN") {
    return `频道权限：${zhPermission(agent.permission)} 工作区权限：${zhPermission(permission)}`;
  }
  return `Channel permission: ${permissionLabel(agent.permission)} Workspace permission: ${permissionLabel(permission)}`;
}

function zhPermission(permission: AgentView["permission"]): string {
  return {
    ReadOnly: "只读",
    Edit: "编辑",
    Controlled: "受控",
  }[permission];
}

function permissionLabel(permission: AgentView["permission"]): string {
  return {
    ReadOnly: "Read only",
    Edit: "Edit",
    Controlled: "Controlled",
  }[permission];
}
