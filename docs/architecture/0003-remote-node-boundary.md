# ADR 0003: Future Remote Node Boundary

## Status

Proposed after MVP. Not implemented in the local MVP.

## Context

Slei MVP runs the Desktop UI, Rust daemon and Claude Worker locally. A later
deployment may connect a local or remote daemon to a cloud Web UI or API using
an npm-launched entrypoint such as:

```bash
npx @slei-ai/daemon@latest --server-url <url> --api-key <secret>
```

## Decision

- MVP ships no cloud control route, no remote pairing endpoint and no daemon
  auto-registration behavior.
- Future remote nodes use outbound-only authenticated transport from daemon to
  server. The Desktop/Web UI never receives daemon bearer tokens directly.
- API keys are stored by the daemon credential store with owner-only file
  permissions and are revocable from the server.
- Pairing requires explicit user action on the device and creates a node record
  with revocation and rotation metadata.
- Sync-eligible data is limited to metadata needed for routing and visibility:
  node identity, runtime readiness, channel/task membership, sanitized status
  and explicit user-approved events.
- Non-sync data by default: raw prompts, output deltas, deleted message bodies,
  local file paths, environment variables, runtime credentials and approval
  secrets.

## Consequences

The npm package can reuse the Rust daemon core, but the MVP remains local-only.
Any cloud transport must pass the same deletion, approval, artifact and
diagnostic redaction gates before it can be enabled.

