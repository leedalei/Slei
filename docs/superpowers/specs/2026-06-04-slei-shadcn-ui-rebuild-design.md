# Slei shadcn/ui Rebuild Design

Date: 2026-06-04
Status: Approved for spec review

## Goal

Completely rebuild the visible Slei desktop UI on top of shadcn/ui and the
provided tweakcn theme:

```sh
pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/cmdght103000n04lh3e2ae93r
```

The target app is the React/Tauri desktop frontend under `apps/desktop`.
The redesign should remove the old `animal-island-ui` and `@slei/ui` UI
foundation, replace redundant shared controls, and migrate every visible page
and product component to shadcn-style composition.

## Chosen Direction

Use a progressive but complete replacement.

The final state should not keep the legacy UI package as a compatibility layer.
However, implementation should still move module by module so each step can be
typechecked and tested. This keeps the outcome thorough without turning chat,
task drawers, settings forms, member management, and modal behavior into one
large unreviewable rewrite.

## Decisions

- Rebuild depth: complete UI-layer replacement.
- Old shared UI package: delete `packages/ui` and remove `@slei/ui` from the
  desktop app.
- Layout strategy: mixed. Preserve core shell and workflow structures, but allow
  page-level layout improvements where shadcn patterns make the product clearer.
- Settings and member detail pages may be more substantially rearranged than
  other pages to better fit shadcn preference and profile patterns.
- Data flow, daemon contracts, routing semantics, and existing product behavior
  are out of scope except where small UI refactors require preserving the same
  callback wiring.

## Architecture

The desktop app should own the new UI system directly:

- Add shadcn standard project files under `apps/desktop`, including
  `components.json`, `src/lib/utils.ts`, and `src/components/ui/*`.
- Keep `components/ui/*` as shadcn primitives only. These files should not
  contain Slei business logic.
- Keep Slei-specific composition in `apps/desktop/src/components/*` and
  `apps/desktop/src/features/*`.
- Remove `import "animal-island-ui/style"` from the frontend entry.
- Remove imports of `@slei/ui/styles/tokens.css` and
  `@slei/ui/styles/globals.css`.
- Remove `animal-island-ui` and `@slei/ui` from `apps/desktop/package.json`.
- Delete the `packages/ui` workspace package and its tests after all imports are
  gone.
- Update workspace and lock files as needed so `pnpm -r` commands no longer
  reference the deleted UI package.

The app should keep its existing product boundaries:

- `SleiApp.tsx` continues to own daemon bridge integration and top-level state.
- `router.ts` keeps current route semantics.
- i18n message modules remain the source for user-facing labels.
- Feature modules keep their business responsibilities, but their JSX and style
  dependencies are rebuilt.

## Theme and Styling

The new styling model is Tailwind v4 plus shadcn CSS variables from the tweakcn
theme.

- Import one desktop global stylesheet from the frontend entry.
- Put the tweakcn `:root`, `.dark`, `@theme inline`, and `@layer base` content in
  the desktop global CSS.
- Use shadcn's dark-mode class approach as the main theme mechanism.
- The existing root `data-theme` attribute may remain for compatibility during
  migration, but should not be the main styling API.
- Move visual styling out of large global `.slei-*` CSS blocks and into
  Tailwind className usage plus small shadcn-based business components.
- Keep global CSS only for body/app shell sizing, scrollbars, markdown/code
  rendering, focus defaults, animations, and other truly global concerns.
- Use `cn()` and `class-variance-authority` where variants are needed.
- Colors, radii, shadows, and font tokens should come from the tweakcn/shadcn
  theme rather than Animal Island or the previous Slei semantic token set.
- The theme references Outfit and Geist Mono. If external font loading is not
  added during implementation, system fallbacks are acceptable and must not
  block builds.

## Page Mapping

### Shell

Preserve the left primary navigation, contextual sidebar, resize handle, and main
workspace. Rebuild the shell with shadcn/Tailwind composition and theme tokens.
Current route, channel, member, and computer selection behavior should remain.

### Chat

Preserve the channel header, timeline, composer, session drawer, embedded tabs,
mention panel, attachment chips, saved-message actions, permission cards, and
interactive cards. Rebuild message rows, cards, drawers, dialogs, composer, tabs,
and chips using shadcn components.

Chat should remain a dense desktop workflow surface. Do not turn messages into
oversized casual chat bubbles.

### Tasks

Preserve board/list semantics, task statuses, task thread drawer, and reply
composer. Rebuild columns, task cards, status badges, tabs, drawer layout, and
reply controls with shadcn components. Local page layout adjustments are allowed
when they improve scanability.

### Members

Members may receive a larger layout adjustment than most pages. The detail page
may become a shadcn-style profile surface with:

- profile header
- identity and runtime summary cards
- tabbed or sectioned detail panels
- capability and permission cards
- path and action areas

Keep member selection, direct message, delete, edit/update, and open-path
behavior.

### Computers

Preserve node list, runtime status, create, delete, rename, and runtime refresh
behavior. Rebuild as a clearer list/detail surface using shadcn cards, badges,
buttons, and dialogs.

### Settings

Settings may receive a larger layout adjustment than most pages. The page can be
reorganized into a more shadcn-native preference structure, such as grouped
navigation plus card-based forms, tabs, or compact preference rows.

Preserve profile, language, timezone, appearance, notification, and about
settings behavior. Appearance should expose only `light` and `dark`. Legacy
`system` or `highContrast` values should continue to normalize to `light`.

### Search, Saved, Empty, Diagnostics, Onboarding

Migrate all remaining visible surfaces to shadcn cards, forms, result rows,
empty states, alerts, and dialogs. Preserve current labels, navigation paths, and
testable user actions.

## Redundant Components to Remove or Rewrite

Remove or replace old UI-only components once all callers have migrated:

- `packages/ui/src/components/*`
- `packages/ui/src/styles/tokens.css`
- `packages/ui/src/styles/globals.css`
- `apps/desktop/src/components/FormControls.tsx`
- old global `.slei-*` button/input/select/checkbox/dialog/card/tab styles
- Animal Island-specific imports and dependencies

Business components should be rewritten rather than blindly deleted. For
example, member avatar identity logic can become a small wrapper around shadcn
`Avatar`, because the business logic still has value.

## Data Flow and Behavior

Do not change:

- daemon bridge contracts
- routing semantics
- chat send behavior
- attachment upload behavior
- mention behavior
- task creation and task reply behavior
- member and computer management behavior
- saved message behavior
- notification behavior
- runtime setup behavior
- preferences update behavior

Small JSX reshaping is allowed to support shadcn hierarchy, portals, sheets,
dialogs, tabs, and cards. Any reshaping must preserve ARIA labels, keyboard
behavior, and callback wiring.

## Errors and Accessibility

- Inline form errors should become shadcn `Alert`, field descriptions, or clear
  inline validation text.
- Destructive actions should use a destructive button variant and, where
  confirmation exists, shadcn `AlertDialog` or equivalent accessible dialog.
- Crash screen, permission approval cards, failed message states, runtime errors,
  and delete failures must remain highly legible.
- All interactive controls need visible focus states.
- Dialogs, sheets, tabs, sidebar navigation, composer controls, resize handle,
  and forms must remain keyboard-operable.
- Text must fit without overlap in desktop and narrow viewport tests.

## Testing and Verification

Implementation should verify the migration in layers:

1. Run `pnpm --filter @slei/desktop typecheck`.
2. Run targeted desktop tests for the largest changed surfaces: settings,
   members, chat, tasks, shell, and accessibility.
3. Run `pnpm --filter @slei/desktop test`.
4. If practical, run workspace-level `pnpm test` after deleting `packages/ui`.

Deleting `packages/ui` requires removing or migrating its tests so workspace test
commands do not reference a missing package.

For Settings and Members, preserve stable accessible names, visible labels, and
key test selectors where possible even if layout changes.

## Implementation Order

Recommended implementation order:

1. Add shadcn/tweakcn setup and desktop-local UI primitives.
2. Remove global old style imports and establish the new global CSS base.
3. Rebuild shared desktop controls and business wrappers.
4. Rebuild Shell and contextual sidebar.
5. Rebuild Settings and Members, including their approved layout adjustments.
6. Rebuild Computers, Tasks, Search, Saved, Empty, Diagnostics, and Onboarding.
7. Rebuild Chat and related dense interaction surfaces.
8. Remove old `animal-island-ui`, `@slei/ui`, and `packages/ui`.
9. Run verification and fix regressions.

## Out of Scope

- Rewriting Rust, daemon, protocol, or storage layers.
- Changing product workflows unrelated to UI migration.
- Adding new settings categories or member capabilities.
- Introducing a third theme beyond light and dark.
- Replacing i18n content except where labels must follow migrated controls.
