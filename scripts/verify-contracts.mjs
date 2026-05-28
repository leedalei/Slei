import fs from "node:fs";

const adapter = fs.readFileSync("crates/adapter-api/src/lib.rs", "utf8");
const remoteAdr = fs.readFileSync("docs/architecture/0003-remote-node-boundary.md", "utf8");
const runtimeAdr = fs.readFileSync("docs/architecture/0004-future-runtime-adapters.md", "utf8");

const required = [
  "RuntimeAdapterDescriptor",
  "AdapterReadiness",
  "OpenCode",
  "Codex",
  "can_start_runs",
];
for (const marker of required) {
  if (!adapter.includes(marker)) {
    throw new Error(`adapter contract missing ${marker}`);
  }
}

if (!remoteAdr.includes("Not implemented in the local MVP")) {
  throw new Error("remote boundary ADR must mark cloud behavior out of MVP");
}
if (!runtimeAdr.includes("contract-only")) {
  throw new Error("runtime ADR must keep OpenCode/Codex inactive until readiness");
}

console.log("contracts verified");
