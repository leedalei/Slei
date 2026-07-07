import { contextBridge, ipcRenderer } from "electron";

type SleiPreloadChannel = "daemon.events" | "daemon.state";
type SleiPreloadHandler = (payload: unknown) => void;
type IpcListener = (event: unknown, payload: unknown) => void;

type SleiPreloadIpc = {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  off(channel: string, listener: IpcListener): void;
  on(channel: string, listener: IpcListener): void;
  send(channel: string, payload: unknown): void;
};

type SleiPreloadApiOptions = {
  createSubscriptionId?: () => string;
};

const CHANNEL_EVENT_NAMES: Record<SleiPreloadChannel, string> = {
  "daemon.events": "slei:daemon-events",
  "daemon.state": "slei:daemon-state",
};

export function createSleiPreloadApi(
  ipc: SleiPreloadIpc = ipcRenderer,
  options: SleiPreloadApiOptions = {},
) {
  const createSubscriptionId = options.createSubscriptionId ?? createDefaultSubscriptionId;

  return {
    rpc: {
      call(method: string, payload: unknown) {
        return ipc.invoke("slei:rpc", { method, payload });
      },
    },
    events: {
      subscribe(channel: SleiPreloadChannel, handler: SleiPreloadHandler) {
        const eventName = CHANNEL_EVENT_NAMES[channel];
        if (!eventName) {
          throw new Error(`Unsupported Slei event channel: ${channel}`);
        }

        const subscriptionId = createSubscriptionId();
        const listener: IpcListener = (_event, payload) => handler(payload);

        ipc.on(eventName, listener);
        ipc.send("slei:events:subscribe", { channel, subscriptionId });

        return () => {
          ipc.off(eventName, listener);
          ipc.send("slei:events:unsubscribe", { subscriptionId });
        };
      },
    },
  };
}

function createDefaultSubscriptionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const random = globalThis.crypto?.getRandomValues?.(new Uint32Array(2));
  if (random) {
    return `sub_${random[0].toString(36)}${random[1].toString(36)}`;
  }

  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

if (typeof contextBridge?.exposeInMainWorld === "function") {
  contextBridge.exposeInMainWorld("slei", createSleiPreloadApi());
}
