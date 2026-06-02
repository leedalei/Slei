import { useState } from "react";
import { Hash, Search } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiFixtures } from "../../app/fixtures";
import { filterConversationMessages, stripChannelHash, type ChatSearchFilters } from "../../app/model";
import { Empty } from "../../components";
export function SearchPage({ data, initialFilters, messages, onResultSelect }: { data: SleiFixtures; initialFilters?: ChatSearchFilters; messages: DesktopMessages; onResultSelect?: (channelId: string, messageId: string) => void }) {
  const [filters, setFilters] = useState<ChatSearchFilters>(initialFilters ?? {});
  const results = filterConversationMessages(data.messages, filters);

  function channelName(channelId?: string) {
    return stripChannelHash(data.channels.find((channel) => channel.id === (channelId ?? "all"))?.name ?? channelId ?? "all");
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
        <label><span>{messages.search.query}</span><input className="slei-input" defaultValue={filters.query ?? ""} onChange={(event) => setFilters((current) => ({ ...current, query: event.currentTarget.value }))} placeholder={messages.search.query} /></label>
        <label><span>{messages.search.user}</span><input className="slei-input" defaultValue={filters.user ?? ""} onChange={(event) => setFilters((current) => ({ ...current, user: event.currentTarget.value }))} placeholder="@Coda" /></label>
        <label><span>{messages.search.channel}</span><input className="slei-input" defaultValue={filters.channel ?? ""} onChange={(event) => setFilters((current) => ({ ...current, channel: event.currentTarget.value }))} placeholder="#all" /></label>
        <label><span>{messages.search.time}</span><input className="slei-input" defaultValue={filters.time ?? ""} onChange={(event) => setFilters((current) => ({ ...current, time: event.currentTarget.value }))} placeholder="10:15" /></label>
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
            onClick={() => onResultSelect?.(message.channelId ?? "all", message.id)}
            type="button"
          >
            <span><Hash aria-hidden="true" size={14} /># {channelName(message.channelId)}</span>
            <strong>{message.author}</strong>
            <small>{message.handle ? `${message.handle} · ` : ""}{message.time}</small>
            <p>{message.body}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
