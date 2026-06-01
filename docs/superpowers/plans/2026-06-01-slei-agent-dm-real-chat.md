# Slei Agent DM Real Chat Plan

**Goal:** Make the main Agent direct-message path real: when a human sends a message in an Agent DM, the daemon starts a local ClaudeCode worker run in that Agent's workspace, stores the Agent response back into the same conversation, and the desktop timeline refreshes to show running/done/failed states.

**Scope:** This plan intentionally excludes attachments, cache cleanup settings, and interactive human-question cards. Those remain in the broader complete Agent DM plan.

## Implementation Checklist

- [x] Add focused daemon coverage proving Agent DMs emit a worker `start_run` command with the human prompt, conversation context, and Agent workspace cwd.
- [x] Add daemon event coverage proving `output_delta`, `completed`, and `failed` update one assistant message in the same DM via `runId` and `status`.
- [x] Add an `AgentDmService` that only triggers for human-authored `dm` conversations targeting a Product Agent.
- [x] Extend conversation messages with optional `runId` and `status` metadata while preserving existing message JSON shape.
- [x] Implement worker `start_run` handling behind hello authorization and map Claude runtime output into worker events.
- [x] Keep desktop optimistic human sends, then refresh conversation messages and poll active running DMs until terminal status.
- [x] Render running/done/failed Agent message status badges in desktop tests.
- [x] Wire the local Tauri daemon broker fallback so desktop DM sends can execute a local Claude CLI call even when the HTTP daemon is not launched.
- [x] Restore daemon full-test health by mounting the existing task API routes expected by task tests.

## Verification

- [x] `cargo test -p slei-daemon`
- [x] `pnpm --filter @slei/claude-agent test`
- [x] `pnpm --filter @slei/desktop test`
- [x] `pnpm --filter @slei/desktop typecheck`
- [x] `cargo test -p slei-desktop`

## Notes

- The worker default runtime uses the local `claude` CLI with `-p` and `--output-format text`, and tests inject a fake runner so CI does not require Claude auth.
- The Tauri local broker test path returns an empty successful response to avoid shelling out during unit tests; non-test desktop builds call the same local Claude CLI in the Agent workspace.
- The broader `2026-05-29-slei-complete-agent-dm.md` plan still tracks future Markdown rendering depth, attachments, interactive questions, and cleanup preferences.
