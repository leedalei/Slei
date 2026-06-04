# Slei shadcn/ui Inventory

## Visible Dialogs, Drawers, and Panels

- Shell: create channel dialog, create computer dialog, create agent dialog, runtime setup modal, guide-loading status dialog.
- Chat: session drawer, mention panel, permission card, interactive card dialog, attachment chips, saved message panel.
- Tasks: task thread drawer and reply composer.
- Members: delete confirmation/error surface, editable detail fields, capability and permission panels.
- Computers: create computer dialog and node detail panel.
- Search: filter panel, results list, and empty result state.
- Settings: preference panels for account, language-region, appearance, notifications, about.
- Diagnostics: error panel and log export dialog.
- Notifications: notification center.
- Onboarding: profile, connection, and runtime setup steps.

## Test Assertion Migration

- Prefer role/name/text assertions over class assertions.
- Keep `data-testid="slei-send-button"` until chat send tests are migrated.
- Treat the high-risk legacy assertion suites listed in `docs/superpowers/plans/2026-06-04-slei-shadcn-ui-rebuild.md` as the committed pointer for the larger `/tmp/slei-shadcn-legacy-assertions.txt` output.
- Replace CSS rule tests with shadcn/tweakcn token and import tests.
- Delete package-level UI tests when `packages/ui` is deleted.
