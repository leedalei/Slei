import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { createFrontendCrashReport, logFrontendCrash } from "./frontend-crash-logging";

describe("frontend crash logging", () => {
  afterEach(() => {
    invokeMock.mockReset();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
  });

  it("logs frontend crashes through Electron RPC before legacy Tauri", async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { href: "http://127.0.0.1:1420/" },
        __TAURI_INTERNALS__: {},
        slei: { rpc: { call } },
      },
    });
    const report = createFrontendCrashReport("react", new Error("token=secret render failed"), "Bearer abc.def");

    logFrontendCrash(report);
    await Promise.resolve();

    expect(call).toHaveBeenCalledWith("frontend.crash.log", { report });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(report.message).toContain("token=[redacted-token]");
    expect(report.componentStack).toContain("Bearer [redacted-token]");
  });

  it("does not expose crash reports to console when no desktop runtime is available", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const report = createFrontendCrashReport("window-error", "plain failure");

    logFrontendCrash(report);
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("redacts sensitive values from crash report URLs", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "http://127.0.0.1:1420/?token=secret&next=/home#access_token=abc.def",
        },
      },
    });

    const report = createFrontendCrashReport("window-error", "boom");

    expect(report.url).toContain("token=[redacted-token]");
    expect(report.url).toContain("access_token=[redacted-token]");
    expect(report.url).not.toContain("secret");
    expect(report.url).not.toContain("abc.def");
  });
});
