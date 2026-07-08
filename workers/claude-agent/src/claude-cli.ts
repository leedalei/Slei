import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import type { RuntimeEvent } from "./events.js";
import { prepareWorkspace } from "./overlay.js";
import type { StartRunCommand } from "./protocol.js";
import {
  fromSleiMcpToolName,
  SLEI_PRODUCT_TOOL_NAMES,
  toSleiMcpToolName,
} from "./slei-tools.js";

export const CLAUDE_CLI_TOOLS = ["Bash", "Skill", "Read", "Grep", "Glob", "LS", "Write", "Edit", "MultiEdit"] as const;
export const CLAUDE_ALLOWED_TOOLS = [
  "Bash",
  "Skill",
  "Read",
  "Grep",
  "Glob",
  "LS",
  ...SLEI_PRODUCT_TOOL_NAMES.map((name) => toSleiMcpToolName(name)),
] as const;
export const CLAUDE_DISALLOWED_TOOLS = ["Task", "Plugin:*", "Bash:curl", "Bash:wget"] as const;
export const CLAUDE_SETTING_SOURCES = ["user", "project", "local"] as const;

export function permissionModeForCli(): "default" {
  return "default";
}

export type ClaudeCliRunOptions = {
  mcpConfigPath: string;
  forceFreshSession?: boolean;
  additionalDirectories?: readonly string[];
};

export type ClaudeCliSpawner = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export type RunClaudeCodeCliOptions = {
  spawner?: ClaudeCliSpawner;
  commandName?: string;
};

export type SleiMcpConfigInput = {
  runId: string;
  agentId: string;
  serverPath: string;
};

export function buildClaudeCliArgs(
  command: StartRunCommand,
  options: ClaudeCliRunOptions,
): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  if (command.input.system_prompt !== undefined) {
    args.push("--append-system-prompt", command.input.system_prompt);
  }

  args.push(
    "--mcp-config",
    options.mcpConfigPath,
    "--tools",
    CLAUDE_CLI_TOOLS.join(","),
    "--allowedTools",
    CLAUDE_ALLOWED_TOOLS.join(","),
    "--disallowedTools",
    CLAUDE_DISALLOWED_TOOLS.join(","),
    "--setting-sources",
    CLAUDE_SETTING_SOURCES.join(","),
    "--permission-mode",
    permissionModeForCli(),
  );

  const model = claudeModelName(command.session.model);
  if (model) {
    args.push("--model", model);
  }

  for (const directory of options.additionalDirectories ?? command.session.additional_directories ?? []) {
    args.push("--add-dir", directory);
  }

  if (command.session.persist_session) {
    args.push(
      command.session.resume_session && options.forceFreshSession !== true ? "--resume" : "--session-id",
      command.session.session_id,
    );
  } else {
    args.push("--no-session-persistence");
  }

  args.push(promptForRun(command));
  return args;
}

export async function* runClaudeCodeCli(
  command: StartRunCommand,
  options: RunClaudeCodeCliOptions = {},
): AsyncIterable<RuntimeEvent> {
  for (const forceFreshSession of [false, true]) {
    if (forceFreshSession && !command.session.resume_session) {
      break;
    }
    const attempt = runClaudeCodeCliAttempt(command, {
      ...options,
      forceFreshSession,
    });
    let result: CliAttemptResult | undefined;

    for await (const item of attempt) {
      if (isAttemptResult(item)) {
        result = item;
      } else {
        yield item;
      }
    }

    if (result && shouldRetryResumeAsFreshSession(command, forceFreshSession, result)) {
      continue;
    }

    return;
  }
}

async function* runClaudeCodeCliAttempt(
  command: StartRunCommand,
  options: RunClaudeCodeCliOptions & { forceFreshSession: boolean },
): AsyncIterable<RuntimeEvent | CliAttemptResult> {
  const workspace = prepareWorkspace(command.session);
  const spawner = options.spawner ?? spawn;
  const tempDir = await mkdtemp(join(tmpdir(), "slei-claude-mcp-"));
  const mcpConfigPath = join(tempDir, "mcp-config.json");
  let emittedAnyEvent = false;
  let terminalEvent: RuntimeEvent | null = null;
  let stderr = "";

  try {
    await writeFile(
      mcpConfigPath,
      JSON.stringify(
        buildSleiMcpConfig({
          runId: command.run_id,
          agentId: command.session.agent_id,
          serverPath: sleiMcpServerPath(),
        }),
        null,
        2,
      ),
      "utf8",
    );

    const child = spawner(
      options.commandName ?? "claude",
      buildClaudeCliArgs(command, {
        mcpConfigPath,
        forceFreshSession: options.forceFreshSession,
        additionalDirectories: workspace.additionalDirectories,
      }),
      {
        cwd: workspace.cwd,
        env: process.env,
      },
    );

    child.stdin.end();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const lineEvents = streamStdoutEvents(command, child);
    const exit = waitForChildExit(child);

    try {
      for await (const event of lineEvents) {
        emittedAnyEvent = true;
        if (isTerminalEvent(event)) {
          terminalEvent = event;
        } else {
          yield event;
        }
      }
    } catch (error) {
      await exit.catch(() => undefined);
      const failed: RuntimeEvent = {
        type: "failed",
        runId: command.run_id,
        message: cliErrorMessage(error, stderr),
      };
      yield failed;
      yield { failedBeforeAnyEvent: !emittedAnyEvent, retryableResumeFailure: false };
      return;
    }

    let exitCode: number | null;
    try {
      exitCode = await exit;
    } catch (error) {
      const failed: RuntimeEvent = {
        type: "failed",
        runId: command.run_id,
        message: cliErrorMessage(error, stderr),
      };
      yield failed;
      yield { failedBeforeAnyEvent: !emittedAnyEvent, retryableResumeFailure: false };
      return;
    }

    if (exitCode !== 0) {
      if (terminalEvent?.type === "failed") {
        yield terminalEvent;
        yield { failedBeforeAnyEvent: false, retryableResumeFailure: false };
        return;
      }
      const retryableResumeFailure =
        command.session.resume_session &&
        !options.forceFreshSession &&
        !emittedAnyEvent &&
        isRetryableResumeFailure(stderr);
      if (retryableResumeFailure) {
        yield { failedBeforeAnyEvent: true, retryableResumeFailure: true };
        return;
      }
      const failed: RuntimeEvent = {
        type: "failed",
        runId: command.run_id,
        message: cliErrorMessage(new Error(`Claude CLI exited with code ${exitCode}`), stderr),
      };
      yield failed;
      yield {
        failedBeforeAnyEvent: !emittedAnyEvent,
        retryableResumeFailure: false,
      };
      return;
    }

    yield terminalEvent ?? { type: "completed", runId: command.run_id };
    yield { failedBeforeAnyEvent: false, retryableResumeFailure: false };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildSleiMcpConfig(input: SleiMcpConfigInput) {
  const env: Record<string, string> = {
    SLEI_RUN_ID: input.runId,
    SLEI_AGENT_ID: input.agentId,
  };
  for (const name of ["SLEI_DAEMON_URL", "SLEI_DAEMON_TOKEN", "SLEI_DATA_ROOT", "PATH"]) {
    const value = process.env[name];
    if (value) {
      env[name] = value;
    }
  }

  return {
    mcpServers: {
      slei: {
        type: "stdio",
        command: process.execPath,
        args: [input.serverPath, "--slei-mcp-server"],
        env,
      },
    },
  };
}

export function cliJsonLineToRuntimeEvents(
  runId: string,
  agentId: string,
  line: string,
): RuntimeEvent[] {
  const event = parseCliJson(line);

  if (!isRecord(event)) {
    return [];
  }

  if (event.type === "result") {
    return resultEventToRuntimeEvents(runId, event);
  }

  if (event.type === "stream_event") {
    return [];
  }

  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }

  return message.content.flatMap((part) => contentPartToRuntimeEvents(runId, agentId, part));
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

function parseCliJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid Claude CLI JSON: ${message}`);
  }
}

function contentPartToRuntimeEvents(
  runId: string,
  agentId: string,
  part: unknown,
): RuntimeEvent[] {
  if (!isRecord(part)) {
    return [];
  }

  if (part.type === "text" && typeof part.text === "string") {
    return [
      {
        type: "assistant",
        runId,
        message: { content: [{ type: "text", text: part.text }] },
      },
    ];
  }

  if (part.type === "tool_use" && typeof part.id === "string" && typeof part.name === "string") {
    const productToolName = fromSleiMcpToolName(part.name);
    if (productToolName) {
      return [
        {
          type: "product_tool",
          runId,
          toolUseId: part.id,
          agentId,
          toolName: productToolName,
          payload: isRecord(part.input) ? part.input : {},
        },
      ];
    }

    return [
      {
        type: "tool_use",
        runId,
        id: part.id,
        name: part.name,
      },
    ];
  }

  if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
    return [
      {
        type: "tool_result",
        runId,
        toolUseId: part.tool_use_id,
        isError: part.is_error === true,
      },
    ];
  }

  return [];
}

function resultEventToRuntimeEvents(runId: string, event: Record<string, unknown>): RuntimeEvent[] {
  if (event.is_error === true) {
    return [
      {
        type: "failed",
        runId,
        message: failedResultMessage(event),
      },
    ];
  }

  if (event.is_error === false) {
    return [{ type: "completed", runId }];
  }

  return [];
}

async function* streamStdoutEvents(
  command: StartRunCommand,
  child: ChildProcessWithoutNullStreams,
): AsyncIterable<RuntimeEvent> {
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    for (const event of cliJsonLineToRuntimeEvents(command.run_id, command.session.agent_id, line)) {
      yield event;
    }
  }
}

function waitForChildExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      child.stdout.destroy(error);
      child.stderr.destroy();
      reject(error);
    });
    child.once("close", resolve);
  });
}

function cliErrorMessage(error: unknown, stderr: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const details = stderr.trim();
  return details ? `${message}\n${details}` : message;
}

function shouldRetryResumeAsFreshSession(
  command: StartRunCommand,
  forceFreshSession: boolean,
  result: CliAttemptResult,
): boolean {
  return (
    command.session.resume_session &&
    !forceFreshSession &&
    result.failedBeforeAnyEvent &&
    result.retryableResumeFailure
  );
}

function isRetryableResumeFailure(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return (
    normalized.includes("no conversation found") ||
    normalized.includes("not found for session") ||
    normalized.includes("invalid session") ||
    normalized.includes("resume")
  );
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

function isTerminalEvent(event: RuntimeEvent): boolean {
  return event.type === "completed" || event.type === "failed";
}

function sleiMcpServerPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "local-runner.js");
}

function failedResultMessage(event: Record<string, unknown>): string {
  const errors = Array.isArray(event.errors)
    ? event.errors.filter((entry): entry is string => typeof entry === "string")
    : [];
  const subtype = typeof event.subtype === "string" ? event.subtype : undefined;
  const details = [...errors, subtype].filter((entry): entry is string => Boolean(entry));
  return details.length > 0 ? details.join(" ") : "Claude CLI run failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type CliAttemptResult = {
  failedBeforeAnyEvent: boolean;
  retryableResumeFailure: boolean;
};

function isAttemptResult(value: RuntimeEvent | CliAttemptResult): value is CliAttemptResult {
  return "failedBeforeAnyEvent" in value;
}
