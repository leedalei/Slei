import { describe, expect, it, vi } from "vitest";
import { ensureDaemon } from "./daemon-lifecycle.js";

describe("daemon lifecycle", () => {
  it("connects to an existing compatible daemon without spawning", async () => {
    const spawn = vi.fn();
    const probePort = vi.fn().mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      daemon_version: "0.1.0",
      protocol_version: "2026-05-27",
    });

    await expect(ensureDaemon({ probePort, health, spawn } as never)).resolves.toMatchObject({ owned: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns daemon with token and PATH when the port is free", async () => {
    const spawn = vi.fn().mockReturnValue({ pid: 42, once: vi.fn(), kill: vi.fn() });
    const probePort = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      daemon_version: "0.1.0",
      protocol_version: "2026-05-27",
    });

    await expect(ensureDaemon({ probePort, health, repoRoot: "/tmp/slei", spawn } as never)).resolves.toMatchObject({ owned: true });
    expect(spawn).toHaveBeenCalledWith("cargo", ["run", "-p", "slei-daemon"], expect.objectContaining({
      cwd: "/tmp/slei",
      env: expect.objectContaining({
        PATH: expect.stringContaining("/tmp/slei/target/debug"),
        SLEI_DAEMON_TOKEN: "desktop-session-token",
        SLEI_DAEMON_URL: "http://127.0.0.1:4319",
      }),
    }));
  });

  it("stops an owned daemon process when readiness fails", async () => {
    const kill = vi.fn();
    const spawn = vi.fn().mockReturnValue({ pid: 42, once: vi.fn(), kill });
    const probePort = vi.fn().mockResolvedValue(false);
    let currentTime = 0;
    const now = vi.fn(() => currentTime);
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms;
    });
    const health = vi.fn();

    await expect(
      ensureDaemon({ health, now, probePort, sleep, spawn, timeoutMs: 100 } as never),
    ).rejects.toMatchObject({ code: "daemon_unavailable" });
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });
});
