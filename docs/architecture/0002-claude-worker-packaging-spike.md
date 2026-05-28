# ADR 0002: Claude Worker Packaging Spike

## Status

Accepted for MVP.

## Decision

Slei daemon launches a packaged standalone Worker artifact by absolute path and
checks readiness with `--slei-worker-health`. The health command must run with a
clean `HOME` and `PATH`, so the daemon never relies on the developer's Node.js
installation. The probe returns one JSON object:

```json
{"status":"ready","version":"0.1.0","runtime":"standalone"}
```

The daemon distinguishes:

- `ready`: artifact is launchable and the Worker can accept private RPC.
- `missing_worker`: artifact path does not exist.
- `sdk_failed`: Worker launched but SDK/runtime initialization failed.
- `auth_missing`: Claude authentication is unavailable.

## Rationale

The product needs local MVP behavior that can later be reused by an npm package
or a remote daemon. A standalone artifact keeps the Tauri app, daemon and future
`@slei-ai/daemon` package independent from a user's shell profile, `npx`, Node
version manager or development-only PATH.

## Rejected Options

- Use `node workers/claude-agent/src/index.ts` from the developer checkout:
  fails clean-install requirements and leaks local toolchain assumptions.
- Download/install Node during daemon startup: increases signing, update and
  support scope and is not acceptable for a local-first MVP.
- Call Claude CLI directly for Worker health: bypasses the private Worker RPC
  contract and cannot prove Slei-owned context reconstruction or approvals.

## Signing And Update Scope

The standalone artifact is part of the signed daemon distribution. Updates must
replace the artifact atomically with the daemon version that understands its RPC
contract. The descriptor exposed to the Tauri broker contains readiness and
version only, never tokens or Claude credentials.

## Follow-Ups

Validate the final artifact technology against `@anthropic-ai/claude-agent-sdk`
before release packaging. If the SDK cannot run inside the chosen standalone
runtime, this ADR must be revised before runtime-backed MVP work proceeds.
