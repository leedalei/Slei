import { DesktopDaemonError } from "./daemon-http.js";
import type { DaemonHttpClient } from "./daemon-http.js";
import type { DesktopRpcRequestMap, DesktopRpcResponseMap } from "../lib/desktop-rpc.js";
import type { EventReconnectReceipt, SanitizedDaemonStatus } from "../lib/daemon-types.js";

export type DaemonRpcHandler = {
  call<M extends keyof DesktopRpcRequestMap>(
    method: M,
    payload: DesktopRpcRequestMap[M],
  ): Promise<DesktopRpcResponseMap[M]>;
  call(method: string, payload: unknown): Promise<unknown>;
};

export type DaemonRpcHandlerOptions = {
  logger?: (message: string) => void;
};

export function createDaemonRpcHandler(client: DaemonHttpClient, options: DaemonRpcHandlerOptions = {}): DaemonRpcHandler {
  const logger = options.logger ?? ((message: string) => console.error(message));

  return {
    async call(method: string, payload: unknown) {
      switch (method) {
        case "daemon.status":
          return sanitizeHealth(await client.request("GET", "/health"));
        case "diagnostics.list":
          return client.request("GET", "/v1/diagnostics");
        case "nodes.list":
          return client.request("GET", "/v1/nodes");
        case "channels.list":
          return client.request("GET", "/v1/channels");
        case "channels.messages.list":
          return listChannelMessages(client, payload);
        case "channels.messages.send":
          return sendChannelMessage(client, payload);
        case "tasks.list":
          return listTasks(client, payload);
        case "events.reconnect":
          return reconnectEvents(client, payload);
        case "frontend.crash.log":
          return logFrontendCrash(payload, logger);
        case "frontend.event.log":
          return logFrontendEvent(payload, logger);
        default:
          throw new DesktopDaemonError("invalid_rpc_method", `Unsupported desktop RPC method: ${method}`);
      }
    },
  };
}

function sanitizeHealth(input: unknown): SanitizedDaemonStatus {
  const health = requireRecord(input, "daemon.status");

  return {
    connected: true,
    label: "connected",
    daemonVersion: readString(health, "daemon_version", "daemon.status"),
    protocolVersion: readString(health, "protocol_version", "daemon.status"),
  };
}

function listChannelMessages(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "channels.messages.list");
  const channelId = readString(record, "channelId", "channels.messages.list");
  const query = queryFromPayload(record.query, "channels.messages.list");
  const path = appendQuery(`/v1/channels/${encodeURIComponent(channelId)}/messages`, query);
  return client.request("GET", path);
}

function sendChannelMessage(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "channels.messages.send");
  const channelId = readString(record, "channelId", "channels.messages.send");
  const request = requireRecord(record.request, "channels.messages.send");
  return client.request("POST", `/v1/channels/${encodeURIComponent(channelId)}/messages`, request);
}

function listTasks(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "tasks.list");
  const query = queryFromPayload(record.query, "tasks.list");
  return client.request("GET", appendQuery("/v1/tasks", query));
}

async function reconnectEvents(client: DaemonHttpClient, payload: unknown): Promise<EventReconnectReceipt> {
  const record = requireRecord(payload, "events.reconnect");
  const after = readNumber(record, "after", "events.reconnect");
  const query = new URLSearchParams({ after: String(after) });
  const response = await client.request<{ events?: unknown[] }>("GET", `/v1/events/ws?${query.toString()}`);
  const events = Array.isArray(response.events) ? response.events : [];

  return { after, events: events as EventReconnectReceipt["events"] };
}

function logFrontendCrash(payload: unknown, logger: (message: string) => void): void {
  const report = readReport(payload, "frontend.crash.log");
  logger(
    `[slei-frontend-crash] kind=${truncateLogValue(readString(report, "kind", "frontend.crash.log"))}` +
      ` url=${truncateLogValue(readString(report, "url", "frontend.crash.log"))}` +
      ` message=${truncateLogValue(readString(report, "message", "frontend.crash.log"))}` +
      ` stack=${truncateLogValue(readOptionalString(report, "stack", "frontend.crash.log") ?? "")}` +
      ` component_stack=${truncateLogValue(
        readOptionalString(report, "componentStack", "frontend.crash.log") ??
          readOptionalString(report, "component_stack", "frontend.crash.log") ??
          "",
      )}`,
  );
}

function logFrontendEvent(payload: unknown, logger: (message: string) => void): void {
  const report = readReport(payload, "frontend.event.log");
  const context = report.context === undefined ? "{}" : stringifyLogContext(report.context);
  logger(
    `[slei-frontend] scope=${truncateLogValue(readString(report, "scope", "frontend.event.log"))}` +
      ` message=${truncateLogValue(readString(report, "message", "frontend.event.log"))}` +
      ` context=${truncateLogValue(context)}`,
  );
}

function readReport(payload: unknown, method: string): Record<string, unknown> {
  const record = requireRecord(payload, method);
  return requireRecord(record.report, method);
}

function readOptionalString(record: Record<string, unknown>, key: string, method: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DesktopDaemonError("invalid_rpc_payload", `Invalid desktop RPC payload for ${method}`);
  }
  return value;
}

function stringifyLogContext(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncateLogValue(value: string): string {
  return Array.from(value).slice(0, 4000).join("");
}

function queryFromPayload(query: unknown, method: string): URLSearchParams {
  const params = new URLSearchParams();
  if (query === undefined || query === null) {
    return params;
  }
  if (query instanceof URLSearchParams) {
    return new URLSearchParams(query);
  }
  if (!isRecord(query)) {
    throw new DesktopDaemonError("invalid_rpc_payload", `Invalid desktop RPC payload for ${method}`);
  }

  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(params, key, value);
  }
  return params;
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function appendQueryValue(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(params, key, item);
    }
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    params.append(key, String(value));
    return;
  }
  throw new DesktopDaemonError("invalid_rpc_payload", "Invalid desktop RPC query value");
}

function requireRecord(value: unknown, method: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DesktopDaemonError("invalid_rpc_payload", `Invalid desktop RPC payload for ${method}`);
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string, method: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DesktopDaemonError("invalid_rpc_payload", `Invalid desktop RPC payload for ${method}`);
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string, method: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DesktopDaemonError("invalid_rpc_payload", `Invalid desktop RPC payload for ${method}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
