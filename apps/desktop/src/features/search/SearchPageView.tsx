import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { Hash, Search } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiFixtures } from "../../app/types";
import { filterConversationMessages, stripChannelHash, type ChatSearchFilters } from "../../app/model";
import { Empty } from "../../components";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

export function SearchPage({ data, initialFilters, messages, onResultSelect }: { data: SleiFixtures; initialFilters?: ChatSearchFilters; messages: DesktopMessages; onResultSelect?: (channelId: string, messageId: string) => void }) {
  const [filters, setFilters] = useState<ChatSearchFilters>(initialFilters ?? {});
  const normalizedInitialFilters = normalizeSearchFilters(initialFilters);
  const initialFiltersKey = stableSearchFiltersKey(normalizedInitialFilters);
  const results = filterConversationMessages(data.messages, filters);

  useEffect(() => {
    setFilters(normalizedInitialFilters);
  }, [initialFiltersKey]);

  function channelIdForResult(channelId: unknown): string {
    return displaySearchText(channelId) || "all";
  }

  function channelName(channelId: unknown) {
    const safeChannelId = channelIdForResult(channelId);
    return stripChannelHash(data.channels.find((channel) => channel.id === safeChannelId)?.name ?? safeChannelId);
  }

  function updateFilter(key: keyof ChatSearchFilters) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.value;
      setFilters((current) => ({ ...current, [key]: value }));
    };
  }

  return (
    <section aria-label={messages.search.title} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <header className="border-b px-6 py-5">
        <div className="grid gap-1" data-slot="workspace-titlebar" data-tauri-drag-region="deep">
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold"><Search aria-hidden="true" className="size-5" />{messages.search.title}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{messages.search.description}</p>
        </div>
      </header>

      <ScrollArea className="min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-4 p-6">
          <Card>
            <CardHeader>
              <CardTitle>{messages.search.title}</CardTitle>
              <CardDescription>{messages.search.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <section className="grid gap-4 md:grid-cols-4" aria-label={messages.search.title}>
                <SearchField label={messages.search.query}>
                  <Input value={filters.query ?? ""} onChange={updateFilter("query")} placeholder={messages.search.query} />
                </SearchField>
                <SearchField label={messages.search.user}>
                  <Input value={filters.user ?? ""} onChange={updateFilter("user")} placeholder="@Coda" />
                </SearchField>
                <SearchField label={messages.search.channel}>
                  <Input value={filters.channel ?? ""} onChange={updateFilter("channel")} placeholder="#all" />
                </SearchField>
                <SearchField label={messages.search.time}>
                  <Input value={filters.time ?? ""} onChange={updateFilter("time")} placeholder="10:15" />
                </SearchField>
              </section>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{messages.search.title}</CardTitle>
              <CardDescription>{results.length}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {results.length === 0 ? (
                <Empty
                  description={messages.search.noResultDescription}
                  size="md"
                  title={messages.search.noResultTitle}
                  variant="noresult"
                />
              ) : null}
              {results.map((message) => (
                <Button
                  aria-label={messages.search.openConversation(message.id)}
                  className="h-auto min-h-20 w-full justify-start whitespace-normal px-3 py-3 text-left"
                  key={message.id}
                  onClick={() => onResultSelect?.(channelIdForResult(message.channelId), message.id)}
                  type="button"
                  variant="outline"
                >
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Hash aria-hidden="true" className="size-3.5" /># {channelName(message.channelId)}
                    </span>
                    <strong className="text-sm">{displaySearchText(message.author)}</strong>
                    <small className="text-xs text-muted-foreground">{displaySearchText(message.handle) ? `${displaySearchText(message.handle)} · ` : ""}{displaySearchText(message.time)}</small>
                    <span className="break-words text-sm font-normal">{displaySearchText(message.body)}</span>
                  </span>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </section>
  );
}

function displaySearchText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizeSearchFilters(filters?: ChatSearchFilters): ChatSearchFilters {
  if (!filters) return {};
  return {
    channel: filters.channel ?? "",
    query: filters.query ?? "",
    time: filters.time ?? "",
    user: filters.user ?? "",
  };
}

function stableSearchFiltersKey(filters: ChatSearchFilters): string {
  return JSON.stringify({
    channel: filters.channel ?? "",
    query: filters.query ?? "",
    time: filters.time ?? "",
    user: filters.user ?? "",
  });
}

function SearchField(input: { children: ReactNode; label: string }) {
  return (
    <Label className="grid gap-2">
      <span>{input.label}</span>
      {input.children}
    </Label>
  );
}
