import { describe, expect, it, vi } from "vitest";
import { createEventForwarder } from "./event-forwarder";

describe("event forwarder", () => {
  it("advances sequence and emits event batches", async () => {
    const reconnect = vi.fn().mockResolvedValue({
      events: [{ sequence: 8, eventType: "task_thread.updated", occurredAtUnixMs: 1, payload: {} }],
    });
    const emit = vi.fn();
    const forwarder = createEventForwarder({ reconnect, emit, setTimeoutImpl: vi.fn() as never });

    await forwarder.tick();

    expect(emit).toHaveBeenCalledWith({ after: 8, events: expect.any(Array) });
    expect(forwarder.after()).toBe(8);
  });

  it("does not emit after unsubscribe", async () => {
    const reconnect = vi.fn().mockResolvedValue({
      events: [{ sequence: 1, eventType: "x", occurredAtUnixMs: 1, payload: {} }],
    });
    const emit = vi.fn();
    const forwarder = createEventForwarder({ reconnect, emit, setTimeoutImpl: vi.fn() as never });

    forwarder.unsubscribe();
    await forwarder.tick();

    expect(emit).not.toHaveBeenCalled();
  });

  it("does not apply in-flight tick results after stop", async () => {
    let resolveReconnect: (receipt: {
      events: Array<{ sequence: number; eventType: string; occurredAtUnixMs: number; payload: Record<string, never> }>;
    }) => void;
    const reconnect = vi.fn(
      () =>
        new Promise<{
          events: Array<{ sequence: number; eventType: string; occurredAtUnixMs: number; payload: Record<string, never> }>;
        }>((resolve) => {
          resolveReconnect = resolve;
        }),
    );
    const emit = vi.fn();
    const forwarder = createEventForwarder({ reconnect, emit, setTimeoutImpl: vi.fn() as never });

    const tick = forwarder.tick();
    forwarder.stop();
    resolveReconnect!({
      events: [{ sequence: 7, eventType: "task_thread.updated", occurredAtUnixMs: 1, payload: {} }],
    });
    await tick;

    expect(emit).not.toHaveBeenCalled();
    expect(forwarder.after()).toBe(0);
  });
});
