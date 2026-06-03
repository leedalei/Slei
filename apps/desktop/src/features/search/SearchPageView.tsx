import { useState, type ChangeEvent } from "react";
import { Hash, Search } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiFixtures } from "../../app/fixtures";
import { filterConversationMessages, stripChannelHash, type ChatSearchFilters } from "../../app/model";
import { Empty } from "../../components";
export function SearchPage({ data, initialFilters, messages, onResultSelect }: { data: SleiFixtures; initialFilters?: ChatSearchFilters; messages: DesktopMessages; onResultSelect?: (channelId: string, messageId: string) => void }) {
  const [filters, setFilters] = useState<ChatSearchFilters>(initialFilters ?? {});
  const results = filterConversationMessages(data.messages, filters);

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
    <section className="slei-search-page">
      <header className="slei-workspace-header" data-tauri-drag-region="deep">
        <div>
          <h1><Search aria-hidden="true" size={22} />{messages.search.title}</h1>
          <p>{messages.search.description}</p>
        </div>
      </header>
      <section className="slei-search-panel" aria-label={messages.search.title}>
        <label><span>{messages.search.query}</span><input className="slei-input" defaultValue={filters.query ?? ""} onChange={updateFilter("query")} placeholder={messages.search.query} /></label>
        <label><span>{messages.search.user}</span><input className="slei-input" defaultValue={filters.user ?? ""} onChange={updateFilter("user")} placeholder="@Coda" /></label>
        <label><span>{messages.search.channel}</span><input className="slei-input" defaultValue={filters.channel ?? ""} onChange={updateFilter("channel")} placeholder="#all" /></label>
        <label><span>{messages.search.time}</span><input className="slei-input" defaultValue={filters.time ?? ""} onChange={updateFilter("time")} placeholder="10:15" /></label>
      </section>
      <div className="slei-search-results">
        {results.length === 0 ? (
          <Empty
            description={messages.search.noResultDescription}
            size="md"
            title={messages.search.noResultTitle}
            variant="noresult"
          />
        ) : null}
        {results.map((message) => (
          <button
            aria-label={messages.search.openConversation(message.id)}
            className="slei-search-result"
            key={message.id}
            onClick={() => onResultSelect?.(channelIdForResult(message.channelId), message.id)}
            type="button"
          >
            <span><Hash aria-hidden="true" size={14} /># {channelName(message.channelId)}</span>
            <strong>{displaySearchText(message.author)}</strong>
            <small>{displaySearchText(message.handle) ? `${displaySearchText(message.handle)} · ` : ""}{displaySearchText(message.time)}</small>
            <p>{displaySearchText(message.body)}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function displaySearchText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
