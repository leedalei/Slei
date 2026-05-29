# Slei Desktop Interaction Fixes Plan

## Summary

This plan closes the interaction gaps in the current React desktop MVP while keeping the Neo-Brutalism design system as the styling source. The work is scoped to the desktop webview shell and does not change daemon runtime semantics beyond using the node/runtime DTO already returned to the UI.

## Requirements

1. Replace the left primary menu text shortcuts with icon-first controls. Labels stay available through `aria-label` and `title`.
2. Make the boundary between the context sidebar and chat workspace resizable by dragging, with a stable default width and min/max bounds.
3. Add profile settings for display name, `@` handle, and avatar. These values should be reflected in newly sent chat messages.
4. Make the chat composer actually submit messages. Empty messages must not be sent; Enter sends and Shift+Enter keeps a newline.
5. Add runtime status dots for agents/runtimes: green idle, yellow busy, gray offline.

## Implementation Steps

1. Add focused desktop tests for the icon rail, resize handle markup, profile settings fields, composer send behavior helper, and runtime status dot markup.
2. Extend `SleiApp` state with profile and chat composer state.
3. Replace rail abbreviations with inline icon glyphs that are accessible by label.
4. Add a draggable splitter between sidebar and workspace using CSS custom property state on the shell.
5. Add profile settings inputs for display name, handle, and avatar URL/initials.
6. Wire chat form submit and Enter key handling to append a local human message.
7. Render runtime/agent status dots in Members and Computers surfaces, backed by fixture/runtime status data.

## Test Plan

- `pnpm --filter @slei/desktop test -- react-shell.spec.tsx desktop-interactions.spec.tsx`
- `pnpm --filter @slei/desktop lint`
- `pnpm --filter @slei/desktop typecheck`
- `pnpm --filter @slei/desktop test`
- `pnpm --filter @slei/desktop build`

## Non-goals

- Persist profile settings to daemon storage.
- Send chat messages to the daemon channel API.
- Implement cross-window sidebar width persistence.
