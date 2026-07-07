import { describe, expect, it, vi } from "vitest";
import { DesktopDaemonError } from "./daemon-http.js";
import { ensureDaemon, stopOwnedDaemon, terminateOwnedProcess, waitForDaemonReady } from "./daemon-lifecycle.js";

describe("daemon lifecycle", () => {
  it("connects to an existing compatible daemon without spawning", async () => {
    const authCheck = vi.fn().mockResolvedValue({});
    const spawn = vi.fn();
    const probePort = vi.fn().mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      daemon_version: "0.1.0",
      protocol_version: "v1",
    });

    await expect(ensureDaemon({ authCheck, probePort, health, spawn } as never)).resolves.toMatchObject({ owned: false });
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

    stopOwnedDaemon({ owned: true, process: daemonProcess as never }, { killProcess });
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
