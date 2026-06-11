import type { SleiFixtures } from "./types";

export function createEmptySleiData(overrides: Partial<SleiFixtures> = {}): SleiFixtures {
  return {
    nodes: [],
    conversations: [],
    conversationSessions: [],
    channels: [],
    messages: [],
    tasks: [],
    members: [],
    ...overrides,
  };
}
