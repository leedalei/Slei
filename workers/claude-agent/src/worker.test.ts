import { describe, expect, it } from "vitest";

import {
  buildClearClaudeSessionCliArgs,
  ClaudeAgentWorker,
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
    const runner: RuntimeRunner = async function* (command, ...unexpectedArgs) {
      expect(unexpectedArgs).toEqual([]);
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

  it("ignores resolve_permission commands for missing requests after authorization", async () => {
    const events: WorkerEvent[] = [];
    const runner: RuntimeRunner = async function* () {
      yield { type: "completed", runId: "run_1" };
    };
    const worker = new ClaudeAgentWorker("secret", { writeEvent: (event) => events.push(event) }, runner);

    await worker.handleCommand({ type: "hello", protocol_version: "v1", launch_secret: "secret" });
    await worker.handleCommand({
      type: "resolve_permission",
      request_id: "perm_missing",
      decision: "approve_once",
    });

    expect(events).toEqual([]);
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
});
