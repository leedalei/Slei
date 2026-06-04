# Slei shadcn/ui Inventory

## Visible Dialogs, Drawers, and Panels

- Shell: create channel dialog, create computer dialog, create agent dialog, runtime setup modal.
- Chat: session drawer, mention panel, permission card, interactive card dialog, attachment chips, saved message panel.
- Tasks: task thread drawer and reply composer.
- Members: delete confirmation/error surface, editable detail fields, capability and permission panels.
- Computers: create computer dialog and node detail panel.
- Settings: preference panels for account, language-region, appearance, notifications, about.
- Diagnostics: error panel and log export dialog.
- Notifications: notification center.
- Onboarding: profile, connection, and runtime setup steps.

## Test Assertion Migration

- Prefer role/name/text assertions over class assertions.
- Keep `data-testid="slei-send-button"` until chat send tests are migrated.
- Replace CSS rule tests with shadcn/tweakcn token and import tests.
- Delete package-level UI tests when `packages/ui` is deleted.
