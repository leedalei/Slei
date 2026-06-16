# ADR 0001: Runtime Adapter And Process Boundaries

## Status

Accepted for MVP.

> Update 2026-06-16: Claude Code execution now uses the daemon-managed Claude
> CLI worker path described in ADR 0005. This ADR remains historical boundary
> context for the original MVP adapter split.

## Context

Slei is a local-first desktop product with a React/Tauri UI, an independent
Rust daemon and runtime-specific workers. The MVP supports Claude Code through
`@anthropic-ai/claude-agent-sdk`.

2026-06-16 后，Claude Code 的当前执行路径已从 SDK `query()` 迁移为 worker
spawn Claude CLI。daemon 仍是控制面，worker 仍是 runtime 边界；变化的是
worker 内部执行实现和 system prompt 注入方式。当前合同以 ADR 0005 为准。

## Decision

- The Rust daemon remains the authoritative local control plane and is
  independently launchable.
- The Tauri Rust broker, not Webview JavaScript, owns daemon credentials and
  HTTP/WebSocket transport.
- Historical MVP path: the Claude SDK runs inside a daemon-managed TypeScript
  Worker. Current path: the daemon-managed Worker spawns Claude CLI and receives
  daemon-generated `input.system_prompt`.
- Desktop cannot call runtime workers directly.
- Claude MVP uses Slei-owned reconstructed context. The current CLI path keeps
  channel broadcast/task handoff `input.prompt` scoped to the triggering message
  and relies on Slei CLI history reads instead of injecting full transcript
  context.
- OpenCode is the first planned expansion adapter.
- Codex requires an app-server approval spike before native integration.
- MVP packaging must validate Worker launch without requiring a developer Node
  installation.

## Consequences

Runtime-specific APIs stay behind worker/adapter boundaries. Product services,
approval policy and storage remain daemon-owned, so future runtimes cannot leak
provider assumptions into the Desktop contract.
