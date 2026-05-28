export type SanitizedDaemonStatus = {
  connected: boolean;
  label: string;
  daemonVersion: string;
  protocolVersion: string;
};

export type DaemonBridge = {
  daemonStatus(): Promise<SanitizedDaemonStatus>;
  subscribeEvents(after: number): Promise<void>;
};

export type DaemonBridgeMock = DaemonBridge & {
  eventSubscriptions: Array<{ after: number }>;
  setConnected(connected: boolean): void;
};

export function createDaemonBridgeMock(input: {
  connected: boolean;
}): DaemonBridgeMock {
  let connected = input.connected;
  const eventSubscriptions: Array<{ after: number }> = [];

  return {
    eventSubscriptions,
    setConnected(next) {
      connected = next;
    },
    async daemonStatus() {
      const _nativeOnly = {
        token: "secret-token",
        endpoint: "http://127.0.0.1:4319",
        socket: "ws://127.0.0.1:4319/v1/events/ws",
      };

      return {
        connected,
        label: connected ? "connected" : "offline",
        daemonVersion: "0.1.0",
        protocolVersion: "v1",
      };
    },
    async subscribeEvents(after) {
      eventSubscriptions.push({ after });
    },
  };
}
