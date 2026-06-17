import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { Calendar, Check, Hash, LoaderCircle, Search, UserRound, X } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type {
  GlobalAgentSearchResult,
  GlobalChannelSearchResult,
  GlobalMessageSearchResult,
  GlobalSearchQuery,
  GlobalSearchReceipt,
} from "../../lib/daemon-bridge";
import type { SleiFixtures } from "../../app/types";
import {
  formatMessageDateTime,
  localHumanPresentation,
  stripChannelHash,
  type UserProfile,
} from "../../app/model";
import { Empty, MemberAvatar } from "../../components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  buildGlobalSearchRequest,
  createGlobalSearchSections,
  highlightSearchTokens,
  type GlobalSearchTimeRangeFilter,
  type GlobalMessageDisplayLabels,
} from "./globalSearch";

type SearchStatus = "idle" | "loading" | "success" | "error";

type SearchFromOption = {
  id: string;
  label: string;
  subtitle?: string;
};

type SelectOption = {
  id: string;
  label: string;
  subtitle?: string;
};

export function SearchPage({
  data,
  messages,
  onAgentResultSelect,
  onChannelResultSelect,
  onGlobalSearch,
  onMessageResultSelect,
  onResultSelect,
  profile,
  timeZone,
}: {
  data: SleiFixtures;
  messages: DesktopMessages;
  onAgentResultSelect?: (agentId: string) => void;
  onChannelResultSelect?: (channelId: string) => void;
  onGlobalSearch?: (query: GlobalSearchQuery) => Promise<GlobalSearchReceipt> | GlobalSearchReceipt;
  onMessageResultSelect?: (result: GlobalMessageSearchResult) => void;
  onResultSelect?: (channelId: string, messageId: string) => void;
  profile?: UserProfile | null;
  timeZone?: string;
}) {
  const [query, setQuery] = useState("");
  const [fromId, setFromId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [timeRange, setTimeRange] = useState<GlobalSearchTimeRangeFilter>("any");
  const [openFilter, setOpenFilter] = useState<"from" | "channel" | "time" | undefined>();
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [receipt, setReceipt] = useState<GlobalSearchReceipt | undefined>();
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeRequestKey, setActiveRequestKey] = useState("");
  const requestSequenceRef = useRef(0);

  const fromOptions = useMemo(() => createFromOptions(data, profile ?? null, messages), [data, messages, profile]);
  const channelOptions = useMemo(() => data.channels.map((channel) => ({
    id: channel.id,
    label: `#${stripChannelHash(channel.name)}`,
    subtitle: channel.description,
  })), [data.channels]);
  const timeOptions = useMemo(() => [
    { id: "any", label: messages.search.filters.timeRange.any },
    { id: "today", label: messages.search.filters.timeRange.today },
    { id: "last7Days", label: messages.search.filters.timeRange.last7Days },
    { id: "last30Days", label: messages.search.filters.timeRange.last30Days },
  ], [messages]);

  const selectedFrom = fromOptions.find((option) => option.id === fromId);
  const selectedChannel = channelOptions.find((option) => option.id === channelId);
  const selectedTime = timeOptions.find((option) => option.id === timeRange) ?? timeOptions[0];
  const sections = receipt ? createGlobalSearchSections(receipt) : [];
  const hasResults = sections.some((section) => section.items.length > 0);
  const currentRequest = buildCurrentSearchRequest();
  const currentRequestKey = currentRequest ? stableGlobalSearchRequestKey(currentRequest) : "";
  const submitDisabled = status === "loading" && currentRequestKey === activeRequestKey;

  function buildCurrentSearchRequest() {
    return buildGlobalSearchRequest({
      q: query,
      fromId,
      channelId,
      timeRange: timeRange === "any" ? undefined : timeRange,
      timeZone,
    });
  }

  async function submitSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const request = buildCurrentSearchRequest();
    setOpenFilter(undefined);
    if (!request) {
      requestSequenceRef.current += 1;
      setActiveRequestKey("");
      setStatus("idle");
      setReceipt(undefined);
      setSubmittedQuery("");
      return;
    }

    const requestKey = stableGlobalSearchRequestKey(request);
    if (status === "loading" && requestKey === activeRequestKey) return;

    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    setActiveRequestKey(requestKey);
    setStatus("loading");
    setSubmittedQuery(request.q);
    try {
      const nextReceipt = await onGlobalSearch?.(request);
      if (requestSequenceRef.current !== requestSequence) return;
      setReceipt(nextReceipt ?? emptyGlobalSearchReceipt(request.q));
      setStatus("success");
      setActiveRequestKey("");
    } catch {
      if (requestSequenceRef.current !== requestSequence) return;
      setReceipt(undefined);
      setStatus("error");
      setActiveRequestKey("");
    }
  }

  function clearQuery() {
    requestSequenceRef.current += 1;
    setQuery("");
    setReceipt(undefined);
    setSubmittedQuery("");
    setStatus("idle");
    setActiveRequestKey("");
  }

  return (
    <section aria-label={messages.search.title} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <form className="border-b px-6 py-5" data-tauri-drag-region="deep" onSubmit={submitSearch}>
        <div className="mx-auto grid w-full max-w-5xl gap-3">
          <div className="flex min-h-12 items-center gap-3 rounded-xl border bg-background px-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <Input
              aria-label={messages.search.navigation.searchInput}
              className="h-11 min-w-0 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={messages.search.placeholderTitle}
              value={query}
            />
            {query ? (
              <Button aria-label={messages.search.navigation.clearQuery} onClick={clearQuery} size="icon-sm" type="button" variant="ghost">
                <X aria-hidden="true" className="size-4" />
              </Button>
            ) : null}
            <Button className="min-w-20" disabled={submitDisabled} type="submit">
              {status === "loading" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Search aria-hidden="true" className="size-4" />}
              {messages.search.submit}
            </Button>
          </div>

          <div aria-label={messages.search.filters.title} className="flex flex-wrap gap-2">
            <FilterMenu
              icon={<UserRound aria-hidden="true" className="size-4" />}
              label={messages.search.filters.from}
              open={openFilter === "from"}
              options={fromOptions}
              resetLabel={messages.search.filters.anyone}
              selectedId={fromId}
              selectedLabel={selectedFrom?.label ?? messages.search.filters.anyone}
              onOpenChange={(open) => setOpenFilter(open ? "from" : undefined)}
              onSelect={setFromId}
            />
            <FilterMenu
              icon={<Hash aria-hidden="true" className="size-4" />}
              label={messages.search.filters.channel}
              open={openFilter === "channel"}
              options={channelOptions}
              resetLabel={messages.search.filters.allChannels}
              selectedId={channelId}
              selectedLabel={selectedChannel?.label ?? messages.search.filters.allChannels}
              onOpenChange={(open) => setOpenFilter(open ? "channel" : undefined)}
              onSelect={setChannelId}
            />
            <FilterMenu
              icon={<Calendar aria-hidden="true" className="size-4" />}
              label={messages.search.filters.timeRangeLabel}
              open={openFilter === "time"}
              options={timeOptions}
              selectedId={timeRange}
              selectedLabel={selectedTime.label}
              onOpenChange={(open) => setOpenFilter(open ? "time" : undefined)}
              onSelect={(id) => setTimeRange(id as GlobalSearchTimeRangeFilter)}
            />
          </div>
        </div>
      </form>

      <ScrollArea className="min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-5 p-6">
          {status === "idle" ? (
            <Empty
              description={messages.search.placeholderDescription}
              size="lg"
              title={messages.search.placeholderTitle}
              variant="nodata"
            />
          ) : null}

          {status === "loading" ? (
            <div aria-live="polite" className="flex min-h-60 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {messages.search.loading}
            </div>
          ) : null}

          {status === "error" ? (
            <Empty
              description={messages.search.errorDescription}
              size="md"
              title={messages.search.errorTitle}
              variant="noresult"
            />
          ) : null}

          {status === "success" && !hasResults ? (
            <Empty
              description={messages.search.noResultDescription}
              size="md"
              title={messages.search.noResultTitle}
              variant="noresult"
            />
          ) : null}

          {status === "success" && hasResults ? (
            <section aria-label={messages.search.navigation.results} className="grid gap-5">
              <p className="text-sm text-muted-foreground">{messages.search.resultCount((receipt?.totals.agents ?? 0) + (receipt?.totals.channels ?? 0) + (receipt?.totals.messages ?? 0))}</p>
              {sections.map((section) => (
                <section className="grid gap-2" key={section.category}>
                  <header className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{messages.search.sections[section.category]}</h2>
                    <span className="text-xs text-muted-foreground">{section.total}</span>
                  </header>
                  <div className="grid gap-2">
                    {section.category === "agents" ? section.items.map((result) => (
                      <AgentResultButton
                        key={result.agentId}
                        messages={messages}
                        query={submittedQuery}
                        result={result}
                        onSelect={onAgentResultSelect}
                      />
                    )) : null}
                    {section.category === "channels" ? section.items.map((result) => (
                      <ChannelResultButton
                        data={data}
                        key={result.channelId}
                        messages={messages}
                        query={submittedQuery}
                        result={result}
                        onSelect={onChannelResultSelect}
                      />
                    )) : null}
                    {section.category === "messages" ? section.items.map((result) => (
                      <MessageResultButton
                        data={data}
                        key={`${result.sourceKind}:${result.messageId}`}
                        messages={messages}
                        profile={profile ?? null}
                        query={submittedQuery}
                        result={result}
                        timeZone={timeZone}
                        onLegacySelect={onResultSelect}
                        onSelect={onMessageResultSelect}
                      />
                    )) : null}
                  </div>
                </section>
              ))}
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </section>
  );
}

function FilterMenu(input: {
  icon: ReactNode;
  label: string;
  open: boolean;
  options: SelectOption[];
  resetLabel?: string;
  selectedId: string;
  selectedLabel: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative">
      <Button
        aria-expanded={input.open}
        aria-label={input.label}
        className="min-w-36 justify-start"
        onClick={() => input.onOpenChange(!input.open)}
        type="button"
        variant="outline"
      >
        {input.icon}
        <span className="truncate">{input.selectedLabel}</span>
      </Button>
      {input.open ? (
        <div className="absolute left-0 z-30 mt-2 grid max-h-72 w-72 gap-1 overflow-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg">
          {input.resetLabel ? (
            <FilterOption
              checked={!input.selectedId}
              option={{ id: "", label: input.resetLabel }}
              onSelect={(id) => {
                input.onSelect(id);
                input.onOpenChange(false);
              }}
            />
          ) : null}
          {input.options.map((option) => (
            <FilterOption
              checked={input.selectedId === option.id}
              key={option.id}
              option={option}
              onSelect={(id) => {
                input.onSelect(id);
                input.onOpenChange(false);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilterOption(input: {
  checked: boolean;
  option: SelectOption;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => input.onSelect(input.option.id)}
      type="button"
    >
      <span className="grid min-w-0 flex-1">
        <span className="truncate">{input.option.label}</span>
        {input.option.subtitle ? <small className="truncate text-xs text-muted-foreground">{input.option.subtitle}</small> : null}
      </span>
      {input.checked ? <Check aria-hidden="true" className="size-4 text-primary" /> : null}
    </button>
  );
}

function AgentResultButton(input: {
  messages: DesktopMessages;
  query: string;
  result: GlobalAgentSearchResult;
  onSelect?: (agentId: string) => void;
}) {
  const title = input.result.title || input.result.agentId;
  return (
    <Button
      aria-label={input.messages.search.navigation.openAgent(title)}
      className="h-auto min-h-16 w-full justify-start whitespace-normal px-3 py-3 text-left"
      onClick={() => input.onSelect?.(input.result.agentId)}
      type="button"
      variant="ghost"
    >
      <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <MemberAvatar identity={{ id: input.result.agentId, name: title, handle: input.result.subtitle, avatar: title.slice(0, 2).toUpperCase(), avatarSeed: input.result.avatarSeed }} />
        <span className="grid min-w-0 gap-1">
          <strong className="truncate text-sm">{highlighted(title, input.query)}</strong>
          <span className="truncate text-xs font-normal text-muted-foreground">{highlighted(input.result.subtitle, input.query)}</span>
        </span>
      </span>
    </Button>
  );
}

function ChannelResultButton(input: {
  data: SleiFixtures;
  messages: DesktopMessages;
  query: string;
  result: GlobalChannelSearchResult;
  onSelect?: (channelId: string) => void;
}) {
  const title = input.result.title || input.result.channelId;
  const channel = input.data.channels.find((candidate) => candidate.id === input.result.channelId);
  const subtitle = channelResultSubtitle(input.result, channel?.description, input.messages);
  return (
    <Button
      aria-label={input.messages.search.navigation.openChannel(title)}
      className="h-auto min-h-16 w-full justify-start whitespace-normal px-3 py-3 text-left"
      onClick={() => input.onSelect?.(input.result.channelId)}
      type="button"
      variant="ghost"
    >
      <span className="grid min-w-0 gap-1">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Hash aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <strong className="truncate text-sm">{highlighted(title, input.query)}</strong>
        </span>
        <span className="truncate text-xs font-normal text-muted-foreground">{highlighted(subtitle, input.query)}</span>
      </span>
    </Button>
  );
}

function MessageResultButton(input: {
  data: SleiFixtures;
  messages: DesktopMessages;
  profile: UserProfile | null;
  query: string;
  result: GlobalMessageSearchResult;
  timeZone?: string;
  onLegacySelect?: (channelId: string, messageId: string) => void;
  onSelect?: (result: GlobalMessageSearchResult) => void;
}) {
  const labels = localizedGlobalMessageDisplayLabels(input.result, {
    data: input.data,
    messages: input.messages,
    profile: input.profile,
  });
  return (
    <Button
      aria-label={input.messages.search.navigation.openMessage(input.result.messageId)}
      className="h-auto min-h-20 w-full justify-start whitespace-normal px-3 py-3 text-left"
      onClick={() => {
        if (input.onSelect) {
          input.onSelect(input.result);
        } else if (input.result.channelId) {
          input.onLegacySelect?.(input.result.channelId, input.result.messageId);
        }
      }}
      type="button"
      variant="ghost"
    >
      <span className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center gap-2 text-xs font-normal text-muted-foreground">
          <span className="truncate">{labels.subtitle}</span>
          <span className="shrink-0">{formatResultDate(input.result.createdAt, input.timeZone)}</span>
        </span>
        <strong className="truncate text-sm">{highlighted(labels.title, input.query)}</strong>
        <span className="line-clamp-2 text-sm font-normal text-muted-foreground">{highlighted(input.result.snippet, input.query)}</span>
      </span>
    </Button>
  );
}

function highlighted(value: string | undefined, query: string) {
  return highlightSearchTokens(value ?? "", query).map((token, index) => (
    token.match
      ? <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground" key={`${token.text}-${index}`}>{token.text}</mark>
      : <span key={`${token.text}-${index}`}>{token.text}</span>
  ));
}

function createFromOptions(data: SleiFixtures, profile: UserProfile | null, messages: DesktopMessages): SearchFromOption[] {
  const human = localHumanPresentation(profile, messages);
  return [
    {
      id: "human:local",
      label: human.displayName,
      subtitle: human.handle,
    },
    ...data.members.map((member) => ({
      id: member.id,
      label: member.name,
      subtitle: member.handle,
    })),
  ];
}

function channelResultSubtitle(
  result: GlobalChannelSearchResult,
  localDescription: string | undefined,
  messages: DesktopMessages,
) {
  const description = trimText(localDescription);
  if (description) return description;
  const subtitle = trimText(result.subtitle);
  if (isRawCategoryLabel(subtitle, "channel")) return messages.search.categories.channel;
  return subtitle;
}

function localizedGlobalMessageDisplayLabels(
  result: GlobalMessageSearchResult,
  context: {
    data: SleiFixtures;
    messages: DesktopMessages;
    profile: UserProfile | null;
  },
): GlobalMessageDisplayLabels {
  const authorLabel = messageAuthorLabel(result, context);
  const sourceLabel = messageSourceLabel(result, context);
  const title = firstVisibleText(cleanDaemonVisibleLabel(result.title, context), sourceLabel, result.snippet);
  return {
    title,
    subtitle: [authorLabel, sourceLabel].filter(Boolean).join(" - "),
    sourceLabel,
    authorLabel,
  };
}

function messageAuthorLabel(
  result: GlobalMessageSearchResult,
  context: {
    data: SleiFixtures;
    messages: DesktopMessages;
    profile: UserProfile | null;
  },
) {
  const human = localHumanPresentation(context.profile, context.messages);
  if (isLocalHumanId(result.authorId)) return human.displayName;
  const member = result.authorId ? context.data.members.find((candidate) => candidate.id === result.authorId) : undefined;
  if (member) return [member.name, member.handle].filter(Boolean).join(" ");
  const daemonLabel = cleanDaemonVisibleLabel(result.authorLabel, context);
  if (daemonLabel) return daemonLabel;
  return firstVisibleText(result.authorName, result.authorHandle, result.authorId);
}

function messageSourceLabel(
  result: GlobalMessageSearchResult,
  context: {
    data: SleiFixtures;
    messages: DesktopMessages;
    profile: UserProfile | null;
  },
) {
  if (result.sourceKind === "channel") {
    const channel = result.channelId ? context.data.channels.find((candidate) => candidate.id === result.channelId) : undefined;
    if (channel) return `#${stripChannelHash(channel.name)}`;
    const sourceLabel = trimText(result.sourceLabel);
    if (sourceLabel && !isRawCategoryLabel(sourceLabel, "channel")) return sourceLabel;
    return firstVisibleText(result.channelId, context.messages.search.categories.channel);
  }

  const member = context.data.members.find((candidate) => (
    Boolean(result.conversationId?.includes(candidate.id))
  ));
  if (member) return member.name;
  const sourceLabel = cleanDaemonVisibleLabel(result.sourceLabel, context);
  if (sourceLabel) return sourceLabel;
  return firstVisibleText(result.conversationId, result.sessionId);
}

function cleanDaemonVisibleLabel(
  value: string | null | undefined,
  context: {
    messages: DesktopMessages;
    profile: UserProfile | null;
  },
) {
  const label = trimText(value);
  if (!label) return "";
  if (isRawHumanLabel(label)) return localHumanPresentation(context.profile, context.messages).displayName;
  if (isRawCategoryLabel(label, "channel")) return context.messages.search.categories.channel;
  if (isRawCategoryLabel(label, "message")) return context.messages.search.categories.message;
  if (isRawCategoryLabel(label, "agent")) return context.messages.search.categories.agent;
  return label;
}

function isLocalHumanId(value: string | null | undefined) {
  return trimText(value) === "human:local";
}

function isRawHumanLabel(value: string) {
  return ["me", "@me", "human:local", "local"].includes(value.trim().toLocaleLowerCase());
}

function isRawCategoryLabel(value: string, category: "agent" | "channel" | "message") {
  return value.trim().toLocaleLowerCase() === category;
}

function firstVisibleText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = trimText(value);
    if (text) return text;
  }
  return "";
}

function trimText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function emptyGlobalSearchReceipt(query: string): GlobalSearchReceipt {
  return {
    query,
    totals: { agents: 0, channels: 0, messages: 0 },
    agents: [],
    channels: [],
    messages: [],
  };
}

function stableGlobalSearchRequestKey(request: GlobalSearchQuery): string {
  return JSON.stringify({
    q: request.q,
    fromId: request.fromId ?? "",
    channelId: request.channelId ?? "",
    timeRange: request.timeRange ?? "",
    timeZone: request.timeZone ?? "",
    includeAgents: request.includeAgents ?? "",
    includeChannels: request.includeChannels ?? "",
    includeMessages: request.includeMessages ?? "",
    agentLimit: request.agentLimit ?? "",
    channelLimit: request.channelLimit ?? "",
    messageLimit: request.messageLimit ?? "",
  });
}

function formatResultDate(value: string, timeZone?: string) {
  const raw = value.trim();
  if (!raw) return "";
  return formatMessageDateTime(raw, timeZone);
}
