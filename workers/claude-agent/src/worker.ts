import { spawn } from "node:child_process";

import { mapClaudeSdkEvent, type ClaudeSdkEvent } from "./events";
import type { StartRunCommand, WorkerCommand, WorkerEvent } from "./protocol";

export type WorkerIO = {
  writeEvent(event: WorkerEvent): void;
};

export type RuntimeRunner = (command: StartRunCommand) => AsyncIterable<ClaudeSdkEvent>;

export class ClaudeAgentWorker {
  #authorized = false;

  constructor(
    private readonly launchSecret: string,
    private readonly io: WorkerIO,
    private readonly runner: RuntimeRunner = runClaudeCode,
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

    if (command.type === "cancel") {
      this.io.writeEvent({ type: "completed", run_id: command.run_id });
    }
  }

  private async startRun(command: StartRunCommand): Promise<void> {
    try {
      for await (const event of this.runner(command)) {
        this.io.writeEvent(mapClaudeSdkEvent(event));
      }
    } catch (error) {
      this.io.writeEvent({
        type: "failed",
        run_id: command.run_id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function* runClaudeCode(command: StartRunCommand): AsyncIterable<ClaudeSdkEvent> {
  const child = spawn("claude", buildClaudeCliArgs(command), {
    cwd: command.session.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  for await (const chunk of child.stdout) {
    if (chunk) {
      yield {
        type: "assistant",
        runId: command.run_id,
        message: { content: [{ type: "text", text: String(chunk) }] },
      };
    }
  }

  const code = await new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });

  if (code === 0) {
    yield { type: "completed", runId: command.run_id };
  } else {
    yield {
      type: "failed",
      runId: command.run_id,
      message: stderr.trim() || `claude exited with code ${code}`,
    };
  }
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
