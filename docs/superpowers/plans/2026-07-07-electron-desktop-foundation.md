# Electron Desktop Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tauri desktop launch path with an Electron main/preload foundation that starts or connects the local Slei daemon, exposes a typed RPC bridge to the renderer, forwards daemon events, and preserves the current core product loop.

**Architecture:** Electron main replaces the Tauri Rust broker, not the daemon. Electron main owns the daemon endpoint/token, lifecycle, HTTP calls, avatar protocol, and event forwarding; preload exposes a narrow `window.slei` API; React keeps using `DaemonBridge` so feature components stay focused on daemon data. V1 keeps Tauri files present for reference but removes Tauri from the active `desktop` command path.

**Tech Stack:** Electron 43.0.0, React 19, Vite 7, Vitest, TypeScript, Rust daemon HTTP API, pnpm workspace.

---

## Scope Check

The spec covers one implementation unit: the Electron desktop foundation for V1. Packaging, signing, Tauri physical deletion, full macOS visual parity, and production daemon binary distribution stay in V2.

Although V1 acceptance focuses on daemon status, channels, channel messages, sending a message, events, logging, and avatar protocol, the renderer boot path already calls many `DaemonBridge` methods. Therefore the implementation should port the full current `DaemonBridge` method table mechanically to typed RPC where practical, while tests focus heavily on the V1 core loop.

## Relevant References

- Spec: `docs/superpowers/specs/2026-07-07-electron-desktop-foundation-design.md`
- Architecture guardrails: `docs/architecture/0001-runtime-adapter-and-process-boundaries.md`
- Channel routing guardrails: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Task/card guardrails: `docs/architecture/0006-task-source-message-card.md`
- Known daemon/worker env pitfall: `docs/knowledge/runtime-errors/channel-agent-broadcast-no-reply-20260617.md`
- Known full-chain product tool pitfall: `docs/knowledge/runtime-errors/createchannel-product-tool-card-rejected-20260624.md`

## File Structure

Create focused Electron files under `apps/desktop/src/electron/`:

- `apps/desktop/src/electron/constants.ts`: dev ports, endpoint, token, paths, timing constants.
- `apps/desktop/src/electron/daemon-http.ts`: authenticated HTTP client and typed error wrapper.
- `apps/desktop/src/electron/daemon-lifecycle.ts`: port check, daemon spawn, ready wait, owned-process cleanup.
- `apps/desktop/src/electron/daemon-rpc.ts`: RPC method to daemon HTTP/shell handler mapping.
- `apps/desktop/src/electron/event-forwarder.ts`: daemon event replay polling and renderer fan-out.
- `apps/desktop/src/electron/avatar-protocol.ts`: safe `slei-avatar` protocol handling.
- `apps/desktop/src/electron/main.ts`: Electron app bootstrap, BrowserWindow, IPC registration.
- `apps/desktop/src/electron/preload.ts`: context-isolated `window.slei` API.
- `apps/desktop/src/electron/global.d.ts`: renderer-visible `window.slei` type.

Shared renderer contract files:

- `apps/desktop/src/lib/daemon-types.ts`: type-only DTOs moved out of `daemon-bridge.ts`.
- `apps/desktop/src/lib/desktop-rpc.ts`: `DesktopRpcMethod`, request/response maps, typed client helpers.
- `apps/desktop/src/lib/daemon-bridge.ts`: keep `DaemonBridge`, offline bridge, and implement Electron adapter.
- `apps/desktop/src/lib/frontend-crash-logging.ts`: send crash logs through desktop RPC instead of Tauri invoke.
- `apps/desktop/src/test/daemon-bridge-mock.ts`: add daemon-state listener support for renderer recovery tests.

Config and scripts:

- `apps/desktop/package.json`: add Electron dependency and scripts.
- `apps/desktop/tsconfig.json`: include Electron and global type files.
- `apps/desktop/tsconfig.electron.json`: compile Electron main/preload to `dist-electron`.
- `apps/desktop/scripts/desktop-dev.sh`: build worker/CLI/daemon, start Vite dev server, build Electron main/preload, run Electron.
- `apps/desktop/vite.config.ts`: keep strict dev port `127.0.0.1:1420`.

Tests:

- `apps/desktop/src/electron/daemon-lifecycle.test.ts`
- `apps/desktop/src/electron/daemon-http.test.ts`
- `apps/desktop/src/electron/daemon-rpc.test.ts`
- `apps/desktop/src/electron/event-forwarder.test.ts`
- `apps/desktop/src/electron/avatar-protocol.test.ts`
- `apps/desktop/src/electron/preload.test.ts`
- `apps/desktop/src/lib/desktop-rpc.test.ts`
- `apps/desktop/src/lib/daemon-bridge.test.ts`
- `apps/desktop/e2e/startup.spec.ts`
- Existing DOM/interaction tests under `apps/desktop/e2e/*.spec.ts(x)` and `apps/desktop/src/app/*.test.ts(x)`.

## Method Mapping Notes

Use daemon routes from `crates/slei-daemon/src/app.rs`. V1 must include at least:

| RPC method | Daemon route |
| --- | --- |
| `daemon.status` | `GET /health` |
| `diagnostics.list` | `GET /v1/diagnostics` |
| `nodes.list` | `GET /v1/nodes` |
| `channels.list` | `GET /v1/channels` |
| `channels.create` | `POST /v1/channels` |
| `channels.messages.list` | `GET /v1/channels/{id}/messages` |
| `channels.messages.send` | `POST /v1/channels/{id}/messages` |
| `tasks.list` | `GET /v1/tasks` |
| `events.reconnect` | `GET /v1/events/ws?after={sequence}` |
| `daemon.state` | Electron main state notification, no daemon route |
| `frontend.crash.log` | Electron main stderr initially |
| `frontend.event.log` | Electron main stderr initially |

Also map renderer boot methods from `SleiApp.tsx`: preferences, saved messages, profile, guide bootstrap, agents, conversations, agent role presets, and global search. Use existing Tauri command names only as a reference; new RPC names should be domain names such as `preferences.list`, `profile.list`, `agents.list`, `conversations.list`, `search.global`.

## Task 1: Add Electron Dependency And Build Scripts

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.electron.json`
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/scripts/desktop-dev.sh`
- Test: `apps/desktop/e2e/startup.spec.ts`

- [ ] **Step 1: Write failing startup contract tests**

Update `apps/desktop/e2e/startup.spec.ts` so the dev startup contract expects Electron, not Tauri:

```ts
it("starts Vite and then launches Electron in dev", async () => {
  const packageJson = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const desktopDevScript = await readFile(join(desktopRoot, "scripts/desktop-dev.sh"), "utf8");

  expect(packageJson.devDependencies?.electron).toBe("43.0.0");
  expect(packageJson.scripts?.desktop).toBe("scripts/desktop-dev.sh");
  expect(packageJson.scripts?.["build:electron"]).toBe("tsc -p tsconfig.electron.json");
  expect(desktopDevScript).toContain("pnpm dev");
  expect(desktopDevScript).toContain("pnpm build:electron");
  expect(desktopDevScript).toContain("electron dist-electron/main.js");
  expect(desktopDevScript).not.toContain("tauri dev");
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm --filter @slei/desktop test -- e2e/startup.spec.ts`

Expected: FAIL because `electron` and `build:electron` are missing and script still contains `tauri dev`.

- [ ] **Step 3: Add Electron package scripts**

Modify `apps/desktop/package.json`:

```json
{
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 1420",
    "desktop": "scripts/desktop-dev.sh",
    "build": "tsc -p tsconfig.json && vite build",
    "build:electron": "tsc -p tsconfig.electron.json"
  },
  "devDependencies": {
    "electron": "43.0.0"
  }
}
```

Keep existing dependencies and scripts not shown above.

- [ ] **Step 4: Add Electron TypeScript config**

Create `apps/desktop/tsconfig.electron.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": false,
    "lib": ["ESNext", "DOM"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": false,
    "outDir": "dist-electron",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/electron/**/*.ts", "src/lib/daemon-types.ts", "src/lib/desktop-rpc.ts"]
}
```

Modify `apps/desktop/tsconfig.json` include list to include `src/electron/global.d.ts` once that file exists.

- [ ] **Step 5: Replace Tauri dev launch with Vite plus Electron**

Modify `apps/desktop/scripts/desktop-dev.sh` so it still builds worker/CLI/daemon first, then starts Vite in the background, compiles Electron main/preload, and runs Electron. Keep cleanup robust:

```sh
VITE_PID=""

cleanup() {
  if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}

cd "$DESKTOP_ROOT"
pnpm dev &
VITE_PID=$!

attempts=0
until nc -z 127.0.0.1 1420 2>/dev/null; do
  # same timeout pattern as daemon wait
done

pnpm build:electron
electron dist-electron/main.js
```

Do not keep the script-level daemon spawn in final V1 if Electron main owns daemon lifecycle. During the transition, remove the old `cargo run -p slei-daemon &` block after Task 3 introduces main-owned lifecycle.

- [ ] **Step 6: Install dependencies and run startup tests**

Run: `pnpm install`

Run: `pnpm --filter @slei/desktop test -- e2e/startup.spec.ts`

Expected: PASS for updated startup contract once placeholder Electron files exist in later tasks. If it fails because `dist-electron/main.js` is not yet created, proceed to Task 2 before committing.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/tsconfig.electron.json apps/desktop/scripts/desktop-dev.sh apps/desktop/e2e/startup.spec.ts pnpm-lock.yaml
git commit -m "build(desktop): add electron dev entry"
```

## Task 2: Define Shared Types And Typed RPC Contract

**Files:**
- Create: `apps/desktop/src/lib/daemon-types.ts`
- Create: `apps/desktop/src/lib/desktop-rpc.ts`
- Create: `apps/desktop/src/lib/desktop-rpc.test.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`

- [ ] **Step 1: Write failing RPC contract tests**

Create `apps/desktop/src/lib/desktop-rpc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDesktopRpcClient, desktopRpcMethods } from "./desktop-rpc";

describe("desktop rpc contract", () => {
  it("lists V1 core method names", () => {
    expect(desktopRpcMethods).toEqual(expect.arrayContaining([
      "daemon.status",
      "diagnostics.list",
      "nodes.list",
      "channels.list",
      "channels.messages.list",
      "channels.messages.send",
      "tasks.list",
      "events.reconnect",
      "frontend.crash.log",
      "frontend.event.log",
    ]));
  });

  it("calls the injected transport with method and payload", async () => {
    const call = vi.fn().mockResolvedValue({ channels: [] });
    const client = createDesktopRpcClient({ call });

    await expect(client.call("channels.list", {})).resolves.toEqual({ channels: [] });
    expect(call).toHaveBeenCalledWith("channels.list", {});
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm --filter @slei/desktop test -- src/lib/desktop-rpc.test.ts`

Expected: FAIL because `desktop-rpc.ts` does not exist.

- [ ] **Step 3: Extract daemon DTOs**

Create `apps/desktop/src/lib/daemon-types.ts` and move type exports from the top of `daemon-bridge.ts` into it. Keep the file type-only: no Tauri, Electron, DOM runtime, or mock imports.

Minimum exported types needed by Task 2:

```ts
export type SanitizedDaemonStatus = {
  connected: boolean;
  label: string;
  daemonVersion: string;
  protocolVersion: string;
};

export type EventReconnectReceipt = {
  after: number;
  events: DaemonEventView[];
};

export type DaemonEventView = {
  sequence: number;
  eventType: string;
  occurredAtUnixMs: number;
  payload: unknown;
};

export type DaemonConnectionState =
  | { state: "starting" }
  | { state: "connected" }
  | { state: "offline"; code: "daemon_unavailable" | "daemon_auth_failed" | "daemon_start_timeout" };
```

Continue moving the existing DTOs used by `DaemonBridge` so `daemon-bridge.ts` can re-export them from `daemon-types.ts`.

- [ ] **Step 4: Implement the typed RPC client**

Create `apps/desktop/src/lib/desktop-rpc.ts`:

```ts
import type {
  ChannelListReceipt,
  ChannelMessageListReceipt,
  DaemonConnectionState,
  DiagnosticsSnapshotView,
  EventReconnectReceipt,
  NodeListReceipt,
  SanitizedDaemonStatus,
  SendChannelMessageReceipt,
  SendChannelMessageRequest,
  TaskListQuery,
  TaskListReceipt,
} from "./daemon-types";

export const desktopRpcMethods = [
  "daemon.status",
  "diagnostics.list",
  "nodes.list",
  "channels.list",
  "channels.messages.list",
  "channels.messages.send",
  "tasks.list",
  "events.reconnect",
  "frontend.crash.log",
  "frontend.event.log",
] as const;

export type DesktopRpcMethod = typeof desktopRpcMethods[number] | string;

export type DesktopRpcRequestMap = {
  "daemon.status": Record<string, never>;
  "diagnostics.list": Record<string, never>;
  "nodes.list": Record<string, never>;
  "channels.list": Record<string, never>;
  "channels.messages.list": { channelId: string; query?: unknown };
  "channels.messages.send": { channelId: string; request: SendChannelMessageRequest };
  "tasks.list": { query: TaskListQuery };
  "events.reconnect": { after: number };
  "frontend.crash.log": { report: unknown };
  "frontend.event.log": { report: unknown };
};

export type DesktopRpcResponseMap = {
  "daemon.status": SanitizedDaemonStatus;
  "diagnostics.list": DiagnosticsSnapshotView;
  "nodes.list": NodeListReceipt;
  "channels.list": ChannelListReceipt;
  "channels.messages.list": ChannelMessageListReceipt;
  "channels.messages.send": SendChannelMessageReceipt;
  "tasks.list": TaskListReceipt;
  "events.reconnect": EventReconnectReceipt;
  "frontend.crash.log": void;
  "frontend.event.log": void;
};

export type DesktopEventMap = {
  "daemon.events": EventReconnectReceipt;
  "daemon.state": DaemonConnectionState;
};

export type DesktopRpcTransport = {
  call(method: string, payload: unknown): Promise<unknown>;
};

export function createDesktopRpcClient(transport: DesktopRpcTransport) {
  return {
    call<M extends keyof DesktopRpcRequestMap>(
      method: M,
      payload: DesktopRpcRequestMap[M],
    ): Promise<DesktopRpcResponseMap[M]> {
      return transport.call(method, payload) as Promise<DesktopRpcResponseMap[M]>;
    },
  };
}
```

Expand maps as more `DaemonBridge` methods are migrated.

- [ ] **Step 5: Re-export types from daemon bridge**

Modify `apps/desktop/src/lib/daemon-bridge.ts`:

```ts
export type {
  SanitizedDaemonStatus,
  NodeListReceipt,
  // all moved DTOs
} from "./daemon-types";
```

Remove duplicated type declarations only after all imports compile.

- [ ] **Step 6: Run targeted tests**

Run: `pnpm --filter @slei/desktop test -- src/lib/desktop-rpc.test.ts src/lib/daemon-bridge.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/lib/daemon-types.ts apps/desktop/src/lib/desktop-rpc.ts apps/desktop/src/lib/desktop-rpc.test.ts apps/desktop/src/lib/daemon-bridge.ts
git commit -m "feat(desktop): add typed rpc contract"
```

## Task 3: Implement Electron Daemon HTTP Client And RPC Mapping

**Files:**
- Create: `apps/desktop/src/electron/constants.ts`
- Create: `apps/desktop/src/electron/daemon-http.ts`
- Create: `apps/desktop/src/electron/daemon-http.test.ts`
- Create: `apps/desktop/src/electron/daemon-rpc.ts`
- Create: `apps/desktop/src/electron/daemon-rpc.test.ts`

- [ ] **Step 1: Write failing HTTP client tests**

Create `apps/desktop/src/electron/daemon-http.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDaemonHttpClient } from "./daemon-http";

describe("daemon http client", () => {
  it("sends the desktop bearer token and parses JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
      text: async () => "",
    });

    const client = createDaemonHttpClient({
      endpoint: "http://127.0.0.1:4319",
      token: "desktop-session-token",
      fetchImpl,
    });

    await expect(client.request("GET", "/health")).resolves.toEqual({ status: "ok" });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:4319/health", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer desktop-session-token" }),
    }));
  });

  it("maps unauthorized responses to daemon_auth_failed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "nope" });
    const client = createDaemonHttpClient({ endpoint: "http://127.0.0.1:4319", token: "bad", fetchImpl });

    await expect(client.request("GET", "/v1/nodes")).rejects.toMatchObject({ code: "daemon_auth_failed" });
  });
});
```

- [ ] **Step 2: Run failing HTTP tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/daemon-http.test.ts`

Expected: FAIL because client does not exist.

- [ ] **Step 3: Implement constants and HTTP client**

Create `apps/desktop/src/electron/constants.ts`:

```ts
export const DAEMON_HOST = "127.0.0.1";
export const DAEMON_PORT = 4319;
export const DAEMON_ENDPOINT = `http://${DAEMON_HOST}:${DAEMON_PORT}`;
export const DESKTOP_DAEMON_TOKEN = "desktop-session-token";
export const VITE_DEV_URL = "http://127.0.0.1:1420";
export const DAEMON_READY_TIMEOUT_MS = 30_000;
```

Create `apps/desktop/src/electron/daemon-http.ts` with `createDaemonHttpClient`, `DesktopDaemonError`, and `request(method, path, body?)`. Requirements:

- Always include `Authorization: Bearer ${token}`.
- Include `Content-Type: application/json` when body exists.
- Map `401` to `daemon_auth_failed`.
- Map failed fetch to `daemon_unavailable`.
- Map non-2xx to `daemon_http_error`.
- Never include token in thrown error messages.

- [ ] **Step 4: Write failing RPC mapping tests**

Create `apps/desktop/src/electron/daemon-rpc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDaemonRpcHandler } from "./daemon-rpc";

describe("daemon rpc handler", () => {
  it("maps daemon.status to /health and sanitizes status output", async () => {
    const request = vi.fn().mockResolvedValue({
      daemon_version: "0.1.0",
      protocol_version: "2026-05-27",
      status: "ok",
    });
    const rpc = createDaemonRpcHandler({ request } as never);

    await expect(rpc.call("daemon.status", {})).resolves.toEqual({
      connected: true,
      label: "connected",
      daemonVersion: "0.1.0",
      protocolVersion: "2026-05-27",
    });
    expect(request).toHaveBeenCalledWith("GET", "/health");
  });

  it("maps channel message send to the daemon route", async () => {
    const request = vi.fn().mockResolvedValue({ message: { id: "msg_1" }, outcome: { action: "broadcast_delivered" } });
    const rpc = createDaemonRpcHandler({ request } as never);

    await rpc.call("channels.messages.send", {
      channelId: "all",
      request: { authorId: "human:local", body: "hello" },
    });

    expect(request).toHaveBeenCalledWith("POST", "/v1/channels/all/messages", {
      authorId: "human:local",
      body: "hello",
    });
  });
});
```

- [ ] **Step 5: Implement RPC method mapping**

Create `apps/desktop/src/electron/daemon-rpc.ts` with:

```ts
export function createDaemonRpcHandler(client: DaemonHttpClient) {
  return {
    async call(method: string, payload: unknown) {
      switch (method) {
        case "daemon.status":
          return sanitizeHealth(await client.request("GET", "/health"));
        case "diagnostics.list":
          return client.request("GET", "/v1/diagnostics");
        case "nodes.list":
          return client.request("GET", "/v1/nodes");
        case "channels.list":
          return client.request("GET", "/v1/channels");
        case "channels.messages.send":
          return sendChannelMessage(client, payload);
        default:
          throw new DesktopDaemonError("invalid_rpc_method", `Unsupported desktop RPC method: ${method}`);
      }
    },
  };
}
```

Then expand the switch to cover all methods currently used in `createDaemonBridge()` Tauri branch. Build query strings with `URLSearchParams`, and always `encodeURIComponent` path parameters.

- [ ] **Step 6: Run targeted tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/daemon-http.test.ts src/electron/daemon-rpc.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/electron/constants.ts apps/desktop/src/electron/daemon-http.ts apps/desktop/src/electron/daemon-http.test.ts apps/desktop/src/electron/daemon-rpc.ts apps/desktop/src/electron/daemon-rpc.test.ts
git commit -m "feat(desktop): map electron rpc to daemon api"
```

## Task 4: Implement Daemon Lifecycle In Electron Main

**Files:**
- Create: `apps/desktop/src/electron/daemon-lifecycle.ts`
- Create: `apps/desktop/src/electron/daemon-lifecycle.test.ts`
- Modify: `apps/desktop/scripts/desktop-dev.sh`

- [ ] **Step 1: Write failing lifecycle tests**

Create `apps/desktop/src/electron/daemon-lifecycle.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ensureDaemon } from "./daemon-lifecycle";

describe("daemon lifecycle", () => {
  it("connects to an existing compatible daemon without spawning", async () => {
    const spawn = vi.fn();
    const probePort = vi.fn().mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({ status: "ok", daemon_version: "0.1.0", protocol_version: "2026-05-27" });

    await expect(ensureDaemon({ probePort, health, spawn } as never)).resolves.toMatchObject({ owned: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns daemon with token and PATH when the port is free", async () => {
    const spawn = vi.fn().mockReturnValue({ pid: 42, once: vi.fn(), kill: vi.fn() });
    const probePort = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({ status: "ok", daemon_version: "0.1.0", protocol_version: "2026-05-27" });

    await expect(ensureDaemon({ probePort, health, spawn } as never)).resolves.toMatchObject({ owned: true });
    expect(spawn).toHaveBeenCalledWith("cargo", ["run", "-p", "slei-daemon"], expect.objectContaining({
      env: expect.objectContaining({ SLEI_DAEMON_TOKEN: "desktop-session-token" }),
    }));
  });
});
```

- [ ] **Step 2: Run failing lifecycle tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/daemon-lifecycle.test.ts`

Expected: FAIL because lifecycle module does not exist.

- [ ] **Step 3: Implement lifecycle module**

Create `apps/desktop/src/electron/daemon-lifecycle.ts`:

- `probePort(host, port): Promise<boolean>` using `node:net`.
- `waitForDaemonReady({ health, timeoutMs })`.
- `ensureDaemon()`:
  - If port is open, call `/health` using dev token.
  - If health succeeds, return `{ owned: false }`.
  - If unauthorized/incompatible, throw typed `daemon_auth_failed` or `daemon_unavailable`.
  - If port is closed, spawn `cargo run -p slei-daemon` from repo root.
  - Pass `SLEI_DAEMON_URL`, `SLEI_DAEMON_TOKEN`, and prepend repo `target/debug` to PATH.
  - Return `{ owned: true, process }` after ready.
- `stopOwnedDaemon(handle)` kills only owned daemon.

- [ ] **Step 4: Move daemon ownership out of desktop shell script**

Modify `apps/desktop/scripts/desktop-dev.sh`:

- Keep `pnpm --filter @slei/claude-agent build`.
- Keep `cargo build -p slei-cli`.
- Keep `cargo build -p slei-daemon`.
- Remove the old `cargo run -p slei-daemon &` ownership block.
- Let Electron main own daemon spawn/connect.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/daemon-lifecycle.test.ts e2e/startup.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/electron/daemon-lifecycle.ts apps/desktop/src/electron/daemon-lifecycle.test.ts apps/desktop/scripts/desktop-dev.sh apps/desktop/e2e/startup.spec.ts
git commit -m "feat(desktop): manage daemon lifecycle in electron"
```

## Task 5: Add Electron Main, Preload, And Secure Window API

**Files:**
- Create: `apps/desktop/src/electron/main.ts`
- Create: `apps/desktop/src/electron/preload.ts`
- Create: `apps/desktop/src/electron/global.d.ts`
- Create: `apps/desktop/src/electron/preload.test.ts`
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/tsconfig.electron.json`

- [ ] **Step 1: Write failing preload security tests**

Create `apps/desktop/src/electron/preload.test.ts`. Keep it testable by exporting a pure helper from preload:

```ts
import { describe, expect, it, vi } from "vitest";
import { createSleiPreloadApi } from "./preload";

describe("electron preload api", () => {
  it("exposes only narrow rpc and events APIs", async () => {
    const invoke = vi.fn().mockResolvedValue({ connected: true });
    const on = vi.fn();
    const send = vi.fn();
    const off = vi.fn();

    const api = createSleiPreloadApi({ invoke, on, send, off }, { createSubscriptionId: () => "sub_1" });

    expect(Object.keys(api).sort()).toEqual(["events", "rpc"]);
    expect(Object.keys(api.rpc)).toEqual(["call"]);
    expect(Object.keys(api.events).sort()).toEqual(["subscribe"]);
    expect(JSON.stringify(api)).not.toContain("desktop-session-token");
    expect(JSON.stringify(api)).not.toContain("127.0.0.1");
  });

  it("maps daemon state subscriptions to the daemon-state IPC event", () => {
    const invoke = vi.fn();
    const on = vi.fn();
    const send = vi.fn();
    const off = vi.fn();
    const handler = vi.fn();

    const api = createSleiPreloadApi({ invoke, on, send, off }, { createSubscriptionId: () => "sub_state" });
    const cleanup = api.events.subscribe("daemon.state", handler);

    expect(on).toHaveBeenCalledWith("slei:daemon-state", expect.any(Function));
    expect(send).toHaveBeenCalledWith("slei:events:subscribe", { channel: "daemon.state", subscriptionId: "sub_state" });
    cleanup();
    expect(off).toHaveBeenCalledWith("slei:daemon-state", expect.any(Function));
  });
});
```

- [ ] **Step 2: Run failing preload tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/preload.test.ts`

Expected: FAIL because preload module does not exist.

- [ ] **Step 3: Implement preload API**

Create `apps/desktop/src/electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

export function createSleiPreloadApi(
  ipc = ipcRenderer,
  options = { createSubscriptionId: () => globalThis.crypto.randomUUID() },
) {
  return {
    rpc: {
      call(method: string, payload: unknown) {
        return ipc.invoke("slei:rpc", { method, payload });
      },
    },
    events: {
      subscribe(channel: "daemon.events" | "daemon.state", handler: (payload: unknown) => void) {
        const subscriptionId = options.createSubscriptionId();
        const eventName = channel === "daemon.events" ? "slei:daemon-events" : "slei:daemon-state";
        const listener = (_event: unknown, payload: unknown) => handler(payload);
        ipc.on(eventName, listener);
        ipc.send("slei:events:subscribe", { channel, subscriptionId });
        return () => {
          ipc.off(eventName, listener);
          ipc.send("slei:events:unsubscribe", { subscriptionId });
        };
      },
    },
  };
}

contextBridge.exposeInMainWorld("slei", createSleiPreloadApi());
```

Do not import Node modules from preload while the window uses `sandbox: true`. Use Web Crypto for subscription IDs or inject a test ID factory as shown above. If tests cannot import `electron`, use `vi.mock("electron", ...)` in the test.

- [ ] **Step 4: Add global window type**

Create `apps/desktop/src/electron/global.d.ts`:

```ts
import type { createSleiPreloadApi } from "./preload";

declare global {
  interface Window {
    slei?: ReturnType<typeof createSleiPreloadApi>;
  }
}
```

- [ ] **Step 5: Implement Electron main bootstrap**

Create `apps/desktop/src/electron/main.ts`:

- `app.whenReady()` registers IPC/protocol, creates the window, then starts `ensureDaemon()` asynchronously.
- Do not block window creation on daemon readiness. The renderer must be able to show starting, offline, or auth/protocol error states.
- Maintain a main-process daemon state object such as:

```ts
type MainDaemonState =
  | { state: "starting" }
  | { state: "connected"; owned: boolean }
  | { state: "offline"; code: "daemon_unavailable" | "daemon_auth_failed" | "daemon_start_timeout" };
```

- Register `ipcMain.handle("slei:rpc", ...)`.
- `daemon.status` should return a sanitized disconnected receipt when daemon state is starting/offline, instead of throwing before the UI can render.
- Business RPC calls while daemon is unavailable should reject with the typed daemon error.
- Main should send `webContents.send("slei:daemon-state", state)` whenever daemon state changes.
- On `daemon.state` subscribe, main must immediately send the current daemon state to that renderer before waiting for the next transition. This prevents missing a fast `starting -> connected` transition.
- Renderer recovery depends on `daemon.state`; do not rely on a one-time initial bootstrap succeeding while daemon is still starting.
- Create BrowserWindow with:

```ts
new BrowserWindow({
  width: 1280,
  height: 800,
  title: "",
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: join(__dirname, "preload.js"),
  },
});
```

- Load `VITE_DEV_URL`.
- When async `ensureDaemon()` succeeds, update daemon state and notify renderer.
- When async `ensureDaemon()` fails, update daemon state, log without token leakage, notify renderer, and leave the window open.
- On `before-quit`, stop only owned daemon.

- [ ] **Step 6: Run Electron build**

Run: `pnpm --filter @slei/desktop build:electron`

Expected: PASS and `apps/desktop/dist-electron/main.js` plus `preload.js` are generated.

- [ ] **Step 7: Run targeted tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/preload.test.ts src/electron/daemon-lifecycle.test.ts src/electron/daemon-rpc.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/electron/main.ts apps/desktop/src/electron/preload.ts apps/desktop/src/electron/global.d.ts apps/desktop/src/electron/preload.test.ts apps/desktop/tsconfig.json apps/desktop/tsconfig.electron.json
git commit -m "feat(desktop): bootstrap electron main and preload"
```

## Task 6: Implement Event Forwarder

**Files:**
- Create: `apps/desktop/src/electron/event-forwarder.ts`
- Create: `apps/desktop/src/electron/event-forwarder.test.ts`
- Modify: `apps/desktop/src/electron/main.ts`

- [ ] **Step 1: Write failing event forwarder tests**

Create `apps/desktop/src/electron/event-forwarder.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createEventForwarder } from "./event-forwarder";

describe("event forwarder", () => {
  it("advances sequence and emits event batches", async () => {
    const reconnect = vi.fn().mockResolvedValue({
      events: [{ sequence: 8, eventType: "task_thread.updated", occurredAtUnixMs: 1, payload: {} }],
    });
    const emit = vi.fn();
    const forwarder = createEventForwarder({ reconnect, emit, setTimeoutImpl: vi.fn() as never });

    await forwarder.tick();

    expect(emit).toHaveBeenCalledWith({ after: 8, events: expect.any(Array) });
    expect(forwarder.after()).toBe(8);
  });

  it("does not emit after unsubscribe", async () => {
    const reconnect = vi.fn().mockResolvedValue({ events: [{ sequence: 1, eventType: "x", occurredAtUnixMs: 1, payload: {} }] });
    const emit = vi.fn();
    const forwarder = createEventForwarder({ reconnect, emit, setTimeoutImpl: vi.fn() as never });

    forwarder.unsubscribe();
    await forwarder.tick();

    expect(emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing event tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/event-forwarder.test.ts`

Expected: FAIL because forwarder does not exist.

- [ ] **Step 3: Implement forwarder**

Create `apps/desktop/src/electron/event-forwarder.ts`:

- `createEventForwarder({ reconnect, emit })`.
- Track `after` sequence.
- `tick()` calls `reconnect(after)`.
- Emit `{ after, events }` only when subscribed and events are non-empty.
- Empty ticks back off from 1s to 10s.
- Non-empty ticks use 250ms.
- `start()` schedules ticks.
- `stop()` cancels timers.
- `unsubscribe()` prevents future emits.

- [ ] **Step 4: Wire forwarder into main**

Modify `apps/desktop/src/electron/main.ts`:

- On renderer subscribe IPC, create or attach a subscription.
- Send renderer batches with `webContents.send("slei:daemon-events", batch)`.
- On unsubscribe, remove subscription.
- Stop forwarder on window closed.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/event-forwarder.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/electron/event-forwarder.ts apps/desktop/src/electron/event-forwarder.test.ts apps/desktop/src/electron/main.ts
git commit -m "feat(desktop): forward daemon events through electron"
```

## Task 7: Adapt Renderer DaemonBridge And Frontend Logging

**Files:**
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.test.ts`
- Modify: `apps/desktop/src/lib/frontend-crash-logging.ts`
- Modify: `apps/desktop/src/test/daemon-bridge-mock.ts`
- Modify: `apps/desktop/src/lib/frontend-crash-logging.test.ts` if it exists; otherwise create it.

- [ ] **Step 1: Write failing DaemonBridge Electron adapter tests**

Add tests to `apps/desktop/src/lib/daemon-bridge.test.ts`:

```ts
it("uses electron desktop rpc when window.slei is available", async () => {
  const call = vi.fn().mockResolvedValueOnce({ channels: [] });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { slei: { rpc: { call }, events: { subscribe: vi.fn() } } },
  });

  const bridge = createDaemonBridge();
  await expect(bridge.listChannels()).resolves.toEqual({ channels: [] });

  expect(call).toHaveBeenCalledWith("channels.list", {});
});

it("listens for daemon events through electron preload", async () => {
  let listener: ((batch: unknown) => void) | undefined;
  const cleanupFromPreload = vi.fn();
  const subscribe = vi.fn((_channel, handler) => {
    listener = handler;
    return cleanupFromPreload;
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { slei: { rpc: { call: vi.fn() }, events: { subscribe } } },
  });

  const bridge = createDaemonBridge();
  const handler = vi.fn();
  const cleanup = await bridge.listenDaemonEvents(handler);
  listener?.({ after: 8, events: [] });

  expect(handler).toHaveBeenCalledWith({ after: 8, events: [] });
  cleanup();
  expect(cleanupFromPreload).toHaveBeenCalled();
});

it("listens for daemon state changes through electron preload", async () => {
  let listener: ((state: unknown) => void) | undefined;
  const cleanupFromPreload = vi.fn();
  const subscribe = vi.fn((_channel, handler) => {
    listener = handler;
    return cleanupFromPreload;
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { slei: { rpc: { call: vi.fn() }, events: { subscribe } } },
  });

  const bridge = createDaemonBridge();
  const handler = vi.fn();
  const cleanup = await bridge.listenDaemonState(handler);
  listener?.({ state: "connected" });

  expect(subscribe).toHaveBeenCalledWith("daemon.state", expect.any(Function));
  expect(handler).toHaveBeenCalledWith({ state: "connected" });
  cleanup();
  expect(cleanupFromPreload).toHaveBeenCalled();
});
```

Adjust the exact subscribe test shape to match the final preload API.

- [ ] **Step 2: Run failing DaemonBridge tests**

Run: `pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts`

Expected: FAIL because `createDaemonBridge()` only detects Tauri.

- [ ] **Step 3: Implement Electron adapter**

Modify `apps/desktop/src/lib/daemon-bridge.ts`:

- Add `hasElectronRuntime()`:

```ts
function hasElectronRuntime() {
  return typeof window !== "undefined" && !!window.slei?.rpc?.call;
}
```

- Check Electron before Tauri:

```ts
export function createDaemonBridge(): DaemonBridge {
  if (hasElectronRuntime()) return createElectronDaemonBridge(window.slei);
  if (hasTauriRuntime()) return createTauriDaemonBridge();
  return createOfflineDaemonBridge();
}
```

- Move current Tauri branch into `createTauriDaemonBridge()` for reference.
- Implement `createElectronDaemonBridge()` by mapping all existing methods to typed RPC calls.
- Add `listenDaemonState(handler)` to `DaemonBridge`. Offline and legacy Tauri bridges may return a no-op cleanup; Electron bridge must use `window.slei.events.subscribe("daemon.state", handler)`.
- Update `apps/desktop/src/test/daemon-bridge-mock.ts` with `listenDaemonState(handler)` and a helper such as `emitDaemonState(state)` so tests can simulate `starting/offline -> connected` recovery.
- Keep offline bridge behavior unchanged.

- Update `apps/desktop/src/app/SleiApp.tsx` so the initial `loadInitialState()` can recover after async daemon startup:
  - Subscribe to `bridge.listenDaemonState`.
  - When state changes to `connected`, rerun the same initialization/core refresh path used on first load.
  - Guard against duplicate concurrent initial loads with an `initialLoadInFlight` ref or equivalent.
  - Leave offline/error rendering in place while state is `starting` or `offline`.

- [ ] **Step 4: Update crash logging**

Modify `apps/desktop/src/lib/frontend-crash-logging.ts`:

- Remove direct import of `@tauri-apps/api/core`.
- Use `window.slei?.rpc.call("frontend.crash.log", { report })` when Electron exists.
- Keep console fallback when no runtime exists.
- If Tauri fallback remains temporarily, isolate it behind a small dynamic helper and mark it legacy; do not import Tauri at module top level.

- [ ] **Step 5: Run targeted renderer tests**

Run: `pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts src/lib/desktop-rpc.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/lib/daemon-bridge.ts apps/desktop/src/lib/daemon-bridge.test.ts apps/desktop/src/lib/frontend-crash-logging.ts apps/desktop/src/test/daemon-bridge-mock.ts
git commit -m "feat(desktop): route renderer bridge through electron rpc"
```

## Task 8: Add Safe Avatar Protocol

**Files:**
- Create: `apps/desktop/src/electron/avatar-protocol.ts`
- Create: `apps/desktop/src/electron/avatar-protocol.test.ts`
- Modify: `apps/desktop/src/electron/main.ts`

- [ ] **Step 1: Write failing avatar protocol tests**

Create `apps/desktop/src/electron/avatar-protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { profileAvatarFileFromUri, profileAvatarMime } from "./avatar-protocol";

describe("avatar protocol", () => {
  it("accepts only hashed image filenames", () => {
    const hash = "a".repeat(64);
    expect(profileAvatarMime(`${hash}.png`)).toBe("image/png");
    expect(profileAvatarMime(`${hash}.jpg`)).toBe("image/jpeg");
    expect(profileAvatarMime("avatar.png")).toBeUndefined();
    expect(profileAvatarMime(`${hash}.svg`)).toBeUndefined();
  });

  it("rejects traversal and query strings", () => {
    expect(profileAvatarFileFromUri("/tmp/slei", "slei-avatar:///../secret.png")).toBeUndefined();
    expect(profileAvatarFileFromUri("/tmp/slei", `slei-avatar:///${"a".repeat(64)}.png?x=1`)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run failing avatar tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/avatar-protocol.test.ts`

Expected: FAIL because avatar protocol module does not exist.

- [ ] **Step 3: Implement protocol helpers**

Create `apps/desktop/src/electron/avatar-protocol.ts`:

- Port validation rules from `apps/desktop/src-tauri/src/lib.rs`.
- Export pure helpers for testability.
- Use `node:path` and `node:fs/promises`.
- Canonicalize resolved file path and ensure it starts with `dataRoot/profile/avatars`.

- [ ] **Step 4: Register protocol in Electron main**

Modify `apps/desktop/src/electron/main.ts`:

- Register `slei-avatar` before window load.
- Register the custom scheme early enough in app startup, before any renderer content is loaded.
- Return `404` for invalid/missing files.
- Return correct content type for png/jpg/jpeg/webp.
- Do not allow arbitrary `file://` exposure.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm --filter @slei/desktop test -- src/electron/avatar-protocol.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/electron/avatar-protocol.ts apps/desktop/src/electron/avatar-protocol.test.ts apps/desktop/src/electron/main.ts
git commit -m "feat(desktop): add safe avatar protocol"
```

## Task 9: Update Startup, DOM, And Core Interaction Tests

**Files:**
- Modify: `apps/desktop/e2e/startup.spec.ts`
- Modify: `apps/desktop/e2e/shell.spec.ts`
- Modify: `apps/desktop/e2e/chat.spec.ts` if needed
- Modify: `apps/desktop/src/app/SleiApp.test.ts`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx` if runtime assumptions changed

- [ ] **Step 1: Remove active Tauri assumptions from startup tests**

Update `apps/desktop/e2e/startup.spec.ts`:

- Tests should no longer read `src-tauri/tauri.conf.json` as the active startup contract.
- Replace transparent macOS Tauri config assertions with V2 reminder tests or remove them.
- Assert Electron main creates standard `1280x800` BrowserWindow by reading `src/electron/main.ts` source or testing exported window options helper.

- [ ] **Step 2: Add no-token-renderer regression test**

Keep or add a test in `apps/desktop/e2e/shell.spec.ts`:

```ts
it("never exposes daemon endpoint, token or raw socket values to renderer status", async () => {
  const bridge = createDaemonBridgeMock({ connected: true });
  const serialized = JSON.stringify(await bridge.daemonStatus());

  expect(serialized).not.toContain("desktop-session-token");
  expect(serialized).not.toContain("127.0.0.1");
  expect(serialized).not.toContain("ws://");
});
```

- [ ] **Step 3: Add connected core loop renderer test**

Add a test around `SleiApp` or existing mock bridge that verifies:

- app renders connected state,
- active channel messages render,
- sending a channel message calls `bridge.sendChannelMessage`,
- event reconnect uses the last sequence.

Use existing `createDaemonBridgeMock` rather than production mock data.

- [ ] **Step 4: Add daemon startup recovery test**

Add a focused test around `SleiApp` and `createDaemonBridgeMock`:

- Start with `daemonStatus()` returning disconnected or starting/offline.
- Initial product data calls may return empty/offline results.
- Emit `listenDaemonState({ state: "connected" })`.
- Assert the app reruns core initialization or refreshes channels/messages/tasks and renders connected state.

This test prevents the Electron app from getting stuck when the window opens before daemon readiness.

- [ ] **Step 5: Run desktop test suite**

Run: `pnpm --filter @slei/desktop test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/e2e/startup.spec.ts apps/desktop/e2e/shell.spec.ts apps/desktop/e2e/chat.spec.ts apps/desktop/src/app/SleiApp.test.ts apps/desktop/src/app/SleiAppFrame.test.tsx
git commit -m "test(desktop): cover electron startup and core loop"
```

Only stage files actually modified.

## Task 10: Verify Electron Dev App Manually

**Files:**
- Modify only if verification exposes testable gaps.

- [x] **Step 1: Run static verification**

Run: `pnpm --filter @slei/desktop typecheck`

Expected: PASS.

Run: `pnpm --filter @slei/desktop test`

Expected: PASS.

- [x] **Step 2: Run repo-level guardrails**

Run: `pnpm test:guardrails`

Expected: PASS.

- [x] **Step 3: Start Electron desktop app**

Run: `pnpm --filter @slei/desktop desktop`

Expected:

- Vite starts on `http://127.0.0.1:1420`.
- Electron window opens.
- Electron main either connects to an existing compatible daemon or spawns `cargo run -p slei-daemon`.
- Renderer shows connected daemon status.
- No `@tauri-apps/api` runtime error appears.

- [x] **Step 4: Manual product loop smoke test**

In the Electron app:

- Open chat.
- Confirm channel list loads.
- Open or use the default channel.
- Send a short message.
- Confirm message appears after daemon write.
- Confirm diagnostics or event-driven refresh does not error.
- Trigger a benign frontend event log if a UI path exists.

- [x] **Step 5: Stop app and confirm cleanup**

Stop the desktop command with `Ctrl-C`.

Expected:

- Vite background process exits.
- Electron exits.
- If Electron spawned the daemon, owned daemon exits.
- If daemon was pre-existing, it remains untouched.

- [x] **Step 6: Commit verification fixes if needed**

If manual verification required fixes:

```bash
git add <changed-files>
git commit -m "fix(desktop): stabilize electron dev startup"
```

## Task 11: Document V1 Handoff And V2 Queue

**Files:**
- Modify: `README.md` if it mentions Tauri desktop startup
- Modify: `docs/superpowers/specs/2026-07-07-electron-desktop-foundation-design.md` only if implementation discovers design corrections
- Create or modify: `docs/superpowers/plans/2026-07-07-electron-desktop-foundation.md` if plan changes during execution

- [x] **Step 1: Write failing docs/source assertions if existing tests cover startup docs**

Search:

```bash
rg -n "tauri|Tauri|desktop-dev|pnpm --filter @slei/desktop desktop" README.md docs apps/desktop/e2e
```

If tests assert startup docs, update those tests first.

- [x] **Step 2: Update user-facing startup docs**

Ensure docs say:

- `pnpm --filter @slei/desktop desktop` starts the Electron desktop app.
- The command starts Vite for renderer dev assets.
- Electron main owns local daemon spawn/connect.
- V2 still includes packaging and Tauri physical cleanup.

- [x] **Step 3: Run docs-related tests**

Run: `pnpm --filter @slei/desktop test -- e2e/startup.spec.ts`

Expected: PASS.

- [x] **Step 4: Commit docs**

```bash
git add README.md docs/superpowers/specs/2026-07-07-electron-desktop-foundation-design.md docs/superpowers/plans/2026-07-07-electron-desktop-foundation.md
git commit -m "docs: update electron desktop startup notes"
```

Only stage files actually modified.

## Final Verification

Run all of these before claiming V1 complete:

```bash
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop test
pnpm test:guardrails
pnpm --filter @slei/desktop build:electron
```

Then run the app:

```bash
pnpm --filter @slei/desktop desktop
```

Manual acceptance must confirm:

- The running desktop window is Electron, not Tauri.
- Renderer does not rely on `window.__TAURI_INTERNALS__`.
- Renderer cannot see daemon token or endpoint.
- Daemon status loads through Electron RPC.
- Channel list and channel messages load from daemon.
- Sending a channel message succeeds through daemon.
- Daemon events are delivered or reconnect can fetch event batches.
- Frontend logging does not import Tauri at runtime.
- `slei-avatar` rejects traversal and only serves allowed avatar images.

## V1 Handoff Notes

- Active desktop path is Electron: `pnpm --filter @slei/desktop desktop` starts Vite on `127.0.0.1:1420`, compiles Electron main/preload, and launches `dist-electron/electron/main.js`.
- Electron main owns daemon RPC, event forwarding, frontend logging, and `slei-avatar` protocol handling; renderer uses `DaemonBridge` and does not receive daemon token or endpoint.
- V1 smoke verified real daemon reads and writes: `/health`, channel list, sending a channel message to `all`, and reading that message back.
- Dev cleanup verified from a free daemon port: `Ctrl-C` exits Electron/Vite and clears the daemon plus current-worktree agent worker processes. If a compatible daemon already existed before startup, the script treats it as external and leaves it untouched.
- Electron 43 binary download is an external first-run dependency. Once cached, startup proceeds normally.
- `apps/desktop/dist-electron/` is generated by `build:electron` and is ignored.

## V2 Backlog Reminder

Do not pull these into V1 unless the user explicitly expands scope:

- Delete `apps/desktop/src-tauri`.
- Remove Tauri dependencies and Cargo workspace member.
- Add Electron packaging/signing/updater.
- Bundle production daemon and CLI binaries.
- Restore macOS transparent/sidebar/traffic-light polish.
- Add production token handoff or randomized session token.
- Add cross-platform package verification.
- Decide how packaged Electron discovers or owns the production daemon data root; V1 intentionally does not expose daemon data root through unauthenticated `/health`.
- Replace remaining Tauri-era docs/spec references in older historical plans only when those plans are actively revived.
- Add CI jobs for `pnpm --filter @slei/desktop build:electron` and package smoke tests.
