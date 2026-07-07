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
});
