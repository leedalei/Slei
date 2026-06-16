import type { RuntimeEvent } from "./events.js";
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
      command.session.resume_session ? "--resume" : "--session-id",
      command.session.session_id,
    );
  } else {
    args.push("--no-session-persistence");
  }

  args.push(command.input.prompt);
  return args;
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
