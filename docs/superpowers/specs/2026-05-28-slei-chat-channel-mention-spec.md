# Slei Chat Search, Channel Management, And Mentions Spec

## Summary

This spec closes four visible desktop MVP gaps in the Chat surface:

1. Conversation search by user, channel, and time.
2. Channel create/delete controls with optional project association.
3. Composer `@` mention autocomplete with an in-channel member list and keyboard selection.
4. All control icons are rendered with `lucide-react`, not raw glyph placeholders.
5. The far-left main menu rail uses system-button-like icon buttons with Lucide icons centered both horizontally and vertically.

The implementation target is the current React desktop MVP in `apps/desktop/src/app`. It should be fixture-backed and local-state-driven for now, while keeping the UI contracts close to the existing daemon roadmap so later persistence can replace the local handlers.

## Context

The earlier MVP plan already called out channel creation, workspace/project association, and mention autocomplete. The daemon has partial channel/message service foundations, but the current desktop shell only renders a static `#all` channel and a plain textarea. This creates the exact user-facing gaps reported here: there is no session search control, no way to add/delete channels, and typing `@` does not surface selectable members.

The user-provided screenshot shows a dense Neo-Brutalism chat surface:

- the left Chat sidebar contains Search and Saved, then grouped `CHANNELS` and `DIRECT MESSAGES`; Activity is intentionally omitted for this MVP pass
- channel rows have icon-like controls and the selected row uses a strong accent fill
- the main Chat header includes top tabs: Chat, Tasks, Files
- the timeline remains document-like and dense
- typing `@` opens a full-width member picker between the timeline and composer, with the selected row highlighted, avatars/status dots on the left, and handles aligned to the right

## Requirements

### Conversation Search

- Chat sidebar includes a Search entry matching the screenshot location.
- Activating Search opens a dedicated search page/workspace, not an inline panel inside the active chat.
- The search panel supports:
  - free text search across message body, author name, and handle
  - user filter by author/handle
  - channel filter by channel id/name
  - time filter using the visible message time string for the MVP
- Filtering is local and immediate.
- Empty filters show the normal active-channel timeline.
- Results keep the same message card visual treatment inside the dedicated search workspace.
- Clicking a search result jumps back to the corresponding channel conversation.

### Channel Management

- The Chat sidebar keeps `#all` as the default channel.
- Users open channel creation from the sidebar `CHANNELS` group through a modal dialog, not an inline sidebar form.
- The create-channel modal collects:
  - channel name
  - optional associated project name
- Created channels appear in the channel list and can be selected.
- Non-default channels can be deleted from the sidebar.
- `#all` cannot be deleted.
- Channel rows show their project association when present.
- Channel group header shows channel count and create/sort affordances.
- The MVP stores these changes in React local state only.

### Mentions

- When the composer contains an active `@` query, a full-width mention panel opens above the composer, matching the screenshot placement.
- Suggestions include in-channel humans and agents from `data.members`.
- Suggestions must be generated only from current real members in app state. The UI must not add screenshot-only placeholder people such as Nancy or Jack unless those members exist in `data.members`.
- An empty active `@` query shows all current members.
- Suggestions match by display name or handle.
- The menu shows enough member identity to choose correctly: avatar, name, handle, role/type.
- Arrow Down and Arrow Up move the active selection.
- Enter or Tab inserts the selected mention into the draft when the menu is open.
- Escape closes the menu.
- Normal Enter still sends the message when no mention selection is active; Shift+Enter still inserts a newline.

### Icon System

- Add `lucide-react` to the desktop app dependency list.
- Primary navigation icons, sidebar utility icons, channel create/sort/delete controls, graph/member controls, Chat tabs, back-to-bottom, composer attach/send controls, and action buttons that currently use glyph placeholders render Lucide SVG icons.
- Semantic text such as `#all`, `@Coda`, and visible button names remains visible where it is content. Decorative/control icons must not be raw characters such as `⌕`, `⌘`, `⌫`, `↕`, `▱`, `[]`, `>`, or `*`.
- Icon-only buttons keep accessible labels through `aria-label` or `title`.

### Main Menu Rail

- The far-left rail items are icon-only system-style buttons.
- Each rail button uses the existing control border/background/shadow tokens and keeps its accessible label/title.
- The Lucide icon is centered horizontally and vertically inside a stable square button.
- Rail buttons must not use stacked text/icon layout or raw glyph content.

## Data Model

Extend fixture-only data with:

- `SleiChannel.projectName?: string`
- `SleiMessage.channelId?: string`

All existing fixture messages belong to `all`. New messages are posted into the currently selected channel.

## UI Placement

- Sidebar:
  - top utility entries: Search and Saved
  - Activity is intentionally omitted for this MVP pass
  - channel list remains under `CHANNELS`
  - add-channel is a `CHANNELS` header action that opens a modal dialog
  - delete/edit action appears on non-default channel rows
- Create Channel Modal:
  - uses the existing modal backdrop/dialog treatment
  - includes channel name and project association fields
  - has cancel and create actions
  - closes after successful local creation
- Main Chat:
  - header shows active channel, associated project when present, and tabs for Chat, Tasks, Files
  - mention menu spans the full content width between timeline and composer
- Search Page:
  - standalone page with query/user/channel/time filters
  - result rows show channel, author, time, and message excerpt
  - result rows are buttons that navigate to the matched channel conversation

## Testing

Add focused desktop tests for:

- search helper filters by user/channel/time
- Chat page renders search controls
- channel sidebar renders create controls, project association, and delete controls for non-default channels
- mention helpers detect active `@` query, filter targets, navigate selection, and insert selected mention
- Chat page renders a mention menu when initialized with an active `@` draft
- desktop shell renders Lucide SVG icons and no longer uses raw glyph placeholders for controls
- rail button CSS centers Lucide icons and avoids vertical stacked layout

Verification commands:

- `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`
- `pnpm --filter @slei/desktop lint`
- `pnpm --filter @slei/desktop typecheck`
- `pnpm --filter @slei/desktop test`
- `pnpm --filter @slei/desktop build`

## Non-Goals

- Persisting channel changes through daemon APIs.
- Full text indexing or transcript search backend.
- Project picker backed by a real project service.
- Permission-scoped channel membership enforcement.
