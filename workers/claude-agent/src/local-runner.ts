import { readFileSync } from "node:fs";

import { mapClaudeSdkEvent } from "./events";
import type { StartRunCommand } from "./protocol";
import { runClaudeCode } from "./worker";

const raw = readFileSync(0, "utf8");
const command = JSON.parse(raw) as StartRunCommand;

try {
  for await (const event of runClaudeCode(command)) {
    process.stdout.write(`${JSON.stringify(mapClaudeSdkEvent(event))}\n`);
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
