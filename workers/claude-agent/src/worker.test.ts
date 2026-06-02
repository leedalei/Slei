import { describe, expect, it } from "vitest";

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildClaudeCliArgs,
  buildClaudeSdkOptions,
  buildClearClaudeSessionCliArgs,
  ClaudeAgentWorker,
  runClaudeCode,
  type RuntimeRunner,
} from "./worker.js";
import type { WorkerEvent } from "./protocol.js";

describe("ClaudeAgentWorker start_run", () => {
  it("rejects start_run before hello authorization", async () => {
    const events: WorkerEvent[] = [];
    const runner: RuntimeRunner = async function* () {
      yield { type: "completed", runId: "run_1" };
    };
    const worker = new ClaudeAgentWorker("secret", { writeEvent: (event) => events.push(event) }, runner);

    await worker.handleCommand({
      type: "start_run",
      run_id: "run_1",
      session: {
        session_id: "session_1",
        agent_id: "agent_coda",
        runtime: "ClaudeCode",
        cwd: "/workspace",
        persist_session: false,
        resume_session: false,
      },
      input: { prompt: "hello", context: [] },
    });

    expect(events).toEqual([{ type: "failed", run_id: "unknown", message: "worker command rejected before hello" }]);
  });

  it("runs Claude runtime for start_run and maps output to worker events", async () => {
    const events: WorkerEvent[] = [];
    const prompts: Array<{ prompt: string; cwd: string }> = [];
    const runner: RuntimeRunner = async function* (command) {
      prompts.push({ prompt: command.input.prompt, cwd: command.session.cwd });
      yield { type: "assistant", runId: command.run_id, message: { content: [{ type: "text", text: "hello" }] } };
      yield { type: "completed", runId: command.run_id };
    };
    const worker = new ClaudeAgentWorker("secret", { writeEvent: (event) => events.push(event) }, runner);

    await worker.handleCommand({ type: "hello", protocol_version: "v1", launch_secret: "secret" });
    await worker.handleCommand({
      type: "start_run",
      run_id: "run_1",
      session: {
        session_id: "session_1",
        agent_id: "agent_coda",
        runtime: "ClaudeCode",
        cwd: "/workspace",
        persist_session: false,
        resume_session: false,
      },
      input: { prompt: "hello", context: [] },
    });

    expect(prompts).toEqual([{ prompt: "hello", cwd: "/workspace" }]);
    expect(events).toEqual([
      { type: "output_delta", run_id: "run_1", delta: "hello" },
      { type: "completed", run_id: "run_1" },
    ]);
  });

  it("emits failed when the runtime runner throws", async () => {
    const events: WorkerEvent[] = [];
    const runner: RuntimeRunner = async function* () {
      throw new Error("claude auth missing");
    };
    const worker = new ClaudeAgentWorker("secret", { writeEvent: (event) => events.push(event) }, runner);

    await worker.handleCommand({ type: "hello", protocol_version: "v1", launch_secret: "secret" });
    await worker.handleCommand({
      type: "start_run",
      run_id: "run_1",
      session: {
        session_id: "session_1",
        agent_id: "agent_coda",
        runtime: "ClaudeCode",
        cwd: "/workspace",
        persist_session: false,
        resume_session: false,
      },
      input: { prompt: "hello", context: [] },
    });

    expect(events).toEqual([{ type: "failed", run_id: "run_1", message: "claude auth missing" }]);
  });

  it("uses --session-id for first persistent runs and --resume for resumed runs", () => {
    expect(buildClaudeCliArgs({
      type: "start_run",
      run_id: "run_1",
      session: {
        session_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "agent_coda",
        runtime: "ClaudeCode",
        cwd: "/workspace",
        persist_session: true,
        resume_session: false,
      },
      input: {
        prompt: "hello",
        context: [{ role: "user", content: "previous" }],
      },
    })).toEqual([
      "-p",
      "Previous conversation context:\n\nUser: previous\n\nCurrent user message:\nhello",
      "--output-format",
      "text",
      "--permission-mode",
      "bypassPermissions",
      "--session-id",
      "11111111-1111-4111-8111-111111111111",
    ]);

    expect(buildClaudeCliArgs({
      type: "start_run",
      run_id: "run_2",
      session: {
        session_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "agent_coda",
        runtime: "ClaudeCode",
        cwd: "/workspace",
        persist_session: true,
        resume_session: true,
      },
      input: {
        prompt: "follow up",
        context: [{ role: "user", content: "do not duplicate" }],
      },
    })).toEqual([
      "-p",
      "follow up",
      "--output-format",
      "text",
      "--permission-mode",
      "bypassPermissions",
      "--resume",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("uses Claude slash clear against the active persisted session", () => {
    expect(buildClearClaudeSessionCliArgs({
      type: "clear_session",
      session: {
        session_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "agent_coda",
        runtime: "ClaudeCode",
        cwd: "/workspace",
        persist_session: true,
        resume_session: true,
      },
    })).toEqual([
      "-p",
      "/clear",
      "--output-format",
      "text",
      "--resume",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("runs through Claude Agent SDK and maps Slei MCP tools to daemon product tool events", async () => {
    const command = {
      type: "start_run" as const,
      run_id: "run_1",
      session: {
        session_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "agent_guide",
        runtime: "ClaudeCode" as const,
        cwd: "/workspace/agent_guide",
        persist_session: true,
        resume_session: false,
      },
      input: {
        prompt: "帮我创建 Bob",
        context: [],
      },
    };
    const seenOptions: unknown[] = [];
    const query = (params: { options?: unknown }) =>
      (async function* () {
        seenOptions.push(params.options);
        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "准备创建。" }],
          },
        };
        yield {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool_1",
                name: "mcp__slei__slei_propose_interactive_card",
                input: {
                  kind: "createAgent",
                  title: "创建 Bob",
                  draft: { name: "Bob" },
                },
              },
            ],
          },
        };
        yield { type: "result" };
      })();

    const events: unknown[] = [];
    for await (const event of runClaudeCode(command, query)) {
      events.push(event);
    }

    expect(seenOptions[0]).toMatchObject({
      cwd: "/workspace/agent_guide",
      sessionId: "11111111-1111-4111-8111-111111111111",
      permissionMode: "default",
      allowedTools: [
        "mcp__slei__slei_propose_interactive_card",
        "mcp__slei__slei_request_visible_delegation",
        "mcp__slei__slei_request_human_reply",
      ],
      mcpServers: { slei: expect.any(Object) },
      strictMcpConfig: true,
    });
    expect(events).toEqual([
      {
        type: "assistant",
        runId: "run_1",
        message: { content: [{ type: "text", text: "准备创建。" }] },
      },
      {
        type: "product_tool",
        runId: "run_1",
        toolUseId: "tool_1",
        agentId: "agent_guide",
        toolName: "slei_propose_interactive_card",
        payload: {
          kind: "createAgent",
          title: "创建 Bob",
          draft: { name: "Bob" },
        },
      },
      { type: "completed", runId: "run_1" },
    ]);
  });

  it("fails fast when Claude Agent SDK reports an API retry", async () => {
    const command = {
      type: "start_run" as const,
      run_id: "run_1",
      session: {
        session_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "agent_guide",
        runtime: "ClaudeCode" as const,
        cwd: "/workspace/agent_guide",
        persist_session: true,
        resume_session: false,
      },
      input: {
        prompt: "帮我创建 Bob",
        context: [],
      },
    };
    const query = () =>
      (async function* () {
        yield {
          type: "system",
          subtype: "api_retry",
          attempt: 1,
          max_retries: 10,
          retry_delay_ms: 500,
          error_status: 429,
          error: "rate_limit",
        };
        yield { type: "result" };
      })();

    const events: unknown[] = [];
    for await (const event of runClaudeCode(command, query)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "failed",
        runId: "run_1",
        message: "Claude API rate_limit (HTTP 429). Retry 1/10 was scheduled after 500ms.",
      },
    ]);
  });

  it("injects Slei agent identity and skills into the SDK system prompt", () => {
    const cwd = mkdtempSync(join(tmpdir(), "slei-agent-context-"));
    mkdirSync(join(cwd, "skills"));
    writeFileSync(join(cwd, "MEMORY.md"), "# Yeal\n\n## Role\nSlei guide");
    writeFileSync(
      join(cwd, "skills", "guide-create.skill.md"),
      "Trigger when the user asks Yeal to create an agent or member.",
    );

    const options = buildClaudeSdkOptions({
      type: "start_run",
      run_id: "run_1",
      session: {
        session_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "agent_guide",
        runtime: "ClaudeCode",
        cwd,
        persist_session: true,
        resume_session: false,
      },
      input: { prompt: "hello", context: [] },
    });

    expect(options.systemPrompt).toMatchObject({
      type: "preset",
      preset: "claude_code",
      append: expect.stringContaining("Slei guide"),
    });
    expect(JSON.stringify(options.systemPrompt)).toContain("guide-create.skill.md");
    expect(JSON.stringify(options.systemPrompt)).toContain("slei_propose_interactive_card");
  });

  it("passes the Slei runtime model to Claude Agent SDK", () => {
    const options = buildClaudeSdkOptions({
      type: "start_run",
      run_id: "run_1",
      session: {
        session_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "agent_guide",
        runtime: "ClaudeCode",
        cwd: "/workspace/agent_guide",
        model: "Sonnet",
        persist_session: true,
        resume_session: false,
      },
      input: { prompt: "hello", context: [] },
    });

    expect(options.model).toBe("sonnet");
  });
});
