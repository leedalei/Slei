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
      "--append-system-prompt",
      "Slei system prompt",
      "--mcp-config",
      "/tmp/slei-mcp.json",
      "--tools",
      "Bash,Skill,Read,Grep,Glob,LS,Write,Edit,MultiEdit",
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
    expect(args).not.toContain("--include-partial-messages");
    expect(args[args.indexOf("--allowedTools") + 1].split(",")).toEqual([
      "Bash",
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

  it("omits Claude CLI model args when the session model is empty", () => {
    const args = buildClaudeCliArgs(
      startRunCommand({ model: "" }),
      { mcpConfigPath: "/tmp/slei-mcp.json" },
    );

    expect(args).not.toContain("--model");
  });

  it("normalizes Claude CLI model aliases from display labels", () => {
    const args = buildClaudeCliArgs(
      startRunCommand({ model: "Fable" }),
      { mcpConfigPath: "/tmp/slei-mcp.json" },
    );

    expect(followsFlag(args, "--model")).toBe("fable");
  });

  it("folds non-resume context into the CLI prompt", () => {
    const args = buildClaudeCliArgs(
      startRunCommand({
        context: [
          { role: "user", content: "old question" },
          { role: "assistant", content: "old answer" },
        ],
      }),
      { mcpConfigPath: "/tmp/slei-mcp.json" },
    );

    expect(args.at(-1)).toBe(
      "Previous conversation context:\n\nUser: old question\n\nAssistant: old answer\n\nCurrent user message:\nhello",
    );
  });

  it("does not duplicate context for resumed CLI prompts", () => {
    const args = buildClaudeCliArgs(
      startRunCommand({
        resume_session: true,
        context: [{ role: "user", content: "old question" }],
      }),
      { mcpConfigPath: "/tmp/slei-mcp.json" },
    );

    expect(args.at(-1)).toBe("hello");
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
          command: process.execPath,
          args: ["/abs/dist/mcp-server.js", "--slei-mcp-server"],
          env: {
            SLEI_RUN_ID: "run_1",
            SLEI_AGENT_ID: "agent_guide",
            PATH: expect.any(String),
          },
        },
      },
    });
  });

  it("forwards daemon CLI environment to the Slei MCP server", () => {
    const originalUrl = process.env.SLEI_DAEMON_URL;
    const originalToken = process.env.SLEI_DAEMON_TOKEN;
    const originalPath = process.env.PATH;
    process.env.SLEI_DAEMON_URL = "http://127.0.0.1:4319";
    process.env.SLEI_DAEMON_TOKEN = "desktop-session-token";
    process.env.PATH = "/repo/target/debug:/usr/bin";

    try {
      expect(
        buildSleiMcpConfig({
          runId: "run_1",
          agentId: "agent_guide",
          serverPath: "/abs/dist/mcp-server.js",
        }).mcpServers.slei.env,
      ).toEqual({
        SLEI_RUN_ID: "run_1",
        SLEI_AGENT_ID: "agent_guide",
        SLEI_DAEMON_URL: "http://127.0.0.1:4319",
        SLEI_DAEMON_TOKEN: "desktop-session-token",
        PATH: "/repo/target/debug:/usr/bin",
      });
    } finally {
      restoreEnv("SLEI_DAEMON_URL", originalUrl);
      restoreEnv("SLEI_DAEMON_TOKEN", originalToken);
      restoreEnv("PATH", originalPath);
    }
  });

  it("normalizes Claude CLI stream-json assistant messages into runtime events", () => {
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

  it("ignores partial Claude CLI stream text deltas", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "partial JSON fragment" },
      },
    });

    expect(cliJsonLineToRuntimeEvents("run_1", "agent_guide", line)).toEqual([]);
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
    expect(call.args).toContain("--add-dir");
    expect(valuesForFlag(call.args, "--add-dir").some((value) => value.includes("/runs/"))).toBe(true);
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

  it("yields stdout events before the spawned process closes", async () => {
    const child = fakeChild();
    const spawner: ClaudeCliSpawner = () => child.process;
    const iterator = runClaudeCodeCli(
      startRunCommand({ cwd: mkdtempSync(join(tmpdir(), "slei-cli-cwd-")) }),
      { spawner },
    )[Symbol.asyncIterator]();

    child.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "streaming" }] },
      })}\n`,
    );

    await expect(nextWithTimeout(iterator)).resolves.toEqual({
      done: false,
      value: {
        type: "assistant",
        runId: "run_1",
        message: { content: [{ type: "text", text: "streaming" }] },
      },
    });

    child.stdout.end(`${JSON.stringify({ type: "result", is_error: false })}\n`);
    child.stderr.end();
    child.process.emit("close", 0);

    await iterator.return?.();
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

  it("does not retry resumed runs after stdout has produced an event", async () => {
    const spawner = fakeSpawner([
      {
        stdout: [
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "partial" }] },
          }),
          "{bad json",
        ],
        code: 1,
      },
      {
        stdout: [JSON.stringify({ type: "result", is_error: false })],
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

    expect(spawner.calls).toHaveLength(1);
    expect(events).toEqual([
      {
        type: "assistant",
        runId: "run_1",
        message: { content: [{ type: "text", text: "partial" }] },
      },
      {
        type: "failed",
        runId: "run_1",
        message: expect.stringContaining("invalid Claude CLI JSON"),
      },
    ]);
  });

  it("does not treat a successful result as completed when the CLI exits nonzero", async () => {
    const spawner = fakeSpawner([
      {
        stdout: [JSON.stringify({ type: "result", is_error: false })],
        stderr: ["late failure\n"],
        code: 1,
      },
    ]);

    const events = await collectRuntimeEvents(
      runClaudeCodeCli(startRunCommand({ cwd: mkdtempSync(join(tmpdir(), "slei-cli-cwd-")) }), {
        spawner: spawner.spawn,
      }),
    );

    expect(events).toEqual([
      {
        type: "failed",
        runId: "run_1",
        message: "Claude CLI exited with code 1\nlate failure",
      },
    ]);
  });
});

function followsFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function valuesForFlag(args: string[], flag: string): string[] {
  return args.flatMap((arg, index) => (arg === flag && args[index + 1] ? [args[index + 1]] : []));
}

function fixtureLines(name: string): string[] {
  return readFileSync(new URL(`./fixtures/cli-stream-json/${name}`, import.meta.url), "utf8")
    .trim()
    .split("\n");
}

function startRunCommand(
  overrides: Partial<
    Pick<StartRunCommand["input"], "system_prompt"> &
      Pick<StartRunCommand["input"], "context"> &
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
      context: overrides.context ?? [],
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

function fakeChild() {
  const process = new EventEmitter() as ReturnType<ClaudeCliSpawner>;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  process.stdin = new PassThrough();
  process.stdout = stdout;
  process.stderr = stderr;
  return { process, stdout, stderr };
}

async function nextWithTimeout<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
  return Promise.race([
    iterator.next(),
    new Promise<IteratorResult<T>>((_, reject) =>
      setTimeout(() => reject(new Error("timed out waiting for streamed event")), 250),
    ),
  ]);
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
