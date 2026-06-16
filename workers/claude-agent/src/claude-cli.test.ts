import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { StartRunCommand } from "./protocol.js";
import { buildClaudeCliArgs, buildSleiMcpConfig, cliJsonLineToRuntimeEvents } from "./claude-cli.js";

describe("Claude CLI runtime helpers", () => {
  it("builds Claude CLI args with system prompt, MCP config, model and session", () => {
    const command = startRunCommand({
      system_prompt: "Slei system prompt",
      model: "Sonnet",
      additional_directories: ["/workspace/shared"],
    });
    const mcpConfigPath = "/tmp/slei-mcp.json";

    const args = buildClaudeCliArgs(command, { mcpConfigPath });

    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--append-system-prompt",
      "Slei system prompt",
      "--mcp-config",
      "/tmp/slei-mcp.json",
      "--tools",
      "Skill,Read,Grep,Glob,LS,Write,Edit,MultiEdit",
      "--allowedTools",
      expect.stringContaining("mcp__slei__slei_propose_interactive_card"),
      "--disallowedTools",
      "Task,Plugin:*,Bash:curl,Bash:wget",
      "--setting-sources",
      "user,project,local",
      "--permission-mode",
      "default",
      "--model",
      "sonnet",
      "--add-dir",
      "/workspace/shared",
      "--session-id",
      "11111111-1111-4111-8111-111111111111",
      "hello",
    ]);
    expect(args[args.indexOf("--allowedTools") + 1].split(",")).toEqual([
      "Skill",
      "Read",
      "Grep",
      "Glob",
      "LS",
      "mcp__slei__slei_propose_interactive_card",
      "mcp__slei__slei_request_visible_delegation",
      "mcp__slei__slei_request_human_reply",
    ]);
  });

  it("builds Claude CLI args for resume and non-persistent sessions", () => {
    const resumeArgs = buildClaudeCliArgs(
      startRunCommand({ persist_session: true, resume_session: true }),
      { mcpConfigPath: "/tmp/slei-mcp.json" },
    );
    const nonPersistentArgs = buildClaudeCliArgs(
      startRunCommand({ persist_session: false, resume_session: false }),
      { mcpConfigPath: "/tmp/slei-mcp.json" },
    );

    expect(followsFlag(resumeArgs, "--resume")).toBe("11111111-1111-4111-8111-111111111111");
    expect(resumeArgs).not.toContain("--session-id");
    expect(nonPersistentArgs).toContain("--no-session-persistence");
    expect(nonPersistentArgs).not.toContain("--session-id");
    expect(nonPersistentArgs).not.toContain("--resume");
  });

  it("builds MCP config for the Slei stdio server", () => {
    expect(
      buildSleiMcpConfig({
        runId: "run_1",
        agentId: "agent_guide",
        serverPath: "/abs/dist/mcp-server.js",
      }),
    ).toEqual({
      mcpServers: {
        slei: {
          type: "stdio",
          command: "node",
          args: ["/abs/dist/mcp-server.js"],
          env: {
            SLEI_RUN_ID: "run_1",
            SLEI_AGENT_ID: "agent_guide",
          },
        },
      },
    });
  });

  it("normalizes Claude CLI stream-json into runtime events", () => {
    const lines = fixtureLines("success.jsonl");
    const events = lines.flatMap((line) => cliJsonLineToRuntimeEvents("run_1", "agent_guide", line));

    expect(events).toContainEqual({
      type: "assistant",
      runId: "run_1",
      message: { content: [{ type: "text", text: "准" }] },
    });
    expect(events).toContainEqual({
      type: "assistant",
      runId: "run_1",
      message: { content: [{ type: "text", text: "备完成。" }] },
    });
    expect(events).toContainEqual({
      type: "tool_use",
      runId: "run_1",
      id: "tool_read",
      name: "Read",
    });
    expect(events).toContainEqual({
      type: "tool_result",
      runId: "run_1",
      toolUseId: "tool_read",
      isError: false,
    });
    expect(events).toContainEqual({
      type: "product_tool",
      runId: "run_1",
      toolUseId: "tool_card",
      agentId: "agent_guide",
      toolName: "slei_propose_interactive_card",
      payload: expect.objectContaining({ kind: "createAgent" }),
    });
    expect(events).toContainEqual({ type: "completed", runId: "run_1" });
  });

  it("normalizes Claude CLI result errors into failed runtime events", () => {
    const lines = fixtureLines("error.jsonl");
    const events = lines.flatMap((line) => cliJsonLineToRuntimeEvents("run_1", "agent_guide", line));

    expect(events).toContainEqual({
      type: "failed",
      runId: "run_1",
      message: "tool failed error_during_execution",
    });
  });

  it("throws a clear error for malformed Claude CLI JSON lines", () => {
    const badLine = readFileSync(
      new URL("./fixtures/cli-stream-json/bad-line.txt", import.meta.url),
      "utf8",
    ).trim();

    expect(() => cliJsonLineToRuntimeEvents("run_1", "agent_guide", badLine)).toThrow(
      /invalid Claude CLI JSON/,
    );
  });
});

function followsFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function fixtureLines(name: string): string[] {
  return readFileSync(new URL(`./fixtures/cli-stream-json/${name}`, import.meta.url), "utf8")
    .trim()
    .split("\n");
}

function startRunCommand(
  overrides: Partial<
    Pick<StartRunCommand["input"], "system_prompt"> &
      Pick<
        StartRunCommand["session"],
        "model" | "additional_directories" | "persist_session" | "resume_session"
      >
  > = {},
): StartRunCommand {
  return {
    type: "start_run",
    run_id: "run_1",
    session: {
      session_id: "11111111-1111-4111-8111-111111111111",
      agent_id: "agent_guide",
      runtime: "ClaudeCode",
      cwd: "/workspace/project",
      additional_directories: overrides.additional_directories,
      model: overrides.model,
      persist_session: overrides.persist_session ?? true,
      resume_session: overrides.resume_session ?? false,
    },
    input: {
      prompt: "hello",
      system_prompt: overrides.system_prompt,
      context: [],
    },
  };
}
