import { describe, expect, it } from "vitest";

import { buildIsolatedSdkOptions, toPermissionRequest } from "./permissions";

describe("isolated Claude SDK permission profile", () => {
  it("disables persistence, settings, native subagents and unregistered tools", () => {
    const options = buildIsolatedSdkOptions("Controlled", "/workspace/app");

    expect(options.persistSession).toBe(false);
    expect(options.settingSources).toEqual([]);
    expect(options.nativeSubagents).toEqual([]);
    expect(options.externalMcpServers).toEqual([]);
    expect(options.allowedTools).toEqual([
      "slei_propose_interactive_card",
      "slei_request_visible_delegation",
      "slei_request_human_reply",
    ]);
    expect(options.disallowedTools).toContain("Task");
  });

  it("applies the same isolation boundary to every Slei permission preset", () => {
    for (const preset of ["ReadOnly", "Edit", "Controlled"] as const) {
      const options = buildIsolatedSdkOptions(preset, "/workspace/app");

      expect(options.persistSession).toBe(false);
      expect(options.settingSources).toEqual([]);
      expect(options.nativeSubagents).toEqual([]);
      expect(options.externalMcpServers).toEqual([]);
      expect(options.disallowedTools).toEqual(
        expect.arrayContaining(["Task", "mcp__*", "Plugin:*"]),
      );
    }
  });

  it("forwards canUseTool calls as pending daemon permission requests", () => {
    const request = toPermissionRequest({
      requestId: "perm_1",
      runId: "run_1",
      toolUseId: "tool_1",
      agentId: "agent_coda",
      toolName: "Write",
      input: { file_path: "/workspace/app/src/main.ts" },
    });

    expect(request).toEqual({
      type: "permission_requested",
      request_id: "perm_1",
      run_id: "run_1",
      tool_use_id: "tool_1",
      agent_id: "agent_coda",
      tool_name: "Write",
      risk: "controlled",
      input: { file_path: "/workspace/app/src/main.ts" },
    });
  });
});
