import type { DaemonEventView, EventReconnectReceipt } from "../lib/daemon-types.js";

const FAST_POLL_MS = 250;
const INITIAL_EMPTY_BACKOFF_MS = 1000;
const MAX_EMPTY_BACKOFF_MS = 10000;

export type EventForwarder = {
  after(): number;
  start(): void;
  stop(): void;
  unsubscribe(): void;
  tick(): Promise<void>;
};

export type EventForwarderOptions = {
  reconnect(after: number): Promise<Pick<EventReconnectReceipt, "events">>;
  emit(batch: EventReconnectReceipt): void;
  initialAfter?: number;
  setTimeoutImpl?: (handler: () => void, delayMs: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
};

export function createEventForwarder(options: EventForwarderOptions): EventForwarder {
  const setTimeoutImpl = options.setTimeoutImpl ?? ((handler, delayMs) => globalThis.setTimeout(handler, delayMs));
  const clearTimeoutImpl =
    options.clearTimeoutImpl ??
    ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));

  let afterSequence = options.initialAfter ?? 0;
  let subscribed = true;
  let running = false;
  let timerHandle: unknown;
  let tickInFlight: Promise<void> | undefined;
  let nextDelayMs = INITIAL_EMPTY_BACKOFF_MS;
  let emptyBackoffMs = INITIAL_EMPTY_BACKOFF_MS;

  function after() {
    return afterSequence;
  }

  function start() {
    if (running) {
      return;
    }
    running = true;
    schedule(0);
  }

  function stop() {
    running = false;
    clearTimer();
  }

  function unsubscribe() {
    subscribed = false;
    stop();
  }

  async function tick() {
    if (tickInFlight) {
      return tickInFlight;
    }

    tickInFlight = runTick().finally(() => {
      tickInFlight = undefined;
    });
    return tickInFlight;
  }

  async function runTick() {
    if (!subscribed) {
      return;
    }

    try {
      const receipt = await options.reconnect(afterSequence);
      if (!subscribed) {
        return;
      }

      const events = Array.isArray(receipt.events) ? receipt.events : [];
      if (events.length === 0) {
        advanceBackoff();
        return;
      }

      afterSequence = maxSequence(afterSequence, events);
      nextDelayMs = FAST_POLL_MS;
      emptyBackoffMs = INITIAL_EMPTY_BACKOFF_MS;
      options.emit({ after: afterSequence, events });
    } catch {
      advanceBackoff();
    }
  }

  function advanceBackoff() {
    nextDelayMs = emptyBackoffMs;
    emptyBackoffMs = Math.min(emptyBackoffMs * 2, MAX_EMPTY_BACKOFF_MS);
  }

  function schedule(delayMs: number) {
    if (!running || !subscribed || timerHandle !== undefined) {
      return;
    }

    timerHandle = setTimeoutImpl(() => {
      timerHandle = undefined;
      void runScheduledTick();
    }, delayMs);
  }

  async function runScheduledTick() {
    await tick();
    schedule(nextDelayMs);
  }

  function clearTimer() {
    if (timerHandle === undefined) {
      return;
    }

    clearTimeoutImpl(timerHandle);
    timerHandle = undefined;
  }

  return { after, start, stop, unsubscribe, tick };
}

function maxSequence(current: number, events: DaemonEventView[]) {
  return events.reduce((max, event) => (event.sequence > max ? event.sequence : max), current);
}
