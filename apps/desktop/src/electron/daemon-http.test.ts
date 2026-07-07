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

  it("treats 204 No Content as a successful void response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("no body");
      },
    });
    const client = createDaemonHttpClient({ endpoint: "http://127.0.0.1:4319", token: "desktop-session-token", fetchImpl });

    await expect(client.request("DELETE", "/v1/saved-messages/msg_1")).resolves.toBeUndefined();
  });

  it("filters caller-provided authorization headers case-insensitively", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { id: "msg_1" } }),
    });
    const client = createDaemonHttpClient({
      endpoint: "http://127.0.0.1:4319",
      token: "desktop-session-token",
      fetchImpl,
    });

    await client.request(
      "POST",
      "/v1/channels/all/messages",
      { body: "hello" },
      {
        headers: {
          authorization: "Bearer bad",
          AUTHORIZATION: "Bearer worse",
          "Idempotency-Key": "desktop-channel-message-test",
        },
      },
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers.AUTHORIZATION).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer desktop-session-token");
    expect(headers["Idempotency-Key"]).toBe("desktop-channel-message-test");
  });
});
