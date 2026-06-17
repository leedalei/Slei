import type {
  GlobalAgentSearchResult,
  GlobalChannelSearchResult,
  GlobalMessageSearchResult,
  GlobalSearchQuery,
  GlobalSearchReceipt,
  GlobalSearchTimeRange,
} from "../../lib/daemon-bridge";

export const GLOBAL_SEARCH_LIMITS = {
  agents: 20,
  channels: 20,
  messages: 80,
} as const;

export type GlobalSearchTimeRangeFilter = GlobalSearchTimeRange | "7d" | "30d";

export type GlobalSearchRequestInput = {
  q: string;
  fromId?: string | null;
  channelId?: string | null;
  timeRange?: GlobalSearchTimeRangeFilter | null;
  timeZone?: string | null;
  includeAgents?: boolean;
  includeChannels?: boolean;
  includeMessages?: boolean;
  agentLimit?: number | null;
  channelLimit?: number | null;
  messageLimit?: number | null;
};

export type GlobalSearchCategory = "agents" | "channels" | "messages";

export type GlobalSearchSection =
  | {
      category: "agents";
      total: number;
      items: GlobalAgentSearchResult[];
    }
  | {
      category: "channels";
      total: number;
      items: GlobalChannelSearchResult[];
    }
  | {
      category: "messages";
      total: number;
      items: GlobalMessageSearchResult[];
    };

export type HighlightToken = {
  text: string;
  match: boolean;
};

export type GlobalMessageDisplayLabels = {
  title: string;
  subtitle: string;
  sourceLabel: string;
  authorLabel: string;
};

export function buildGlobalSearchRequest(input: GlobalSearchRequestInput): GlobalSearchQuery | null {
  const q = trimFilter(input.q);
  if (!q) return null;

  const request: GlobalSearchQuery = {
    q,
    agentLimit: clampSearchLimit(input.agentLimit, GLOBAL_SEARCH_LIMITS.agents),
    channelLimit: clampSearchLimit(input.channelLimit, GLOBAL_SEARCH_LIMITS.channels),
    messageLimit: clampSearchLimit(input.messageLimit, GLOBAL_SEARCH_LIMITS.messages),
  };
  assignTrimmed(request, "fromId", input.fromId);
  assignTrimmed(request, "channelId", input.channelId);
  assignTrimmed(request, "timeZone", input.timeZone);

  const timeRange = normalizeGlobalSearchTimeRange(input.timeRange);
  if (timeRange) request.timeRange = timeRange;
  if (input.includeAgents !== undefined) request.includeAgents = input.includeAgents;
  if (input.includeChannels !== undefined) request.includeChannels = input.includeChannels;
  if (input.includeMessages !== undefined) request.includeMessages = input.includeMessages;

  return request;
}

export function normalizeGlobalSearchTimeRange(
  timeRange?: GlobalSearchTimeRangeFilter | null,
): GlobalSearchTimeRange | undefined {
  if (!timeRange) return undefined;
  if (timeRange === "7d") return "last7Days";
  if (timeRange === "30d") return "last30Days";
  return timeRange;
}

export function createGlobalSearchSections(receipt: GlobalSearchReceipt): GlobalSearchSection[] {
  return [
    {
      category: "agents",
      total: receipt.totals.agents,
      items: receipt.agents,
    },
    {
      category: "channels",
      total: receipt.totals.channels,
      items: receipt.channels,
    },
    {
      category: "messages",
      total: receipt.totals.messages,
      items: receipt.messages,
    },
  ];
}

export function highlightSearchTokens(text: string, query: string): HighlightToken[] {
  if (!query) return [{ text, match: false }];

  const normalizedText = createNormalizedIndex(text);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [{ text, match: false }];

  const tokens: HighlightToken[] = [];
  let normalizedCursor = 0;
  let originalCursor = 0;

  while (normalizedCursor < normalizedText.text.length) {
    const index = normalizedText.text.indexOf(normalizedQuery, normalizedCursor);
    if (index === -1) break;
    const start = normalizedText.indexes[index]?.start;
    const end = normalizedText.indexes[index + normalizedQuery.length - 1]?.end;
    if (start === undefined || end === undefined || end <= originalCursor) {
      normalizedCursor = index + Math.max(1, normalizedQuery.length);
      continue;
    }
    if (start > originalCursor) {
      tokens.push({ text: text.slice(originalCursor, start), match: false });
    }
    tokens.push({ text: text.slice(start, end), match: true });
    originalCursor = end;
    normalizedCursor = index + Math.max(1, normalizedQuery.length);
  }

  if (originalCursor < text.length) {
    tokens.push({ text: text.slice(originalCursor), match: false });
  }

  return tokens.length > 0 ? tokens : [{ text, match: false }];
}

export function getGlobalMessageDisplayLabels(result: GlobalMessageSearchResult): GlobalMessageDisplayLabels {
  const authorLabel = firstText(result.authorLabel, result.authorName, result.authorHandle);
  const sourceLabel = firstText(result.sourceLabel, result.channelId, result.conversationId, result.sessionId);
  return {
    title: firstText(result.title, result.snippet),
    subtitle: [authorLabel, sourceLabel].filter(Boolean).join(" - "),
    sourceLabel,
    authorLabel,
  };
}

function trimFilter(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function assignTrimmed<T extends "fromId" | "channelId" | "timeZone">(
  request: GlobalSearchQuery,
  key: T,
  value: string | null | undefined,
) {
  const trimmed = trimFilter(value);
  if (trimmed) request[key] = trimmed;
}

function clampSearchLimit(value: number | null | undefined, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return max;
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function createNormalizedIndex(value: string): {
  text: string;
  indexes: Array<{ start: number; end: number }>;
} {
  let text = "";
  const indexes: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (const part of Array.from(value)) {
    const start = cursor;
    const end = start + part.length;
    const normalizedPart = normalizeSearchText(part);
    text += normalizedPart;
    for (let index = 0; index < normalizedPart.length; index += 1) {
      indexes.push({ start, end });
    }
    cursor = end;
  }

  return { text, indexes };
}

function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = trimFilter(value);
    if (trimmed) return trimmed;
  }
  return "";
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase();
}
