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

const CLI_TOOLS = ["Skill", "Read", "Grep", "Glob", "LS", "Write", "Edit", "MultiEdit"];
const READ_ONLY_ALLOWED_TOOLS = ["Skill", "Read", "Grep", "Glob", "LS"];
const DISALLOWED_TOOLS = ["Task", "Plugin:*", "Bash:curl", "Bash:wget"];
const SETTING_SOURCES = ["user", "project", "local"];

export type ClaudeCliRunOptions = {
  mcpConfigPath: string;
  forceFreshSession?: boolean;
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
    "--include-partial-messages",
  ];

  if (command.input.system_prompt !== undefined) {
    args.push("--append-system-prompt", command.input.system_prompt);
  }

  args.push(
    "--mcp-config",
    options.mcpConfigPath,
    "--tools",
    CLI_TOOLS.join(","),
    "--allowedTools",
    allowedTools().join(","),
    "--disallowedTools",
    DISALLOWED_TOOLS.join(","),
    "--setting-sources",
    SETTING_SOURCES.join(","),
    "--permission-mode",
    "default",
  );

  const model = claudeModelName(command.session.model);
  if (model) {
    args.push("--model", model);
  }

  for (const directory of command.session.additional_directories ?? []) {
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

  args.push(command.input.prompt);
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
    const result = await runClaudeCodeCliAttempt(command, {
      ...options,
      forceFreshSession,
    });

    if (shouldRetryResumeAsFreshSession(command, forceFreshSession, result)) {
      continue;
    }

    for (const event of result.events) {
      yield event;
    }
    return;
  }
}

async function runClaudeCodeCliAttempt(
  command: StartRunCommand,
  options: RunClaudeCodeCliOptions & { forceFreshSession: boolean },
): Promise<CliAttemptResult> {
  const workspace = prepareWorkspace(command.session);
  const spawner = options.spawner ?? spawn;
  const tempDir = await mkdtemp(join(tmpdir(), "slei-claude-mcp-"));
  const mcpConfigPath = join(tempDir, "mcp-config.json");
  const events: RuntimeEvent[] = [];
  let emittedTerminalEvent = false;
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

    const lineEvents = collectStdoutEvents(command, child);
    const exit = waitForChildExit(child);
    const [stdoutResult, exitResult] = await Promise.allSettled([lineEvents, exit]);

    if (stdoutResult.status === "fulfilled") {
      for (const event of stdoutResult.value) {
        events.push(event);
        if (isTerminalEvent(event)) {
          emittedTerminalEvent = true;
        }
      }
    } else {
      return {
        events: [
          {
            type: "failed",
            runId: command.run_id,
            message: cliErrorMessage(stdoutResult.reason, stderr),
          },
        ],
        failedBeforeAnyEvent: events.length === 0,
      };
    }

    if (exitResult.status === "rejected") {
      return {
        events: [
          {
            type: "failed",
            runId: command.run_id,
            message: cliErrorMessage(exitResult.reason, stderr),
          },
        ],
        failedBeforeAnyEvent: events.length === 0,
      };
    }

    if (exitResult.value !== 0 && !emittedTerminalEvent) {
      return {
        events: [
          {
            type: "failed",
            runId: command.run_id,
            message: cliErrorMessage(new Error(`Claude CLI exited with code ${exitResult.value}`), stderr),
          },
        ],
        failedBeforeAnyEvent: events.length === 0,
      };
    }

    if (!emittedTerminalEvent) {
      events.push({ type: "completed", runId: command.run_id });
      emittedTerminalEvent = true;
    }

    return {
      events,
      failedBeforeAnyEvent: false,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildSleiMcpConfig(input: SleiMcpConfigInput) {
  return {
    mcpServers: {
      slei: {
        type: "stdio",
        command: "node",
        args: [input.serverPath],
        env: {
          SLEI_RUN_ID: input.runId,
          SLEI_AGENT_ID: input.agentId,
        },
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
    return streamEventToRuntimeEvents(runId, event);
  }

  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }

  return message.content.flatMap((part) => contentPartToRuntimeEvents(runId, agentId, part));
}

function allowedTools(): string[] {
  return [
    ...READ_ONLY_ALLOWED_TOOLS,
    ...SLEI_PRODUCT_TOOL_NAMES.map((name) => toSleiMcpToolName(name)),
  ];
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

function streamEventToRuntimeEvents(runId: string, event: Record<string, unknown>): RuntimeEvent[] {
  const streamEvent = event.event;
  if (!isRecord(streamEvent)) {
    return [];
  }

  const delta = streamEvent.delta;
  if (
    streamEvent.type === "content_block_delta" &&
    isRecord(delta) &&
    delta.type === "text_delta" &&
    typeof delta.text === "string"
  ) {
    return [
      {
        type: "assistant",
        runId,
        message: { content: [{ type: "text", text: delta.text }] },
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

async function collectStdoutEvents(
  command: StartRunCommand,
  child: ChildProcessWithoutNullStreams,
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    events.push(...cliJsonLineToRuntimeEvents(command.run_id, command.session.agent_id, line));
  }
  return events;
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
    result.failedBeforeAnyEvent
  );
}

function isTerminalEvent(event: RuntimeEvent): boolean {
  return event.type === "completed" || event.type === "failed";
}

function sleiMcpServerPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "mcp-server.js");
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
  events: RuntimeEvent[];
  failedBeforeAnyEvent: boolean;
};
