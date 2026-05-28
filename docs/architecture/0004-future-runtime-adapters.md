# ADR 0004: Future Runtime Adapter Expansion

## Status

Proposed after MVP. OpenCode and Codex discriminants are contract-only until an
installed adapter reports readiness.

## Decision

Adapter expansion order:

1. OpenCode first after MVP, through `@opencode-ai/sdk` server/client APIs and
   its permission endpoints.
2. Native Codex only after a spike verifies `codex app-server` command/file
   approval behavior against Slei's visible approval UI and deletion semantics.
   `@openai/codex-sdk` may be used for basic thread execution if it satisfies
   the same boundaries.
3. CLI text or JSON parsing is a fallback only when no official programmatic
   interface exists.

## Guardrails

- `RuntimeKind::OpenCode` and `RuntimeKind::Codex` may serialize in contracts,
  but no daemon route or UI action treats them as runnable unless
  `AdapterReadiness::Installed` is reported.
- Runtime capability flags describe possible behavior, not permission to run.
- Product tools, approval decisions, visible delegation and artifact metadata
  remain Slei-owned contracts independent of provider APIs.
- Runtime-native hidden delegation, unregistered plugins/MCP servers and
  provider filesystem settings remain disabled unless explicitly mapped into a
  Slei-visible event.

## Consequences

Future adapters can be added without changing the Desktop contract, and the MVP
does not imply support for OpenCode or Codex execution before adapter readiness
is actually implemented and tested.
