import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { query as claudeAgentQuery } from "@anthropic-ai/claude-agent-sdk";

import { mapClaudeSdkEvent, type ClaudeSdkEvent } from "./events.js";
import { buildIsolatedSdkOptions, createRunPermissionController, type RunPermissionController } from "./permissions.js";
import type { ClearSessionCommand, StartRunCommand, WorkerCommand, WorkerEvent } from "./protocol.js";
import {
  createSleiMcpServer,
  fromSleiMcpToolName,
  type SleiToolInvocation,
} from "./slei-tools.js";

export type WorkerIO = {
  writeEvent(event: WorkerEvent): void;
};

export type RuntimeRunner = (command: StartRunCommand, controller?: RunPermissionController) => AsyncIterable<ClaudeSdkEvent>;
export type RuntimeClearer = (command: ClearSessionCommand) => Promise<void>;
export type ClaudeAgentQuery = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

const defaultRuntimeRunner: RuntimeRunner = (command, controller) =>
  runClaudeCode(command, claudeAgentQuery as ClaudeAgentQuery, controller);

export class ClaudeAgentWorker {
  #authorized = false;
  #permissionControllers = new Map<string, RunPermissionController>();

  constructor(
    private readonly launchSecret: string,
    private readonly io: WorkerIO,
    private readonly runner: RuntimeRunner = defaultRuntimeRunner,
    private readonly clearer: RuntimeClearer = clearClaudeCodeSession,
  ) {}

  async handleCommand(command: WorkerCommand): Promise<void> {
    if (command.type === "hello") {
      this.#authorized =
        command.protocol_version === "v1" &&
        command.launch_secret === this.launchSecret;
      return;
    }

    if (!this.#authorized) {
      this.io.writeEvent({
        type: "failed",
        run_id: "unknown",
        message: "worker command rejected before hello",
      });
      return;
    }

    if (command.type === "start_run") {
      await this.startRun(command);
      return;
    }

    if (command.type === "clear_session") {
      await this.clearSession(command);
      return;
    }

    if (command.type === "cancel") {
      this.io.writeEvent({ type: "completed", run_id: command.run_id });
      return;
    }

    if (command.type === "resolve_permission") {
      for (const controller of this.#permissionControllers.values()) {
        if (controller.resolvePermission({ requestId: command.request_id, decision: command.decision })) {
          return;
        }
      }
    }
  }

  private async startRun(command: StartRunCommand): Promise<void> {
    const controller = createRunPermissionController({
      runId: command.run_id,
      agentId: command.session.agent_id,
      cwd: command.session.cwd,
      sessionId: command.session.session_id,
    });
    this.#permissionControllers.set(command.run_id, controller);
    try {
      for await (const event of this.runner(command, controller)) {
        this.io.writeEvent(mapClaudeSdkEvent(event));
      }
    } catch (error) {
      this.io.writeEvent({
        type: "failed",
        run_id: command.run_id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#permissionControllers.delete(command.run_id);
    }
  }

  private async clearSession(command: ClearSessionCommand): Promise<void> {
    try {
      await this.clearer(command);
    } catch (error) {
      this.io.writeEvent({
        type: "failed",
        run_id: "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function* runClaudeCode(
  command: StartRunCommand,
  query: ClaudeAgentQuery = claudeAgentQuery as ClaudeAgentQuery,
  controller: RunPermissionController = createRunPermissionController({
    runId: command.run_id,
    agentId: command.session.agent_id,
    cwd: command.session.cwd,
    sessionId: command.session.session_id,
  }),
): AsyncIterable<ClaudeSdkEvent> {
  for (const forceFreshSession of [false, true]) {
    if (forceFreshSession && !command.session.resume_session) {
      break;
    }
    let emittedAnyEvent = false;
    let emittedTerminalEvent = false;
    let stderr = "";
    const sdkMessages = query({
      prompt: promptForRun(command),
      options: {
        ...buildClaudeSdkOptions(command, forceFreshSession, controller),
        stderr(data: string) {
          stderr += data;
        },
      },
    });

    try {
      for await (const message of streamSdkMessagesWithPermissionRequests(sdkMessages, controller)) {
        for (const event of sdkMessageToClaudeEvents(command, message)) {
          emittedAnyEvent = true;
          if (event.type === "completed" || event.type === "failed") {
            emittedTerminalEvent = true;
          }
          yield event;
          if (event.type === "failed") {
            closeSdkMessages(sdkMessages);
            return;
          }
        }
      }
    } catch (error) {
      closeSdkMessages(sdkMessages);
      if (shouldRetryResumeAsFreshSession(command, forceFreshSession, emittedAnyEvent, error)) {
        continue;
      }
      yield {
        type: "failed",
        runId: command.run_id,
        message: queryErrorMessage(error, stderr),
      };
      return;
    }

    if (!emittedTerminalEvent) {
      yield { type: "completed", runId: command.run_id };
    }
    return;
  }
}

function closeSdkMessages(messages: AsyncIterable<unknown>): void {
  if (isRecord(messages) && typeof messages.close === "function") {
    messages.close();
  }
}

function queryErrorMessage(error: unknown, stderr: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const details = stderr.trim();
  return details ? `${message}\n${details}` : message;
}

function shouldRetryResumeAsFreshSession(
  command: StartRunCommand,
  forceFreshSession: boolean,
  emittedAnyEvent: boolean,
  error: unknown,
): boolean {
  return (
    command.session.resume_session &&
    !forceFreshSession &&
    !emittedAnyEvent &&
    queryErrorMessage(error, "").includes("Claude Code process exited with code 1")
  );
}

export function buildClaudeCliArgs(command: StartRunCommand): string[] {
  const args = [
    "-p",
    promptForRun(command),
    "--output-format",
    "text",
    "--permission-mode",
    "bypassPermissions",
  ];
  if (command.session.persist_session) {
    args.push(command.session.resume_session ? "--resume" : "--session-id", command.session.session_id);
  } else {
    args.push("--no-session-persistence");
  }
  return args;
}

export function buildClearClaudeSessionCliArgs(command: ClearSessionCommand): string[] {
  const args = ["-p", "/clear", "--output-format", "text"];
  if (command.session.persist_session) {
    args.push("--resume", command.session.session_id);
  } else {
    args.push("--no-session-persistence");
  }
  return args;
}

export function buildClaudeSdkOptions(
  command: StartRunCommand,
  forceFreshSession = false,
  controller: RunPermissionController = createRunPermissionController({
    runId: command.run_id,
    agentId: command.session.agent_id,
    cwd: command.session.cwd,
    sessionId: command.session.session_id,
  }),
): Record<string, unknown> {
  const isolatedOptions = buildIsolatedSdkOptions("Controlled", command.session.cwd, controller);
  const options: Record<string, unknown> = {
    cwd: command.session.cwd,
    persistSession: command.session.persist_session,
    tools: isolatedOptions.tools,
    permissionMode: isolatedOptions.permissionMode,
    allowedTools: isolatedOptions.allowedTools,
    disallowedTools: isolatedOptions.disallowedTools,
    toolAliases: isolatedOptions.toolAliases,
    canUseTool: isolatedOptions.canUseTool,
    systemPrompt: buildSleiSystemPrompt(command.session.cwd),
    mcpServers: {
      slei: createSleiMcpServer(),
    },
  };
  const model = claudeModelName(command.session.model);
  if (model) {
    options.model = model;
  }

  if (command.session.persist_session) {
    if (command.session.resume_session && !forceFreshSession) {
      options.resume = command.session.session_id;
    } else {
      options.sessionId = command.session.session_id;
    }
  }

  return options;
}

async function* streamSdkMessagesWithPermissionRequests(
  messages: AsyncIterable<unknown>,
  controller: RunPermissionController,
): AsyncIterable<unknown | ClaudeSdkEvent> {
  const iterator = messages[Symbol.asyncIterator]();
  let nextMessage = iterator.next();
  let nextPermission = controller.nextPermissionRequest();

  for (;;) {
    const winner = await Promise.race([
      nextMessage.then((result) => ({ kind: "message" as const, result })),
      nextPermission.then((result) => ({ kind: "permission" as const, result })),
    ]);

    if (winner.kind === "permission") {
      nextPermission = controller.nextPermissionRequest();
      yield winner.result;
      continue;
    }

    if (winner.result.done) {
      return;
    }
    nextMessage = iterator.next();
    yield winner.result.value;
  }
}

function claudeModelName(model: string | undefined): string | undefined {
  const normalized = model?.trim();
  if (!normalized) {
    return undefined;
  }
  const label = normalized.toLowerCase();
  if (label === "sonnet") return "sonnet";
  if (label === "opus") return "opus";
  if (label === "haiku") return "haiku";
  return normalized;
}

function buildSleiSystemPrompt(cwd: string): Record<string, string> {
  return {
    type: "preset",
    preset: "claude_code",
    append: [
      "You are running inside Slei as the agent represented by this workspace.",
      "Use the Slei product tools when a skill asks for them. In particular, member creation must call slei_propose_interactive_card instead of explaining that the tool is unavailable.",
      loadAgentWorkspaceContext(cwd),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function loadAgentWorkspaceContext(cwd: string): string {
  const sections: string[] = [];
  const memoryPath = join(cwd, "MEMORY.md");
  if (existsSync(memoryPath)) {
    sections.push(`Agent MEMORY.md:\n${readFileSync(memoryPath, "utf8")}`);
  }
  const skillsPath = join(cwd, "skills");
  if (existsSync(skillsPath)) {
    const skills = readdirSync(skillsPath)
      .filter((name) => name.endsWith(".skill.md"))
      .sort()
      .map((name) => {
        const path = join(skillsPath, name);
        return `Skill ${name}:\n${readFileSync(path, "utf8")}`;
      });
    sections.push(...skills);
  }
  return sections.join("\n\n");
}

async function clearClaudeCodeSession(command: ClearSessionCommand): Promise<void> {
  const child = spawn("claude", buildClearClaudeSessionCliArgs(command), {
    cwd: command.session.cwd,
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });

  if (code !== 0) {
    throw new Error(stderr.trim() || `claude clear exited with code ${code}`);
  }
}

function promptForRun(command: StartRunCommand): string {
  if (command.session.resume_session || command.input.context.length === 0) {
    return command.input.prompt;
  }

  const context = command.input.context
    .map((message) => `${roleLabel(message.role)}: ${message.content}`)
    .join("\n\n");
  return `Previous conversation context:\n\n${context}\n\nCurrent user message:\n${command.input.prompt}`;
}

function roleLabel(role: "user" | "assistant" | "system") {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  return "System";
}

function sdkMessageToClaudeEvents(
  command: StartRunCommand,
  message: unknown,
): ClaudeSdkEvent[] {
  if (!isRecord(message)) {
    return [];
  }

  if (message.type === "permission_request") {
    return [
      {
        type: "permission_request",
        requestId: stringField(message, "requestId"),
        runId: stringField(message, "runId"),
        toolUseId: stringField(message, "toolUseId"),
        agentId: stringField(message, "agentId"),
        toolName: stringField(message, "toolName"),
        risk: riskField(message.risk),
        input: recordPayload(message.input),
        targetPath: typeof message.targetPath === "string" ? message.targetPath : undefined,
        sessionId: typeof message.sessionId === "string" ? message.sessionId : undefined,
      },
    ];
  }

  if (message.type === "assistant") {
    return sdkAssistantMessageToClaudeEvents(command, message);
  }

  if (message.type === "system" && message.subtype === "api_retry") {
    return [
      {
        type: "failed",
        runId: command.run_id,
        message: apiRetryMessage(message),
      },
    ];
  }

  if (message.type === "result") {
    if (message.is_error === true) {
      return [
        {
          type: "failed",
          runId: command.run_id,
          message: resultErrorMessage(message),
        },
      ];
    }
    return [{ type: "completed", runId: command.run_id }];
  }

  return [];
}

function apiRetryMessage(message: Record<string, unknown>): string {
  const error = typeof message.error === "string" ? message.error : "api_retry";
  const status = typeof message.error_status === "number" ? ` (HTTP ${message.error_status})` : "";
  const attempt = typeof message.attempt === "number" ? message.attempt : "?";
  const maxRetries = typeof message.max_retries === "number" ? message.max_retries : "?";
  const delay =
    typeof message.retry_delay_ms === "number" ? ` after ${Math.round(message.retry_delay_ms)}ms` : "";
  return `Claude API ${error}${status}. Retry ${attempt}/${maxRetries} was scheduled${delay}.`;
}

function sdkAssistantMessageToClaudeEvents(
  command: StartRunCommand,
  message: Record<string, unknown>,
): ClaudeSdkEvent[] {
  const content = assistantContent(message);
  const events: ClaudeSdkEvent[] = [];
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");

  if (text) {
    events.push({
      type: "assistant",
      runId: command.run_id,
      message: { content: [{ type: "text", text }] },
    });
  }

  for (const part of content) {
    if (part.type !== "tool_use" || typeof part.name !== "string" || typeof part.id !== "string") {
      continue;
    }
    const toolName = fromSleiMcpToolName(part.name);
    if (!toolName) {
      events.push({
        type: "tool_use",
        runId: command.run_id,
        id: part.id,
        name: part.name,
      });
      continue;
    }
    const invocation: SleiToolInvocation = {
      run_id: command.run_id,
      tool_use_id: part.id,
      agent_id: command.session.agent_id,
      payload: recordPayload(part.input),
    };
    events.push({
      type: "product_tool",
      runId: invocation.run_id,
      toolUseId: invocation.tool_use_id,
      agentId: invocation.agent_id,
      toolName,
      payload: invocation.payload,
    });
  }

  return events;
}

function assistantContent(message: Record<string, unknown>): Array<Record<string, unknown>> {
  const sdkMessage = isRecord(message.message) ? message.message : {};
  const content = sdkMessage.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(isRecord);
}

function recordPayload(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : { value: input };
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function riskField(value: unknown): "read_only" | "controlled" | "dangerous" {
  return value === "read_only" || value === "controlled" || value === "dangerous" ? value : "controlled";
}

function resultErrorMessage(message: Record<string, unknown>): string {
  if (Array.isArray(message.errors) && message.errors.every((error) => typeof error === "string")) {
    return message.errors.join("\n");
  }
  return typeof message.subtype === "string" ? message.subtype : "Claude Agent SDK run failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
