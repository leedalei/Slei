import { describe, expect, it, vi } from "vitest";
import { createDaemonHttpClient } from "./daemon-http.js";

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
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4319/health",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer desktop-session-token" }),
      }),
    );
  });

  it("maps unauthorized responses to daemon_auth_failed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "nope" });
    const client = createDaemonHttpClient({ endpoint: "http://127.0.0.1:4319", token: "bad", fetchImpl });

    await expect(client.request("GET", "/v1/nodes")).rejects.toMatchObject({ code: "daemon_auth_failed" });
  });
});
