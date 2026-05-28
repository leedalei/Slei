export type RuntimeReadiness = {
  kind: "ClaudeCode" | "CodexCli" | "OpenCode";
  readiness: "ready" | "unavailable" | "unknown";
};

export type HostedAgent = {
  name: string;
  runtime: string;
  status: "online" | "offline";
};

export type ComputerNode = {
  id: string;
  name: string;
  status: "connected" | "disconnected";
  daemonVersion: string;
  runtimes: RuntimeReadiness[];
  agents: HostedAgent[];
};
