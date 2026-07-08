import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDaemonError } from "./daemon-http.js";
import { ensureDaemon, stopOwnedDaemon, terminateOwnedProcess, waitForDaemonReady } from "./daemon-lifecycle.js";

const tempRoots: string[] = [];

describe("daemon lifecycle", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("connects to an existing compatible dev daemon without spawning", async () => {
    const authCheck = vi.fn().mockResolvedValue({});
    const spawn = vi.fn();
    const probePort = vi.fn().mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      daemon_version: "0.1.0",
      protocol_version: "v1",
    });

    await expect(ensureDaemon({ authCheck, isPackaged: false, probePort, health, spawn } as never)).resolves.toMatchObject({ owned: false });
    expect(probePort).toHaveBeenCalledWith("127.0.0.1", 4319);
    expect(authCheck).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects an existing daemon that does not accept the desktop token", async () => {
    const authCheck = vi.fn().mockRejectedValue(new DesktopDaemonError("daemon_auth_failed", "bad token"));
    const spawn = vi.fn();
    const probePort = vi.fn().mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      daemon_version: "0.1.0",
      protocol_version: "v1",
    });

    await expect(ensureDaemon({ authCheck, probePort, health, spawn } as never)).rejects.toMatchObject({
      code: "daemon_auth_failed",
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects an incompatible daemon protocol version", async () => {
    const authCheck = vi.fn();
    const spawn = vi.fn();
    const probePort = vi.fn().mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      daemon_version: "0.1.0",
      protocol_version: "2026-05-27",
    });

    await expect(ensureDaemon({ authCheck, probePort, health, spawn } as never)).rejects.toMatchObject({
      code: "daemon_unavailable",
    });
    expect(authCheck).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("times out when existing daemon health validation hangs", async () => {
    const authCheck = vi.fn();
    const spawn = vi.fn();
    const probePort = vi.fn().mockResolvedValue(true);
    const health = vi.fn(() => new Promise<never>(() => undefined));
    let currentTime = 0;
    const now = vi.fn(() => currentTime);
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms;
    });

    await expect(
      ensureDaemon({ authCheck, health, now, probePort, sleep, spawn, timeoutMs: 100 } as never),
    ).rejects.toMatchObject({ code: "daemon_unavailable" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns daemon with token and PATH when the port is free", async () => {
    const authCheck = vi.fn().mockResolvedValue({});
    const spawn = vi.fn().mockReturnValue({ pid: 42, once: vi.fn(), kill: vi.fn() });
    const probePort = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      daemon_version: "0.1.0",
      protocol_version: "v1",
    });

    await expect(ensureDaemon({ authCheck, dataRoot: "/tmp/slei-data", probePort, health, repoRoot: "/tmp/slei", spawn } as never)).resolves.toMatchObject({ owned: true });
    expect(spawn).toHaveBeenCalledWith("cargo", ["run", "-p", "slei-daemon"], expect.objectContaining({
      cwd: "/tmp/slei",
      detached: true,
      env: expect.objectContaining({
        PATH: expect.stringContaining("/tmp/slei/target/debug"),
        SLEI_DATA_ROOT: "/tmp/slei-data",
        SLEI_DAEMON_TOKEN: "desktop-session-token",
        SLEI_DAEMON_URL: "http://127.0.0.1:4319",
      }),
    }));
  });

  it("starts packaged daemon without probing or connecting to an existing 4319 daemon", async () => {
    const resourcesPath = await createPackagedResources();
    const daemonProcess = createMockDaemonProcess();
    const spawn = vi.fn().mockReturnValue(daemonProcess);
    const probePort = vi.fn().mockResolvedValue(true);

    const ready = ensureDaemon(packagedLifecycleOptions({ probePort, resourcesPath, spawn }));
    daemonProcess.stdout.emit("data", Buffer.from("slei-daemon listening on 127.0.0.1:51234\n"));

    await expect(ready).resolves.toMatchObject({
      owned: true,
      endpoint: "http://127.0.0.1:51234",
    });
    expect(probePort).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("spawns packaged daemon with dynamic bind, random token, data root, worker, and packaged PATH", async () => {
    const resourcesPath = await createPackagedResources();
    const daemonProcess = createMockDaemonProcess();
    const spawn = vi.fn().mockReturnValue(daemonProcess);
    const randomToken = "generated-token-for-this-electron-session";

    const ready = ensureDaemon(packagedLifecycleOptions({ generateToken: () => randomToken, resourcesPath, spawn }));
    daemonProcess.stdout.emit("data", Buffer.from("slei-daemon listening on 127.0.0.1:51235\n"));

    await expect(ready).resolves.toMatchObject({
      owned: true,
      endpoint: "http://127.0.0.1:51235",
      token: randomToken,
    });

    const nativeRoot = join(resourcesPath, "native", "darwin-arm64");
    expect(spawn).toHaveBeenCalledWith(join(nativeRoot, "slei-daemon"), [], expect.objectContaining({
      cwd: nativeRoot,
      detached: true,
      env: expect.objectContaining({
        SLEI_CLAUDE_AGENT_RUNNER: join(nativeRoot, "workers", "claude-agent", "local-runner.js"),
        SLEI_DAEMON_ADDR: "127.0.0.1:0",
        SLEI_DAEMON_TOKEN: randomToken,
        SLEI_DATA_ROOT: "/Users/leelei/Library/Application Support/Slei/data",
        SLEI_OVERLAY_HOME: "/Users/leelei/Library/Application Support/Slei/data/runtime/overlays",
      }),
    }));
    const env = spawn.mock.calls[0][2].env as Record<string, string>;
    expect(env.PATH.split(":").slice(0, 2)).toEqual([
      join(nativeRoot, "node", "bin"),
      nativeRoot,
    ]);
    expect(env.SLEI_DAEMON_URL).not.toBe("http://127.0.0.1:0");
    expect(env.SLEI_DAEMON_TOKEN).not.toBe("desktop-session-token");
  });

  it("does not mark packaged daemon ready from a stderr listening line", async () => {
    const resourcesPath = await createPackagedResources();
    const daemonProcess = createMockDaemonProcess();
    const spawn = vi.fn().mockReturnValue(daemonProcess);

    const ready = ensureDaemon(packagedLifecycleOptions({ resourcesPath, spawn, timeoutMs: 20 }));
    daemonProcess.stderr.emit("data", Buffer.from("slei-daemon listening on 127.0.0.1:51236\n"));

    await expect(ready).rejects.toMatchObject({
      code: "daemon_unavailable",
      message: expect.stringContaining("127.0.0.1:51236"),
    });
  });

  it("returns daemon stdout parsed endpoint instead of relying on the 127.0.0.1:0 bind request", async () => {
    const resourcesPath = await createPackagedResources();
    const daemonProcess = createMockDaemonProcess();
    const spawn = vi.fn().mockReturnValue(daemonProcess);

    const ready = ensureDaemon(packagedLifecycleOptions({ resourcesPath, spawn }));
    expect(daemonProcess.stdout.resume).not.toHaveBeenCalled();
    expect(daemonProcess.stderr.resume).not.toHaveBeenCalled();
    daemonProcess.stdout.emit("data", Buffer.from("slei-daemon listening on 127.0.0.1:54001\n"));

    await expect(ready).resolves.toMatchObject({
      endpoint: "http://127.0.0.1:54001",
    });
    expect(daemonProcess.stdout.resume).toHaveBeenCalledOnce();
    expect(daemonProcess.stderr.resume).toHaveBeenCalledOnce();
    const env = spawn.mock.calls[0][2].env as Record<string, string>;
    expect(env.SLEI_DAEMON_ADDR).toBe("127.0.0.1:0");
    expect(env.SLEI_DAEMON_URL).toBeUndefined();
  });

  it("parses the packaged daemon listening line when stream chunks split the address", async () => {
    const resourcesPath = await createPackagedResources();
    const daemonProcess = createMockDaemonProcess();
    const spawn = vi.fn().mockReturnValue(daemonProcess);

    const ready = ensureDaemon(packagedLifecycleOptions({ resourcesPath, spawn, timeoutMs: 20 }));
    daemonProcess.stdout.emit("data", Buffer.from("slei-daemon listening on 127.0."));
    daemonProcess.stdout.emit("data", Buffer.from("0.1:54002\n"));

    await expect(ready).resolves.toMatchObject({
      endpoint: "http://127.0.0.1:54002",
    });
  });

  it.each([
    ["embedded text", "prefix slei-daemon listening on 127.0.0.1:54003\n"],
    ["zero port", "slei-daemon listening on 127.0.0.1:0\n"],
    ["port above range", "slei-daemon listening on 127.0.0.1:65536\n"],
  ])("does not mark packaged daemon ready from %s readiness output", async (_label, output) => {
    const resourcesPath = await createPackagedResources();
    const daemonProcess = createMockDaemonProcess();
    const spawn = vi.fn().mockReturnValue(daemonProcess);

    const ready = ensureDaemon(packagedLifecycleOptions({ resourcesPath, spawn, timeoutMs: 20 }));
    daemonProcess.stdout.emit("data", Buffer.from(output));

    await expect(ready).rejects.toMatchObject({
      code: "daemon_unavailable",
    });
  });

  it("returns recent daemon output when packaged daemon exits before readiness", async () => {
    const resourcesPath = await createPackagedResources();
    const daemonProcess = createMockDaemonProcess();
    const terminateProcess = vi.fn();
    const spawn = vi.fn().mockReturnValue(daemonProcess);

    const ready = ensureDaemon(packagedLifecycleOptions({ resourcesPath, spawn, terminateProcess }));
    daemonProcess.stdout.emit("data", Buffer.from("boot line\n"));
    daemonProcess.stderr.emit("data", Buffer.from("bind failed\n"));
    daemonProcess.emit("exit", 78, null);

    await expect(ready).rejects.toMatchObject({
      code: "daemon_unavailable",
      message: expect.stringContaining("bind failed"),
    });
    await expect(ready).rejects.toThrow(/boot line/);
    expect(terminateProcess).toHaveBeenCalledWith(daemonProcess);
  });

  it("caps huge packaged daemon output before including it in startup errors", async () => {
    const resourcesPath = await createPackagedResources();
    const daemonProcess = createMockDaemonProcess();
    const spawn = vi.fn().mockReturnValue(daemonProcess);
    const hugeLine = `stderr-${"x".repeat(10_000)}-tail\n`;

    const ready = ensureDaemon(packagedLifecycleOptions({ resourcesPath, spawn, timeoutMs: 20 }));
    daemonProcess.stderr.emit("data", Buffer.from(hugeLine));

    await expect(ready).rejects.toMatchObject({
      code: "daemon_unavailable",
      message: expect.not.stringContaining("x".repeat(5_000)),
    });
    await expect(ready).rejects.toThrow(/stderr-/);
  });

  it("stops an owned daemon process when readiness fails", async () => {
    const daemonProcess = { pid: 42, once: vi.fn(), kill: vi.fn() };
    const terminateProcess = vi.fn();
    const spawn = vi.fn().mockReturnValue(daemonProcess);
    const probePort = vi.fn().mockResolvedValue(false);
    let currentTime = 0;
    const now = vi.fn(() => currentTime);
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms;
    });
    const health = vi.fn();

    await expect(
      ensureDaemon({ health, now, probePort, sleep, spawn, terminateProcess, timeoutMs: 100 } as never),
    ).rejects.toMatchObject({ code: "daemon_unavailable" });
    expect(terminateProcess).toHaveBeenCalledWith(daemonProcess);
  });

  it("terminates owned daemon process groups before falling back to the child process", () => {
    const killProcess = vi.fn();
    const kill = vi.fn();

    terminateOwnedProcess({ pid: 42, kill } as never, { killProcess });
    expect(killProcess).toHaveBeenCalledWith(-42, "SIGTERM");
    expect(kill).not.toHaveBeenCalled();

    killProcess.mockImplementationOnce(() => {
      throw new Error("missing process group");
    });
    terminateOwnedProcess({ pid: 43, kill } as never, { killProcess });
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses the same owned termination logic when stopping an owned handle", () => {
    const daemonProcess = { pid: 42, kill: vi.fn() };
    const killProcess = vi.fn();

    stopOwnedDaemon({
      endpoint: "http://127.0.0.1:4319",
      owned: true,
      process: daemonProcess as never,
      token: "desktop-session-token",
    }, { killProcess });
    expect(killProcess).toHaveBeenCalledWith(-42, "SIGTERM");
  });

  it("maps spawn errors during readiness to daemon_unavailable", async () => {
    let onError: ((error: Error) => void) | undefined;
    const daemonProcess = {
      pid: 42,
      kill: vi.fn(),
      once: vi.fn((event: string, callback: (error: Error) => void) => {
        if (event === "error") {
          onError = callback;
        }
        return daemonProcess;
      }),
    };
    const spawn = vi.fn().mockReturnValue(daemonProcess);
    const terminateProcess = vi.fn();
    const probePort = vi.fn().mockResolvedValue(false);
    let currentTime = 0;
    const now = vi.fn(() => currentTime);
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms;
      onError?.(new Error("spawn failed"));
    });

    await expect(
      ensureDaemon({ now, probePort, sleep, spawn, terminateProcess, timeoutMs: 1_000 } as never),
    ).rejects.toMatchObject({ code: "daemon_unavailable" });
    expect(terminateProcess).toHaveBeenCalledWith(daemonProcess);
  });

  it("times out when health hangs after the daemon port opens", async () => {
    const probePort = vi.fn().mockResolvedValue(true);
    const health = vi.fn(() => new Promise<never>(() => undefined));
    let currentTime = 0;
    const now = vi.fn(() => currentTime);
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms;
    });

    await expect(
      waitForDaemonReady({ health, now, probePort, sleep, timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "daemon_unavailable" });
  });
});

async function createPackagedResources(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slei-daemon-lifecycle-test-"));
  tempRoots.push(root);
  const nativeRoot = join(root, "native", "darwin-arm64");
  const files = [
    "slei-daemon",
    "slei-cli",
    "node/bin/node",
    "workers/claude-agent/local-runner.js",
    "workers/claude-agent/package.json",
  ];

  for (const file of files) {
    const path = join(nativeRoot, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, file.endsWith(".json") ? "{}\n" : "#!/bin/sh\n", "utf8");
    if (!file.endsWith(".json") && !file.endsWith(".js")) {
      await chmod(path, 0o755);
    }
  }

  return root;
}

function createMockDaemonProcess() {
  const process = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    pid: number;
    stderr: EventEmitter & { resume: ReturnType<typeof vi.fn> };
    stdout: EventEmitter & { resume: ReturnType<typeof vi.fn> };
  };
  process.kill = vi.fn();
  process.pid = 42;
  process.stderr = Object.assign(new EventEmitter(), { resume: vi.fn() });
  process.stdout = Object.assign(new EventEmitter(), { resume: vi.fn() });
  return process;
}

function packagedLifecycleOptions(overrides: Record<string, unknown>) {
  let currentTime = 0;
  return {
    arch: "arm64",
    authCheck: vi.fn().mockResolvedValue({}),
    health: vi.fn().mockResolvedValue({
      status: "ok",
      daemon_version: "0.1.0",
      protocol_version: "v1",
    }),
    isPackaged: true,
    now: vi.fn(() => currentTime),
    platform: "darwin",
    probePort: vi.fn().mockResolvedValue(false),
    repoRoot: "/repo",
    resourcesPath: "/missing-resources",
    sleep: vi.fn(async (ms: number) => {
      currentTime += ms;
    }),
    timeoutMs: 1,
    userDataPath: "/Users/leelei/Library/Application Support/Slei",
    ...overrides,
  } as never;
}
