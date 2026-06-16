# ADR 0002: Claude Worker Packaging Spike

## Status

Accepted for MVP.

> Update 2026-06-16: Claude Code execution now uses the Claude CLI worker path
> described in ADR 0005. This ADR remains historical packaging context; current
> runtime execution is spawn Claude CLI, not SDK `query()`.

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
- `sdk_failed`: Worker launched but runtime initialization failed. The status
  name is retained for compatibility with the daemon readiness enum; current
  runtime execution is Claude CLI.
- `auth_missing`: Claude authentication is unavailable.

运行时执行合同：

- daemon 仍只启动打包后的 Worker，不直接从产品服务调用 Claude CLI。
- Worker 收到 private RPC `start_run` 后，按 ADR 0005 的规则 spawn Claude CLI。
- `input.system_prompt` 由 daemon 生成并通过 `--append-system-prompt` 注入。
- CLI stdout 的 `stream-json` 被 Worker 归一化为稳定 daemon runtime events。
- Worker health 只证明 artifact 可启动和运行时依赖可用，不承担频道路由、claim
  或任务判断。

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

2026-06-16 后，release packaging 需要验证的是 Claude CLI worker path：打包
artifact 能启动、能执行 `--slei-worker-health`、能 spawn `claude`、能加载 Slei MCP
server，并能把 CLI stream-json 事件转换为 daemon runtime events。
