import { readFileSync } from "node:fs";

import { mapRuntimeEvent } from "./events.js";
import type { StartRunCommand } from "./protocol.js";
import { runClaudeCode } from "./worker.js";

const raw = readFileSync(0, "utf8");
const command = JSON.parse(raw) as StartRunCommand;

try {
  for await (const event of runClaudeCode(command)) {
    process.stdout.write(`${JSON.stringify(mapRuntimeEvent(event))}\n`);
  }
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      type: "failed",
      run_id: command.run_id,
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
}
