import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import type { StartRunCommand } from "./protocol.js";
import {
  buildClaudeCliArgs,
  buildSleiMcpConfig,
  cliJsonLineToRuntimeEvents,
  runClaudeCodeCli,
  type ClaudeCliSpawner,
} from "./claude-cli.js";

describe("Claude CLI runtime helpers", () => {
  const originalOverlayHome = process.env.SLEI_OVERLAY_HOME;

  afterEach(() => {
    if (originalOverlayHome === undefined) {
      delete process.env.SLEI_OVERLAY_HOME;
    } else {
      process.env.SLEI_OVERLAY_HOME = originalOverlayHome;
    }
  });

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
      "--verbose",
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
      message: { content: [{ type: "text", text: "实" }] },
    });
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

  it("spawns claude in the prepared workspace with the generated MCP config and system prompt", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "slei-cli-project-"));
    const agentPath = mkdtempSync(join(tmpdir(), "slei-cli-agent-"));
    const overlayHome = mkdtempSync(join(tmpdir(), "slei-cli-overlay-"));
    process.env.SLEI_OVERLAY_HOME = overlayHome;
    const spawner = fakeSpawner([
      {
        stdout: [
          JSON.stringify({
            type: "result",
            is_error: false,
          }),
        ],
      },
    ]);

    const events = await collectRuntimeEvents(
      runClaudeCodeCli(
        startRunCommand({
          cwd: projectPath,
          agent_workspace_path: agentPath,
          workspace_mounts: [{ path: projectPath, label: "Project" }],
          system_prompt: "Slei system prompt",
        }),
        { spawner: spawner.spawn },
      ),
    );

    expect(events).toEqual([{ type: "completed", runId: "run_1" }]);
    expect(spawner.calls).toHaveLength(1);
    const call = spawner.calls[0];
    expect(call.command).toBe("claude");
    expect(call.options.cwd).toMatch(new RegExp(`^${escapeRegExp(join(overlayHome, "runs"))}`));
    expect(call.args).toContain("--append-system-prompt");
    expect(call.args[call.args.indexOf("--append-system-prompt") + 1]).toBe("Slei system prompt");
    const mcpConfigPath = call.args[call.args.indexOf("--mcp-config") + 1];
    expect(existsSync(mcpConfigPath)).toBe(false);
  });

  it("maps successful stdout stream-json to assistant and completed runtime events", async () => {
    const spawner = fakeSpawner([
      {
        stdout: [
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "hello" }] },
          }),
          JSON.stringify({ type: "result", is_error: false }),
        ],
      },
    ]);

    const events = await collectRuntimeEvents(
      runClaudeCodeCli(startRunCommand({ cwd: mkdtempSync(join(tmpdir(), "slei-cli-cwd-")) }), {
        spawner: spawner.spawn,
      }),
    );

    expect(events).toEqual([
      {
        type: "assistant",
        runId: "run_1",
        message: { content: [{ type: "text", text: "hello" }] },
      },
      { type: "completed", runId: "run_1" },
    ]);
  });

  it("fails with stderr when claude exits nonzero before a terminal event", async () => {
    const spawner = fakeSpawner([
      {
        stderr: ["No conversation found for session bad-session\n"],
        code: 1,
      },
    ]);

    const events = await collectRuntimeEvents(
      runClaudeCodeCli(
        startRunCommand({
          cwd: mkdtempSync(join(tmpdir(), "slei-cli-cwd-")),
          session_id: "bad-session",
          persist_session: true,
          resume_session: false,
        }),
        { spawner: spawner.spawn },
      ),
    );

    expect(events).toEqual([
      {
        type: "failed",
        runId: "run_1",
        message: "Claude CLI exited with code 1\nNo conversation found for session bad-session",
      },
    ]);
  });

  it("retries resumed runs as a fresh session when claude fails before producing events", async () => {
    const spawner = fakeSpawner([
      {
        stderr: ["No conversation found for session 11111111-1111-4111-8111-111111111111\n"],
        code: 1,
      },
      {
        stdout: [
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "fresh hello" }] },
          }),
          JSON.stringify({ type: "result", is_error: false }),
        ],
      },
    ]);

    const events = await collectRuntimeEvents(
      runClaudeCodeCli(
        startRunCommand({
          cwd: mkdtempSync(join(tmpdir(), "slei-cli-cwd-")),
          persist_session: true,
          resume_session: true,
        }),
        { spawner: spawner.spawn },
      ),
    );

    expect(spawner.calls).toHaveLength(2);
    expect(followsFlag(spawner.calls[0].args, "--resume")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(spawner.calls[0].args).not.toContain("--session-id");
    expect(followsFlag(spawner.calls[1].args, "--session-id")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(spawner.calls[1].args).not.toContain("--resume");
    expect(events).toEqual([
      {
        type: "assistant",
        runId: "run_1",
        message: { content: [{ type: "text", text: "fresh hello" }] },
      },
      { type: "completed", runId: "run_1" },
    ]);
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
        | "session_id"
        | "cwd"
        | "agent_workspace_path"
        | "model"
        | "additional_directories"
        | "workspace_mounts"
        | "persist_session"
        | "resume_session"
      >
  > = {},
): StartRunCommand {
  const cwd = overrides.cwd ?? "/workspace/project";
  if (!cwd.startsWith("/workspace")) {
    mkdirSync(cwd, { recursive: true });
  }
  return {
    type: "start_run",
    run_id: "run_1",
    session: {
      session_id: overrides.session_id ?? "11111111-1111-4111-8111-111111111111",
      agent_id: "agent_guide",
      runtime: "ClaudeCode",
      cwd,
      agent_workspace_path: overrides.agent_workspace_path,
      additional_directories: overrides.additional_directories,
      workspace_mounts: overrides.workspace_mounts,
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

async function collectRuntimeEvents(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const collected: unknown[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function fakeSpawner(scripts: FakeSpawnScript[]) {
  const calls: Array<{
    command: string;
    args: string[];
    options: { cwd?: string | URL };
  }> = [];
  const spawn: ClaudeCliSpawner = (command, args, options) => {
    calls.push({ command, args, options });
    const script = scripts.shift() ?? {};
    const child = new EventEmitter() as ReturnType<ClaudeCliSpawner>;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    setImmediate(() => {
      if (script.error) {
        child.emit("error", script.error);
        return;
      }
      for (const chunk of script.stdout ?? []) {
        stdout.write(`${chunk}\n`);
      }
      for (const chunk of script.stderr ?? []) {
        stderr.write(chunk);
      }
      stdout.end();
      stderr.end();
      child.emit("close", script.code ?? 0);
    });
    return child;
  };
  return { spawn, calls };
}

type FakeSpawnScript = {
  stdout?: string[];
  stderr?: string[];
  code?: number;
  error?: Error;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
