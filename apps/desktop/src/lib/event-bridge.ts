import type { DaemonBridge } from "./daemon-bridge";

export function createEventBridge(bridge: DaemonBridge) {
  return {
    async reconnectFrom(sequence: number) {
      await bridge.subscribeEvents(sequence);
    },
  };
}
