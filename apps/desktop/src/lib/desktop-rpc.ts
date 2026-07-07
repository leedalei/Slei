import type {
  ChannelListReceipt,
  ChannelMessageListReceipt,
  DaemonConnectionState,
  DiagnosticsSnapshotView,
  EventReconnectReceipt,
  NodeListReceipt,
  SanitizedDaemonStatus,
  SendChannelMessageReceipt,
  SendChannelMessageRequest,
  TaskListQuery,
  TaskListReceipt,
} from "./daemon-types";

export const desktopRpcMethods = [
  "daemon.status",
  "diagnostics.list",
  "nodes.list",
  "channels.list",
  "channels.messages.list",
  "channels.messages.send",
  "tasks.list",
  "events.reconnect",
  "frontend.crash.log",
  "frontend.event.log",
] as const;

export type DesktopRpcMethod = (typeof desktopRpcMethods)[number] | string;

export type DesktopRpcRequestMap = {
  "daemon.status": Record<string, never>;
  "diagnostics.list": Record<string, never>;
  "nodes.list": Record<string, never>;
  "channels.list": Record<string, never>;
  "channels.messages.list": { channelId: string; query?: unknown };
  "channels.messages.send": { channelId: string; request: SendChannelMessageRequest };
  "tasks.list": { query: TaskListQuery };
  "events.reconnect": { after: number };
  "frontend.crash.log": { report: unknown };
  "frontend.event.log": { report: unknown };
};

export type DesktopRpcResponseMap = {
  "daemon.status": SanitizedDaemonStatus;
  "diagnostics.list": DiagnosticsSnapshotView;
  "nodes.list": NodeListReceipt;
  "channels.list": ChannelListReceipt;
  "channels.messages.list": ChannelMessageListReceipt;
  "channels.messages.send": SendChannelMessageReceipt;
  "tasks.list": TaskListReceipt;
  "events.reconnect": EventReconnectReceipt;
  "frontend.crash.log": void;
  "frontend.event.log": void;
};

export type DesktopEventMap = {
  "daemon.events": EventReconnectReceipt;
  "daemon.state": DaemonConnectionState;
};

export type DesktopRpcTransport = {
  call(method: string, payload: unknown): Promise<unknown>;
};

export function createDesktopRpcClient(transport: DesktopRpcTransport) {
  return {
    call<M extends keyof DesktopRpcRequestMap>(
      method: M,
      payload: DesktopRpcRequestMap[M],
    ): Promise<DesktopRpcResponseMap[M]> {
      return transport.call(method, payload) as Promise<DesktopRpcResponseMap[M]>;
    },
  };
}
