export type PermissionPreset = "ReadOnly" | "Edit" | "Controlled";

export type IsolatedSdkOptions = {
  persistSession: false;
  settingSources: [];
  nativeSubagents: [];
  externalMcpServers: [];
  permissionMode: "default" | "acceptEdits" | "plan";
  allowedTools: string[];
  disallowedTools: string[];
  cwd: string;
};

export type CanUseToolCall = {
  requestId: string;
  runId: string;
  toolUseId: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export function buildIsolatedSdkOptions(
  preset: PermissionPreset,
  cwd: string,
): IsolatedSdkOptions {
  return {
    persistSession: false,
    settingSources: [],
    nativeSubagents: [],
    externalMcpServers: [],
    permissionMode: preset === "ReadOnly" ? "plan" : "default",
    allowedTools: [
      "slei_propose_interactive_card",
      "slei_request_visible_delegation",
      "slei_request_human_reply",
    ],
    disallowedTools: ["Task", "mcp__*", "Plugin:*", "Bash:curl", "Bash:wget"],
    cwd,
  };
}

export function toPermissionRequest(call: CanUseToolCall) {
  return {
    type: "permission_requested" as const,
    request_id: call.requestId,
    run_id: call.runId,
    tool_use_id: call.toolUseId,
    agent_id: call.agentId,
    tool_name: call.toolName,
    risk: riskForTool(call.toolName),
    input: call.input,
  };
}

function riskForTool(toolName: string): "read_only" | "controlled" | "dangerous" {
  if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") {
    return "read_only";
  }
  if (toolName === "Bash" || toolName === "Delete") {
    return "dangerous";
  }
  return "controlled";
}
