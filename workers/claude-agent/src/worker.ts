import { spawn } from "node:child_process";

import { mapRuntimeEvent, type RuntimeEvent } from "./events.js";
import { runClaudeCodeCli } from "./claude-cli.js";
import type { ClearSessionCommand, StartRunCommand, WorkerCommand, WorkerEvent } from "./protocol.js";

export type WorkerIO = {
  writeEvent(event: WorkerEvent): void;
};

export type RuntimeRunner = (command: StartRunCommand) => AsyncIterable<RuntimeEvent>;
export type RuntimeClearer = (command: ClearSessionCommand) => Promise<void>;

const defaultRuntimeRunner: RuntimeRunner = (command) => runClaudeCode(command);

export class ClaudeAgentWorker {
  #authorized = false;

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
      return;
    }
  }

  private async startRun(command: StartRunCommand): Promise<void> {
    try {
      for await (const event of this.runner(command)) {
        this.io.writeEvent(mapRuntimeEvent(event));
      }
    } catch (error) {
      this.io.writeEvent({
        type: "failed",
        run_id: command.run_id,
        message: error instanceof Error ? error.message : String(error),
      });
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

export async function* runClaudeCode(command: StartRunCommand): AsyncIterable<RuntimeEvent> {
  yield* runClaudeCodeCli(command);
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
