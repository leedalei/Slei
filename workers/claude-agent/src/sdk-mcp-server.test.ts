import { describe, expect, it } from "vitest";

import { createSleiSdkMcpServer } from "./sdk-mcp-server.js";

describe("Slei SDK MCP compatibility server", () => {
  it("returns an in-process Claude Agent SDK MCP server config", () => {
    expect(createSleiSdkMcpServer()).toMatchObject({
      type: "sdk",
      name: "slei",
      instance: expect.any(Object),
    });
  });
});
