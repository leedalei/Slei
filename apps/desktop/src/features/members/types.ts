export type AgentView = {
  name: string;
  handle: string;
  runtimeKind: "ClaudeCode" | "CodexCli" | "OpenCode";
  model: string;
  presence: "online" | "offline";
  primary: boolean;
  permission: "ReadOnly" | "Edit" | "Controlled";
  workspaceOverride?: "ReadOnly" | "Edit" | "Controlled";
};

export type HumanView = {
  name: string;
  handle: string;
};
