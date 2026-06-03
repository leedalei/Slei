# Animal Island System Redesign Design

Date: 2026-06-03
Status: Approved for implementation planning

## Goal

Refactor the Slei desktop application design system to use `animal-island-ui` as the UX and component-language foundation. The redesign should feel like Animal Island across the whole product while preserving Slei's core desktop workflow efficiency.

The target application is `/Users/leelei/Documents/Slei`, especially the React/Tauri desktop app under `apps/desktop` and the shared Slei UI styles under `packages/ui`.

## Source UX

Use the npm package `animal-island-ui` directly, following the upstream README integration pattern:

- Install with the package manager.
- Import component styles once with `import 'animal-island-ui/style'`.
- Reuse the package as the design reference for fonts, colors, rounded component shapes, cards, tabs, inputs, modals, and motion.

The GitHub repository supplied by the user is the visual reference, but implementation should use the npm package rather than the pinned Git commit.

## Selected Approach

Use a dependency-driven Slei design system rewrite.

Slei will install `animal-island-ui` and import its stylesheet, then rewrite Slei's semantic design tokens and global component styles to align with Animal Island. Product code should continue to use Slei's existing semantic token names and `.slei-*` class surface where possible. This preserves the app's routing, daemon bridge, state management, tests, and product-specific interaction patterns while making the UI system visually consistent with Animal Island.

Avoid a direct page-by-page replacement where complex Slei surfaces are rewritten wholesale with `animal-island-ui` components. Direct replacement is too risky for chat, task drawers, uploads, mentions, settings forms, and existing e2e coverage.

## Design Direction

The chosen style strength is "deep componentization":

- More than a color reskin.
- Less than a fully decorative island scene.
- Medium relaxation of density: controls and cards become rounder and more breathable, but chat and tasks remain efficient.
- Animal Island shapes and behavior should be visible in shared controls, shell, cards, tabs, modals, inputs, chips, and drawers.

## Themes

Support two themes:

- Light: the primary Animal Island experience.
- Dark: a "night island" companion theme.

Do not design or implement a high-contrast Animal Island theme in this scope.

Settings UI should present only `light` and `dark`. It should not present `system` or `highContrast` as active options for this redesign.

The new default theme should be `light`. If existing saved preferences or daemon defaults can still produce legacy `system` or `highContrast` values, the app should normalize them to `light` before applying theme styles. The underlying bridge/type layer may temporarily tolerate legacy values for compatibility, but visible product behavior should be two-theme only.

### Light Theme

The light theme should use:

- Warm off-white page backgrounds.
- Cream or paper-colored surfaces.
- Wood-brown primary text.
- Muted tan secondary text.
- Teal primary actions.
- Yellow accent and attention states.
- Soft green success states.
- Soft red destructive/error states.
- Rounded controls and cards.
- Soft drop shadows rather than hard black offset shadows.
- Optional subtle dotted, dashed, or paper-like separators where they do not reduce readability.

### Dark Theme

The dark theme should feel like Animal Island at night:

- Deep teal, dark sea, or dark wood backgrounds.
- Warm cream text, not pure white.
- Teal and yellow remain the primary interaction colors.
- Borders should be softer than the current black neo-brutalist style.
- Shadows should be subtle and legible on dark surfaces.
- Error, warning, success, and info states must remain readable.

## Design System Architecture

### Dependency Integration

Add `animal-island-ui` as a dependency for the desktop app or shared UI package, whichever best matches the final implementation plan.

Import `animal-island-ui/style` once at the frontend entry point before or alongside Slei's own style layers. The import order should allow Slei product-specific styles to override package defaults where needed.

### Token Strategy

Preserve the Slei semantic token surface in `packages/ui/src/styles/tokens.css`:

- `--color-*`
- `--text-*`
- `--weight-*`
- `--leading-*`
- `--border-*`
- `--radius-*`
- `--shadow-*`
- `--gap-*`
- `--padding-*`
- sizing tokens such as `--rail-width`, `--sidebar-width`, and `--composer-height`
- motion tokens

Rewrite the token values to map to Animal Island's visual language. Application and component code should keep consuming Slei semantic tokens rather than referencing `--animal-*` throughout product code.

This keeps Slei's design system boundary intact and avoids coupling every feature component directly to a third-party token namespace.

### Global Component Styles

Rewrite `packages/ui/src/styles/globals.css` to restyle the shared `.slei-*` component classes:

- `.slei-button`
- `.slei-input`
- `.slei-textarea`
- `.slei-select`
- `.slei-checkbox`
- `.slei-badge`
- `.slei-avatar`
- `.slei-dialog`
- `.slei-tabs`
- `.slei-card`
- `.slei-panel`

Expected component treatment:

- Buttons: rounded pill or soft rounded forms, teal/yellow action states, 2px soft borders, low warm shadows, small lift on hover, press-in on active.
- Inputs and textareas: rounded cream fields, tan border, warm placeholder text, teal focus state, clear disabled state.
- Selects and checkboxes: Animal Island rounded geometry with clear checked/focus affordances.
- Badges and chips: rounded, compact, color-coded, readable at small sizes.
- Cards and panels: 18-24px rounding, warm surfaces, soft borders, possible subtle dotted or dashed separators.
- Dialogs and drawers: soft island modal feel, but keep content regions predictable for forms and dense information.
- Avatars: rounder and friendlier, without sacrificing recognition or status indicators.

## Product Surface Mapping

### Shell

Keep the existing desktop shell structure:

- left primary rail
- contextual sidebar
- resize handle
- main workspace

Restyle the rail as an Animal Island tool rail. The current view should use a raised yellow or teal active state. The sidebar should become a warm island panel with rounded channel/member/node rows. Keep the current route and selection behavior.

### Chat

Keep the current chat layout:

- channel header
- embedded view tabs
- timeline
- composer
- optional session drawer

Messages should not become oversized casual chat bubbles. Instead, use light card treatment on hover/focus and for important interactive content. Attachments, tool calls, permission cards, interactive cards, saved-message controls, and mention panels should use the Animal Island component language.

The composer should be one of the clearest redesign areas:

- rounded input area
- pill send button
- rounded attachment chips
- Animal Island mention panel
- existing send, task, attachment, mention, and keyboard behavior preserved

### Tasks

Task board columns should become rounded soft panels. Task cards should adopt Animal Island card treatment with clear status chips. The right-side task thread drawer should keep its workflow and dimensions but use the new panel, composer, reply, and button styles.

### Members

Member navigation and detail pages should use rounded profile cards, softer avatars, and chip-like metadata. Keep capabilities, permissions, profile editing, paths, actions, and messaging behavior intact.

### Computers

Computer node lists and detail cards should use the same rounded list-card system as members. Runtime status, rename, delete, and create flows should remain unchanged.

### Settings

Settings should become calm Animal Island preference panels. Appearance settings should expose only light and dark themes for this scope, with `light` as the default. The settings UI should not show system or high-contrast theme choices. Other settings forms should reuse redesigned inputs, selects, checkboxes, cards, and buttons.

### Search

Search filters, results, and saved-message states should inherit the rounded controls and card result treatment. Preserve current filter behavior and result navigation.

### Empty States

Keep the existing pixel face identity. Restyle its container, colors, border, shadow, and surrounding copy so the pixel face feels like a small expression on an Animal Island paper card. Do not replace it with new illustrations.

### Crash and Error States

The crash screen, permission approval cards, failed message states, runtime errors, and destructive actions must remain highly legible. Error styling should use Animal Island red tones without becoming too soft to notice.

## Data Flow and Behavior

This redesign is primarily visual and structural at the design system layer.

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

Small JSX adjustments are acceptable when needed to support the new component hierarchy or to wrap existing content in redesigned containers. Any such changes should preserve ARIA labels, keyboard behavior, and testable user flows.

## Accessibility and Responsiveness

The redesign must preserve or improve accessibility:

- visible focus states for all controls
- adequate contrast in light and dark themes
- keyboard-operable buttons, tabs, forms, dialogs, drawers, and resize handle
- no text overlap in narrow viewports
- long channel names, member names, file names, and paths must truncate or wrap intentionally
- icons must not become the only accessible label
- motion should respect `prefers-reduced-motion`

The app must remain usable at desktop sizes and narrow test viewports already covered by e2e tests.

## Implementation Scope

Expected files or areas to change during implementation planning:

- root or app package dependency metadata and lockfile
- `apps/desktop/src/web.ts` for stylesheet import order
- `packages/ui/src/styles/tokens.css`
- `packages/ui/src/styles/globals.css`
- `packages/ui/src/styles/design-system.test.ts`
- `apps/desktop/src/app/app.css`
- selected React components in `apps/desktop/src/app`, `apps/desktop/src/components`, and `apps/desktop/src/features`
- i18n or settings model code only if required to remove `system` and `highContrast` from visible theme choices
- focused tests and snapshots/e2e assertions that encode the old neo-brutalist assumptions

Avoid unrelated refactors.

## Verification Plan

Implementation should be verified with:

- TypeScript typecheck for affected packages.
- Existing desktop Vitest/e2e tests relevant to shell, chat, tasks, members, computers, settings, search, empty states, and accessibility.
- Design-system tests updated to assert the Animal Island token surface and to remove neo-brutalism-specific expectations.
- Browser visual checks of the local desktop app in light and dark themes.
- At minimum, visual inspection of shell, chat, composer, task board, task drawer, member detail, computer detail, settings, search, empty state, and crash/error-like surfaces where possible.

## Acceptance Criteria

The redesign is successful when:

- `animal-island-ui` is installed from npm and its stylesheet is imported.
- Slei's default UI clearly reads as Animal Island rather than neo-brutalist.
- Light and dark themes are implemented and selectable.
- Settings exposes only light and dark theme choices, with no system or high-contrast option.
- Legacy `system` or `highContrast` saved values fall back to light.
- Existing core workflows remain intact.
- The pixel face empty state remains present and visually integrated.
- Shared Slei component classes use the new rounded, warm, soft-shadow system.
- Product pages consistently inherit the new component language.
- Typecheck and targeted tests pass, or any remaining failures are explicitly explained.
