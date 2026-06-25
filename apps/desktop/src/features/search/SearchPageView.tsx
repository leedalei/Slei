import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";

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
import { Empty, MemberAvatar, SleiIcon, SoftPanel } from "../../components";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  buildGlobalSearchRequest,
  createGlobalSearchSections,
  highlightSearchTokens,
  type GlobalSearchTimeRangeFilter,
  type GlobalMessageDisplayLabels,
} from "./globalSearch";

type SearchStatus = "idle" | "loading" | "success" | "error";
const RESET_FILTER_VALUE = "__slei_filter_reset__";

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

const filterSelectTriggerClassName = "min-w-36 rounded-lg border-border/55 bg-muted/45 shadow-none transition-[background-color,border-color,color,box-shadow] hover:bg-muted/65 data-[state=open]:bg-muted/70 dark:bg-muted/25 dark:hover:bg-muted/40";
const searchResultPanelClassName = "shadow-none transition-colors hover:bg-muted/35 dark:hover:bg-muted/25";

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
    <section aria-label={messages.search.title} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-transparent">
      <form className="border-b px-6 py-5" data-slot="workspace-titlebar" data-tauri-drag-region="deep" onSubmit={submitSearch}>
        <div className="mx-auto grid w-full max-w-5xl gap-3">
          <SoftPanel className="slei-search-input-surface flex min-h-12 items-center gap-3 rounded-full px-3 py-0" data-slot="search-input-surface" insetSize="small" variant="inset">
            <SleiIcon className="size-5 text-muted-foreground" name="search" />
            <Input
              aria-label={messages.search.navigation.searchInput}
              className="h-11 min-w-0 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={messages.search.placeholderTitle}
              value={query}
            />
            {query ? (
              <Button aria-label={messages.search.navigation.clearQuery} onClick={clearQuery} size="icon-sm" type="button" variant="ghost">
                <SleiIcon className="size-4" name="x" />
              </Button>
            ) : null}
            <Button className="min-w-20" disabled={submitDisabled} type="submit">
              {status === "loading" ? <SleiIcon className="size-4 animate-spin" name="loader" /> : <SleiIcon className="size-4" name="search" />}
              {messages.search.submit}
            </Button>
          </SoftPanel>

          <div aria-label={messages.search.filters.title} className="flex flex-wrap gap-2">
            <FilterSelect
              icon={<SleiIcon className="size-4" name="user" />}
              label={messages.search.filters.from}
              options={fromOptions}
              resetLabel={messages.search.filters.anyone}
              selectedId={fromId}
              selectedLabel={selectedFrom?.label ?? messages.search.filters.anyone}
              onSelect={setFromId}
            />
            <FilterSelect
              icon={<SleiIcon className="size-4" name="hash" />}
              label={messages.search.filters.channel}
              options={channelOptions}
              resetLabel={messages.search.filters.allChannels}
              selectedId={channelId}
              selectedLabel={selectedChannel?.label ?? messages.search.filters.allChannels}
              onSelect={setChannelId}
            />
            <FilterSelect
              icon={<SleiIcon className="size-4" name="calendar" />}
              label={messages.search.filters.timeRangeLabel}
              options={timeOptions}
              selectedId={timeRange}
              selectedLabel={selectedTime.label}
              onSelect={(id) => setTimeRange(id as GlobalSearchTimeRangeFilter)}
            />
          </div>
        </div>
      </form>

      <ScrollArea className="min-h-0">
        <div className="px-6 py-6">
          <div className="mx-auto grid w-full max-w-5xl gap-5" data-slot="search-results">
            {status === "idle" ? (
              <Empty
                chrome="none"
                description={messages.search.placeholderDescription}
                framed={false}
                illustration="search"
                size="lg"
                title={messages.search.placeholderTitle}
                variant="nodata"
              />
            ) : null}

            {status === "loading" ? (
              <div aria-live="polite" className="flex min-h-60 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                <SleiIcon className="size-4 animate-spin" name="loader" />
                {messages.search.loading}
              </div>
            ) : null}

            {status === "error" ? (
              <Empty
                chrome="none"
                description={messages.search.errorDescription}
                framed={false}
                illustration="error"
                size="lg"
                title={messages.search.errorTitle}
                variant="noresult"
              />
            ) : null}

            {status === "success" && !hasResults ? (
              <Empty
                chrome="none"
                description={messages.search.noResultDescription}
                framed={false}
                illustration="search"
                size="lg"
                title={messages.search.noResultTitle}
                variant="noresult"
              />
            ) : null}

            {status === "success" && hasResults ? (
              <section aria-label={messages.search.navigation.results} className="grid gap-5">
                <p className="text-sm text-muted-foreground">{messages.search.resultCount((receipt?.totals.agents ?? 0) + (receipt?.totals.channels ?? 0) + (receipt?.totals.messages ?? 0))}</p>
                <Accordion
                  className="grid gap-3"
                  data-slot="search-results-accordion"
                  defaultValue={sections.map((section) => section.category)}
                  type="multiple"
                >
                  {sections.map((section) => (
                    <AccordionItem className="border-b border-border/70 last:border-b-0" key={section.category} value={section.category}>
                      <AccordionTrigger className="rounded-lg px-0 py-2 text-muted-foreground hover:no-underline">
                        <span className="text-sm font-semibold uppercase tracking-wide">{messages.search.sections[section.category]}</span>
                        <span className="ml-auto text-xs font-normal tabular-nums">{section.total}</span>
                      </AccordionTrigger>
                      <AccordionContent className="grid gap-2 pb-3">
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
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </section>
  );
}

function FilterSelect(input: {
  icon: ReactNode;
  label: string;
  options: SelectOption[];
  resetLabel?: string;
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string) => void;
}) {
  const value = input.selectedId || RESET_FILTER_VALUE;
  return (
    <Select value={value} onValueChange={(nextValue) => input.onSelect(nextValue === RESET_FILTER_VALUE ? "" : nextValue)}>
      <SelectTrigger
        aria-label={input.label}
        className={filterSelectTriggerClassName}
        data-filter-select-trigger="true"
      >
        {input.icon}
        <span data-slot="select-value" className="min-w-0 flex-1 truncate">{input.selectedLabel}</span>
      </SelectTrigger>
      <SelectContent align="start" className="w-72" position="popper">
        {input.resetLabel ? (
          <SelectItem textValue={input.resetLabel} value={RESET_FILTER_VALUE}>
            <span className="truncate">{input.resetLabel}</span>
          </SelectItem>
        ) : null}
        {input.options.map((option) => (
          <SelectItem key={option.id} textValue={option.label} value={option.id}>
            <span className="grid min-w-0">
              <span className="truncate">{option.label}</span>
              {option.subtitle ? <small className="truncate text-xs text-muted-foreground">{option.subtitle}</small> : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
    <SoftPanel className={searchResultPanelClassName} variant="surface">
      <Button
        aria-label={input.messages.search.navigation.openAgent(title)}
        className="h-auto min-h-12 w-full justify-start whitespace-normal rounded-[inherit] bg-transparent p-0 text-left hover:bg-transparent"
        data-search-result-kind="agent"
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
    </SoftPanel>
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
    <SoftPanel className={searchResultPanelClassName} variant="surface">
      <Button
        aria-label={input.messages.search.navigation.openChannel(title)}
        className="h-auto min-h-12 w-full justify-start whitespace-normal rounded-[inherit] bg-transparent p-0 text-left hover:bg-transparent"
        data-search-result-kind="channel"
        onClick={() => input.onSelect?.(input.result.channelId)}
        type="button"
        variant="ghost"
      >
        <span className="grid min-w-0 gap-1">
          <span className="inline-flex min-w-0 items-center gap-2">
            <SleiIcon className="size-4 text-muted-foreground" name="hash" />
            <strong className="truncate text-sm">{highlighted(title, input.query)}</strong>
          </span>
          <span className="truncate text-xs font-normal text-muted-foreground">{highlighted(subtitle, input.query)}</span>
        </span>
      </Button>
    </SoftPanel>
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
    <SoftPanel className={searchResultPanelClassName} variant="surface">
      <Button
        aria-label={input.messages.search.navigation.openMessage(input.result.messageId)}
        className="h-auto min-h-16 w-full justify-start whitespace-normal rounded-[inherit] bg-transparent p-0 text-left hover:bg-transparent"
        data-search-result-kind="message"
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
    </SoftPanel>
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
