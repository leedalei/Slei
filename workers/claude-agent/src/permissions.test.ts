import { describe, expect, it } from "vitest";

import { buildIsolatedSdkOptions, createRunPermissionController, toPermissionRequest } from "./permissions.js";

describe("Slei Claude SDK permission profile", () => {
  it("keeps local Claude settings while overriding the Slei permission boundary", () => {
    const options = buildIsolatedSdkOptions("Controlled", "/workspace/app");

    expect(options.persistSession).toBe(false);
    expect(options).not.toHaveProperty("strictMcpConfig");
    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(options.skills).toBe("all");
    expect(options.allowedTools).toEqual([
      "Skill",
      "Read",
      "Grep",
      "Glob",
      "LS",
      "mcp__slei__slei_propose_interactive_card",
      "mcp__slei__slei_request_visible_delegation",
      "mcp__slei__slei_request_human_reply",
    ]);
    expect(options.tools).toEqual([
      "Skill",
      "Read",
      "Grep",
      "Glob",
      "LS",
      "Write",
      "Edit",
      "MultiEdit",
    ]);
    expect(options.disallowedTools).toContain("Task");
    expect(options.disallowedTools).not.toContain("mcp__*");
  });

  it("allows reads everywhere and writes inside the current workspace", async () => {
    const controller = createRunPermissionController({
      runId: "run_1",
      agentId: "agent_coda",
      cwd: "/workspace/app",
      sessionId: "session_1",
    });
    const options = buildIsolatedSdkOptions("Controlled", "/workspace/app", controller);
    const canUseTool = options.canUseTool;

    await expect(canUseTool("Read", { file_path: "/Users/lei/private.txt" }, toolOptions("tool_read"))).resolves.toMatchObject({
      behavior: "allow",
    });
    await expect(canUseTool("Write", { file_path: "/workspace/app/src/main.ts" }, toolOptions("tool_write"))).resolves.toMatchObject({
      behavior: "allow",
    });
  });

  it("requests approval for outside-workspace writes and resolves approve once", async () => {
    const controller = createRunPermissionController({
      runId: "run_1",
      agentId: "agent_coda",
      cwd: "/workspace/app",
      sessionId: "session_1",
    });
    const options = buildIsolatedSdkOptions("Controlled", "/workspace/app", controller);
    const pending = options.canUseTool("Write", { file_path: "/Users/lei/outside.ts" }, toolOptions("tool_1"));
    const request = await controller.nextPermissionRequest();

    expect(request).toMatchObject({
      type: "permission_request",
      requestId: expect.stringMatching(/^perm_/),
      runId: "run_1",
      toolUseId: "tool_1",
      agentId: "agent_coda",
      toolName: "Write",
      risk: "controlled",
      input: { file_path: "/Users/lei/outside.ts" },
    });

    controller.resolvePermission({ requestId: request.requestId, decision: "approve_once" });

    await expect(pending).resolves.toMatchObject({
      behavior: "allow",
      toolUseID: "tool_1",
    });
  });

  it("allows writes inside configured additional directories", async () => {
    const controller = createRunPermissionController({
      runId: "run_1",
      agentId: "agent_1",
      cwd: "/overlay/run",
      allowedDirectories: ["/workspace/api", "/workspace/web"],
      sessionId: "session_1",
    });

    await expect(
      controller.canUseTool("Edit", { file_path: "/workspace/api/src/index.ts" }, toolOptions("tool_allowed")),
    ).resolves.toMatchObject({ behavior: "allow" });

    const pending = controller.canUseTool("Edit", { file_path: "/workspace/other/src/index.ts" }, toolOptions("tool_blocked"));
    const request = await controller.nextPermissionRequest();
    expect(request).toMatchObject({
      targetPath: "/workspace/other/src/index.ts",
    });
    controller.resolvePermission({ requestId: request.requestId, decision: "deny" });
    await expect(pending).resolves.toMatchObject({ behavior: "deny" });
  });

  it("remembers approve session only for the current session", async () => {
    const first = createRunPermissionController({
      runId: "run_1",
      agentId: "agent_coda",
      cwd: "/workspace/app",
      sessionId: "session_1",
    });
    const firstOptions = buildIsolatedSdkOptions("Controlled", "/workspace/app", first);
    const pending = firstOptions.canUseTool("Edit", { file_path: "/Users/lei/outside.ts" }, toolOptions("tool_1"));
    const request = await first.nextPermissionRequest();
    first.resolvePermission({ requestId: request.requestId, decision: "approve_session" });
    await expect(pending).resolves.toMatchObject({ behavior: "allow" });

    await expect(firstOptions.canUseTool("Edit", { file_path: "/Users/lei/outside.ts" }, toolOptions("tool_2"))).resolves.toMatchObject({
      behavior: "allow",
    });

    const second = createRunPermissionController({
      runId: "run_2",
      agentId: "agent_coda",
      cwd: "/workspace/app",
      sessionId: "session_2",
    });
    const secondOptions = buildIsolatedSdkOptions("Controlled", "/workspace/app", second);
    void secondOptions.canUseTool("Edit", { file_path: "/Users/lei/outside.ts" }, toolOptions("tool_3"));

    await expect(second.nextPermissionRequest()).resolves.toMatchObject({
      runId: "run_2",
      toolUseId: "tool_3",
    });
  });

  it("denies unsupported dangerous tools without prompting", async () => {
    const controller = createRunPermissionController({
      runId: "run_1",
      agentId: "agent_coda",
      cwd: "/workspace/app",
      sessionId: "session_1",
    });
    const options = buildIsolatedSdkOptions("Controlled", "/workspace/app", controller);

    await expect(options.canUseTool("Bash", { command: "rm -rf /tmp/x" }, toolOptions("tool_bash"))).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("not allowed"),
    });
  });

  it("applies the same isolation boundary to every Slei permission preset", () => {
    for (const preset of ["ReadOnly", "Edit", "Controlled"] as const) {
      const options = buildIsolatedSdkOptions(preset, "/workspace/app");

      expect(options.persistSession).toBe(false);
      expect(options).not.toHaveProperty("strictMcpConfig");
      expect(options.settingSources).toEqual(["user", "project", "local"]);
      expect(options.skills).toBe("all");
      expect(options.disallowedTools).toEqual(
        expect.arrayContaining(["Task", "Plugin:*"]),
      );
      expect(options.disallowedTools).not.toContain("mcp__*");
    }
  });

  it("allows Claude Skill invocation as a read-only project capability", async () => {
    const options = buildIsolatedSdkOptions("Controlled", "/workspace/app");

    await expect(options.canUseTool("Skill", { name: "memory" }, toolOptions("tool_skill"))).resolves.toMatchObject({
      behavior: "allow",
    });
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

function toolOptions(toolUseID: string) {
  return {
    signal: new AbortController().signal,
    toolUseID,
  };
}
