# ADR 0001: Runtime Adapter And Process Boundaries

## Status

Accepted for MVP.

## Context

Slei is a local-first desktop product with a React/Tauri UI, an independent
Rust daemon and runtime-specific workers. The MVP supports Claude Code through
`@anthropic-ai/claude-agent-sdk`.

## Decision

- The Rust daemon remains the authoritative local control plane and is
  independently launchable.
- The Tauri Rust broker, not Webview JavaScript, owns daemon credentials and
  HTTP/WebSocket transport.
- The Claude SDK runs inside a daemon-managed TypeScript Worker.
- Desktop cannot call runtime workers directly.
- Claude MVP uses Slei-owned reconstructed context with SDK transcript
  persistence/resume disabled to meet deletion semantics.
- OpenCode is the first planned expansion adapter.
- Codex requires an app-server approval spike before native integration.
- MVP packaging must validate Worker launch without requiring a developer Node
  installation.

## Consequences

Runtime-specific APIs stay behind worker/adapter boundaries. Product services,
approval policy and storage remain daemon-owned, so future runtimes cannot leak
provider assumptions into the Desktop contract.
