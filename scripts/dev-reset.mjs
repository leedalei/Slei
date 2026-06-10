#!/usr/bin/env node

const endpoint = process.env.SLEI_DAEMON_ENDPOINT ?? "http://127.0.0.1:4319";
const token = process.env.SLEI_DAEMON_TOKEN ?? "desktop-session-token";

if (process.argv.includes("--help")) {
  console.log("Usage: SLEI_ENABLE_DEV_RESET=1 pnpm dev:reset");
  console.log("Calls POST /v1/dev/reset on the local Slei daemon.");
  console.log("Overrides: SLEI_DAEMON_ENDPOINT, SLEI_DAEMON_TOKEN.");
  process.exit(0);
}

if (process.env.SLEI_ENABLE_DEV_RESET !== "1") {
  console.error("Refusing to reset: set SLEI_ENABLE_DEV_RESET=1");
  process.exit(2);
}

try {
  const response = await fetch(`${endpoint}/v1/dev/reset`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(text);
    process.exit(1);
  }

  console.log(text);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to contact Slei daemon at ${endpoint}: ${message}`);
  process.exit(1);
}
