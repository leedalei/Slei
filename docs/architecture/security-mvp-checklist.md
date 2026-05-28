# Slei MVP Security Checklist

## Evidence Commands

- `cargo test -p slei-daemon --test security_regression --test recovery`
- `pnpm --filter @slei/desktop test:e2e -- accessibility.spec.ts`

## Covered Gates

- Workspace symlink and path traversal escape is rejected before execution.
- Hidden/freeform delegation is rejected; visible typed/user mention handoff is required.
- Approval decisions are correlated by request, run, tool and agent.
- Mutation retries use idempotency keys and do not duplicate message-triggered runs.
- Deleted human message bodies are absent from events, reconstructed context and subsequent run context.
- Artifact opening requires daemon artifact IDs and never accepts raw local paths.
- Diagnostic exports strip tokens, absolute paths, request bodies and output deltas.
- Notification summaries redact sensitive workspace path details.
- Desktop surfaces expose bilingual, keyboard-readable MVP labels for primary flows.
