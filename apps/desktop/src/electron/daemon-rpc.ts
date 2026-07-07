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
        case "app.runtimeFlags":
          return { debug: false };
        case "diagnostics.list":
          return client.request("GET", "/v1/diagnostics");
        case "nodes.list":
          return client.request("GET", "/v1/nodes");
        case "nodes.renameLocal":
          return renameLocalNode(client, payload);
        case "runtime.refreshStatus":
          return client.request("GET", "/v1/nodes");
        case "channels.list":
          return client.request("GET", "/v1/channels");
        case "channels.create":
          return client.request("POST", "/v1/channels", readRequestBody(payload, method), idempotencyOptions("desktop-channel-create"));
        case "channels.delete":
          return deleteChannel(client, payload);
        case "channels.projectPaths.replace":
          return replaceChannelProjectPaths(client, payload);
        case "channels.members.list":
          return listChannelMembers(client, payload);
        case "channels.members.add":
          return addChannelMember(client, payload);
        case "channels.members.remove":
          return removeChannelMember(client, payload);
        case "channels.messages.list":
          return listChannelMessages(client, payload);
        case "channels.messages.send":
          return sendChannelMessage(client, payload);
        case "tasks.list":
          return listTasks(client, payload);
        case "tasks.thread.get":
          return getTaskThread(client, payload);
        case "tasks.reply":
          return replyToTask(client, payload);
        case "tasks.status.update":
          return updateTaskStatus(client, payload);
        case "interactiveCards.complete":
          return completeInteractiveCard(client, payload);
        case "agents.bootstrapGuide":
          return client.request("POST", "/v1/agents/guide/bootstrap");
        case "agents.list":
          return client.request("GET", "/v1/agents");
        case "agentRolePresets.list":
          return client.request("GET", "/v1/agent-role-presets");
        case "agents.create":
          return client.request("POST", "/v1/agents", readRequestBody(payload, method), idempotencyOptions("desktop-agent-create"));
        case "agents.update":
          return updateAgent(client, payload);
        case "agents.delete":
          return deleteAgent(client, payload);
        case "agents.remember":
          return rememberAgentFact(client, payload);
        case "agents.skills.list":
          return listAgentSkills(client, payload);
        case "agents.path.open":
        case "agents.workspace.list":
        case "agents.workspace.file.read":
          throw new DesktopDaemonError("daemon_route_unavailable", `Desktop RPC method has no daemon HTTP route yet: ${method}`);
        case "agents.activity.list":
          return listAgentActivity(client, payload);
        case "conversations.list":
          return client.request("GET", "/v1/conversations");
        case "conversations.dm.create":
          return createDmConversation(client, payload);
        case "conversations.runtimeSession.reset":
          return resetConversationRuntimeSession(client, payload);
        case "conversations.sessions.list":
          return listConversationSessions(client, payload);
        case "conversations.sessions.create":
          return createConversationSession(client, payload);
        case "conversations.sessions.activate":
          return activateConversationSession(client, payload);
        case "conversations.messages.list":
          return listConversationMessages(client, payload);
        case "conversations.messages.clear":
          return clearConversationMessages(client, payload);
        case "conversations.messages.send":
          return sendConversationMessage(client, payload);
        case "permissions.resolve":
          return client.request("POST", "/v1/approvals/permissions/resolve", readRequestBody(payload, method));
        case "attachments.upload":
          return client.request("POST", "/v1/attachments", readRequestBody(payload, method));
        case "messageThreads.createFromSource":
          return client.request("POST", "/v1/message-threads/from-source-message", readRequestBody(payload, method), idempotencyOptions("desktop-message-thread-create"));
        case "messageThreads.get":
          return getMessageThread(client, payload);
        case "messageThreads.reply":
          return replyToMessageThread(client, payload);
        case "savedMessages.list":
          return client.request("GET", "/v1/saved-messages");
        case "savedMessages.save":
          return client.request("POST", "/v1/saved-messages", readRequestBody(payload, method));
        case "savedMessages.unsave":
          return unsaveMessage(client, payload);
        case "search.global":
          return globalSearch(client, payload);
        case "preferences.list":
          return client.request("GET", "/v1/settings/preferences");
        case "preferences.update":
          return client.request("PATCH", "/v1/settings/preferences", readRequestBody(payload, method));
        case "profile.get":
          return client.request("GET", "/v1/settings/profile");
        case "profile.update":
          return client.request("PATCH", "/v1/settings/profile", readRequestBody(payload, method));
        case "profile.avatar.upload":
          return client.request("POST", "/v1/settings/profile/avatar-image", readRequestBody(payload, method));
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

function deleteChannel(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "channels.delete");
  const channelId = readString(record, "channelId", "channels.delete");
  return client.request("DELETE", `/v1/channels/${encodeURIComponent(channelId)}`);
}

function replaceChannelProjectPaths(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "channels.projectPaths.replace");
  const channelId = readString(record, "channelId", "channels.projectPaths.replace");
  const request = requireRecord(record.request, "channels.projectPaths.replace");
  return client.request("PATCH", `/v1/channels/${encodeURIComponent(channelId)}/project-paths`, request);
}

function listChannelMembers(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "channels.members.list");
  const channelId = readString(record, "channelId", "channels.members.list");
  return client.request("GET", `/v1/channels/${encodeURIComponent(channelId)}/members`);
}

function addChannelMember(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "channels.members.add");
  const channelId = readString(record, "channelId", "channels.members.add");
  const request = requireRecord(record.request, "channels.members.add");
  return client.request("POST", `/v1/channels/${encodeURIComponent(channelId)}/members`, request);
}

function removeChannelMember(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "channels.members.remove");
  const channelId = readString(record, "channelId", "channels.members.remove");
  const agentId = readString(record, "agentId", "channels.members.remove");
  return client.request("DELETE", `/v1/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(agentId)}`);
}

function sendChannelMessage(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "channels.messages.send");
  const channelId = readString(record, "channelId", "channels.messages.send");
  const request = requireRecord(record.request, "channels.messages.send");
  return client.request("POST", `/v1/channels/${encodeURIComponent(channelId)}/messages`, request, {
    headers: { "Idempotency-Key": createIdempotencyKey("desktop-channel-message") },
  });
}

function listTasks(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "tasks.list");
  const query = queryFromPayload(record.query, "tasks.list");
  return client.request("GET", appendQuery("/v1/tasks", query));
}

function getTaskThread(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "tasks.thread.get");
  const taskId = readString(record, "taskId", "tasks.thread.get");
  return client.request("GET", `/v1/tasks/${encodeURIComponent(taskId)}/thread`);
}

function replyToTask(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "tasks.reply");
  const taskId = readString(record, "taskId", "tasks.reply");
  const request = requireRecord(record.request, "tasks.reply");
  return client.request("POST", `/v1/tasks/${encodeURIComponent(taskId)}/replies`, request, idempotencyOptions("desktop-task-reply"));
}

function updateTaskStatus(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "tasks.status.update");
  const taskId = readString(record, "taskId", "tasks.status.update");
  const request = requireRecord(record.request, "tasks.status.update");
  return client.request("PATCH", `/v1/tasks/${encodeURIComponent(taskId)}/status`, request, idempotencyOptions("desktop-task-status"));
}

function completeInteractiveCard(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "interactiveCards.complete");
  const cardId = readString(record, "cardId", "interactiveCards.complete");
  return client.request("POST", `/v1/interactive-cards/${encodeURIComponent(cardId)}/complete`, undefined, idempotencyOptions("desktop-card-complete"));
}

function updateAgent(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "agents.update");
  const agentId = readString(record, "agentId", "agents.update");
  const request = requireRecord(record.request, "agents.update");
  return client.request("PATCH", `/v1/agents/${encodeURIComponent(agentId)}`, request);
}

function deleteAgent(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "agents.delete");
  const agentId = readString(record, "agentId", "agents.delete");
  return client.request("DELETE", `/v1/agents/${encodeURIComponent(agentId)}`);
}

function rememberAgentFact(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "agents.remember");
  const agentId = readString(record, "agentId", "agents.remember");
  const fact = readString(record, "fact", "agents.remember");
  return client.request("POST", `/v1/agents/${encodeURIComponent(agentId)}/memory/remember`, { fact });
}

function listAgentSkills(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "agents.skills.list");
  const agentId = readString(record, "agentId", "agents.skills.list");
  return client.request("GET", `/v1/agents/${encodeURIComponent(agentId)}/skills`);
}

function listAgentActivity(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "agents.activity.list");
  const agentId = readString(record, "agentId", "agents.activity.list");
  const limit = readNonNegativeInteger(record, "limit", "agents.activity.list");
  return client.request("GET", `/v1/agents/${encodeURIComponent(agentId)}/activity?${new URLSearchParams({ limit: String(limit) }).toString()}`);
}

function createDmConversation(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "conversations.dm.create");
  const agentId = readString(record, "agentId", "conversations.dm.create");
  return client.request("POST", "/v1/conversations/dm", { agentId });
}

function resetConversationRuntimeSession(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "conversations.runtimeSession.reset");
  const conversationId = readString(record, "conversationId", "conversations.runtimeSession.reset");
  return client.request("POST", `/v1/conversations/${encodeURIComponent(conversationId)}/runtime-session/reset`);
}

function listConversationSessions(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "conversations.sessions.list");
  const conversationId = readString(record, "conversationId", "conversations.sessions.list");
  return client.request("GET", `/v1/conversations/${encodeURIComponent(conversationId)}/sessions`);
}

function createConversationSession(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "conversations.sessions.create");
  const conversationId = readString(record, "conversationId", "conversations.sessions.create");
  return client.request("POST", `/v1/conversations/${encodeURIComponent(conversationId)}/sessions`);
}

function activateConversationSession(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "conversations.sessions.activate");
  const conversationId = readString(record, "conversationId", "conversations.sessions.activate");
  const sessionId = readString(record, "sessionId", "conversations.sessions.activate");
  return client.request("PATCH", `/v1/conversations/${encodeURIComponent(conversationId)}/sessions/${encodeURIComponent(sessionId)}/active`);
}

function listConversationMessages(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "conversations.messages.list");
  const conversationId = readString(record, "conversationId", "conversations.messages.list");
  const query = queryFromPayload(record.query, "conversations.messages.list");
  return client.request("GET", appendQuery(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, query));
}

function clearConversationMessages(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "conversations.messages.clear");
  const conversationId = readString(record, "conversationId", "conversations.messages.clear");
  return client.request("DELETE", `/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
}

function sendConversationMessage(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "conversations.messages.send");
  const conversationId = readString(record, "conversationId", "conversations.messages.send");
  const request = requireRecord(record.request, "conversations.messages.send");
  const body = record.sessionId === undefined ? request : { ...request, sessionId: record.sessionId };
  return client.request("POST", `/v1/conversations/${encodeURIComponent(conversationId)}/messages`, body, {
    headers: { "Idempotency-Key": createIdempotencyKey("desktop-conversation-message") },
  });
}

function getMessageThread(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "messageThreads.get");
  const threadId = readString(record, "threadId", "messageThreads.get");
  return client.request("GET", `/v1/message-threads/${encodeURIComponent(threadId)}`);
}

function replyToMessageThread(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "messageThreads.reply");
  const threadId = readString(record, "threadId", "messageThreads.reply");
  const request = requireRecord(record.request, "messageThreads.reply");
  return client.request("POST", `/v1/message-threads/${encodeURIComponent(threadId)}/replies`, request, idempotencyOptions("desktop-message-thread-reply"));
}

function unsaveMessage(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "savedMessages.unsave");
  const messageId = readString(record, "messageId", "savedMessages.unsave");
  return client.request("DELETE", `/v1/saved-messages/${encodeURIComponent(messageId)}`);
}

function globalSearch(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "search.global");
  const query = globalSearchQueryFromPayload(record.query);
  return client.request("GET", appendQuery("/v1/search/global", query));
}

function globalSearchQueryFromPayload(value: unknown): URLSearchParams {
  const query = queryFromPayload(value, "search.global");
  const shorthand = query.get("q");
  if (shorthand !== null && !query.has("query")) {
    query.set("query", shorthand);
  }
  query.delete("q");
  return query;
}

function renameLocalNode(client: DaemonHttpClient, payload: unknown) {
  const record = requireRecord(payload, "nodes.renameLocal");
  const name = readString(record, "name", "nodes.renameLocal");
  return client.request("PATCH", "/v1/nodes/local-node/name", { name });
}

function readRequestBody(payload: unknown, method: string): Record<string, unknown> {
  const record = requireRecord(payload, method);
  return requireRecord(record.request, method);
}

async function reconnectEvents(client: DaemonHttpClient, payload: unknown): Promise<EventReconnectReceipt> {
  const record = requireRecord(payload, "events.reconnect");
  const after = readNonNegativeInteger(record, "after", "events.reconnect");
  const query = new URLSearchParams({ after: String(after) });
  const response = await client.request<{ events?: unknown[] }>("GET", `/v1/events/ws?${query.toString()}`);
  const events = Array.isArray(response.events) ? response.events : [];

  return { after, events: events as EventReconnectReceipt["events"] };
}

function createIdempotencyKey(prefix: string): string {
  const random = Math.random().toString(36).slice(2) || "0";
  return `${prefix}-${Date.now()}-${random}`;
}

function idempotencyOptions(prefix: string): { headers: Record<string, string> } {
  return { headers: { "Idempotency-Key": createIdempotencyKey(prefix) } };
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

function readNonNegativeInteger(record: Record<string, unknown>, key: string, method: string): number {
  const value = readNumber(record, key, method);
  if (!Number.isInteger(value) || value < 0) {
    throw new DesktopDaemonError("invalid_rpc_payload", `Invalid desktop RPC payload for ${method}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
