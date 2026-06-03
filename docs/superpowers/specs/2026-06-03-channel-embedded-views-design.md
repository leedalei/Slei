# Channel Embedded Views Design

## Summary

The channel header should support three embedded views: chat, tasks, and files. These views are scoped to the currently selected channel. Switching to tasks or files replaces the central chat timeline with a focused list and hides the bottom composer. The direct message header keeps its current session actions and does not show these channel tabs.

The existing "Runtime detected" badge in the channel header should be removed.

## Goals

- Make the existing channel header tabs functional for channel-local chat, task, and file views.
- Show only tasks and files that belong to the active channel.
- Keep task and file views lightweight, with useful click behavior but no heavy management workflows.
- Preserve the current chat experience when the chat tab is active.
- Avoid introducing new backend models or persistence for this feature.

## Non-Goals

- Do not change the global tasks page.
- Do not add cross-channel task or file browsing from the channel header.
- Do not add search, filtering, sorting controls, bulk file actions, or full task editing.
- Do not change direct message session controls.
- Do not add a runtime status replacement in the channel header.

## Header Interaction

For channel conversations, the header shows a segmented tab group:

- Chat
- Tasks
- Files

The selected tab uses the existing active tab styling and accessible current-state markup. The tab state is local to `ChatPage`. When the active channel changes, the view should reset to chat so the user does not land in a stale tasks or files list for a different channel.

For direct messages, the header keeps the existing "New session" and "History" actions. Channel tabs are not shown for direct messages.

## Chat View

The chat view keeps the current behavior:

- Show the channel timeline.
- Show the mention panel when active.
- Show the composer and attachment controls.
- Allow sending normal messages, task messages, and attachments.

This is the default view for every channel.

## Tasks View

The tasks view replaces the central timeline with a compact list of tasks for the active channel. The composer is hidden because this view is for browsing rather than composing.

Each task row should show:

- Status
- Title
- Owner or assignee
- Reply count or recent activity
- Attention marker when present

Task rows should be lightly interactive. Clicking a task opens a lightweight detail area in the same content region, showing the task title, status, owner, root message summary, and recent replies. This detail view is read-only for this feature. If no tasks exist for the channel, show a simple empty state.

The tasks view should use `data.tasks.filter((task) => task.channelId === activeChannel.id)` as its source.

## Files View

The files view replaces the central timeline with a list of attachments found in the active channel's messages. The composer is hidden.

Each attachment row should show:

- File type icon or image thumbnail
- File name
- Size
- Sender
- Message time

Attachments are shown in reverse chronological order, newest first. Images may use small thumbnails. Non-image files use an icon. Clicking an attachment should use the existing open behavior when available; if only a URL is available, opening the URL or previewing the image is acceptable. If no files exist for the channel, show a simple empty state.

The files view should be derived from the currently visible channel messages by collecting `message.attachments`, plus message metadata such as author, time, and message id.

## Data Flow

No new backend API is required.

- `channelTasks` is derived from `data.tasks` and the active channel id.
- `channelFiles` is derived from channel messages and their attachment arrays.
- The active embedded view is component state in the channel page.
- Switching tabs changes only the central content area and composer visibility.

The feature should keep existing message sending, upload, permission, and interactive-card flows unchanged.

## Component Boundaries

The implementation should keep the change localized to the chat feature:

- `ChatPageView` owns the embedded view state and tab event handlers.
- A small channel task list component may render tasks and selected task details.
- A small channel file list component may render attachment rows.
- Existing attachment chip rendering can be reused where it fits, but the files view should have a list layout rather than composer-style chips.

These components should depend on plain props derived from existing fixtures and message data, not on daemon calls.

## Error And Empty States

- If no tasks exist for the active channel, show a concise current-channel empty state.
- If no attachments exist for the active channel, show a concise current-channel empty state.
- If an attachment cannot be opened because no URL or open handler is available, the UI should fail quietly or show a short non-blocking message rather than breaking the page.
- Missing optional metadata such as size, sender, or URL should not crash the list.

## Accessibility

- Tabs should expose a clear selected state.
- Task and file rows should be keyboard reachable when they are clickable.
- Icon-only open or preview controls need accessible labels.
- Hidden composer controls should not remain focusable in tasks or files view.

## Testing

Add focused tests for:

- The channel header no longer renders the runtime detected badge.
- Clicking Tasks switches the central content from timeline to the current channel's task list and hides the composer.
- Clicking Files switches the central content to the current channel's attachment list and hides the composer.
- Tasks and files are scoped to the active channel.
- Direct message headers keep session controls and do not show channel tabs.

Manual verification should confirm the desktop layout remains stable at normal desktop widths and that switching channels resets the embedded view to chat.
