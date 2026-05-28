import type { WorkerCommand, WorkerEvent } from "./protocol";

export type WorkerIO = {
  writeEvent(event: WorkerEvent): void;
};

export class ClaudeAgentWorker {
  #authorized = false;

  constructor(
    private readonly launchSecret: string,
    private readonly io: WorkerIO,
  ) {}

  handleCommand(command: WorkerCommand): void {
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

    if (command.type === "cancel") {
      this.io.writeEvent({ type: "completed", run_id: command.run_id });
    }
  }
}
