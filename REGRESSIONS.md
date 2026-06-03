# REGRESSIONS.md - Lash

## Current Regression List

These are user-reported regressions observed after the public Cloudflare test deploy. Treat each item as unconfirmed until its first bead reproduces the problem with a failing test.

| ID    | Title                      | Status | Owner Profile                | Notes                                                                                                                                                                 |
| ----- | -------------------------- | ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001 | Title not working          | Fixed  | Editor Core Agent            | Bead 23 added fail-first Playwright coverage for editable title, topbar mirroring, reload persistence, and mobile metadata non-overlap; implemented local title metadata persistence under `lash:title:demo-document`. |
| R-002 | @mentioning not working    | Fixed  | Mentions & Chips Agent       | Bead 24 added fail-first real-editor coverage and implemented inline atom mention nodes for user/date suggestions while keeping RBAC-hidden suggestions private. |
| R-003 | Sidebar not really working | Fixed  | Editor Core Agent + QA Agent | Bead 25 added fail-first desktop/mobile Playwright coverage and restored collapsed outline access plus the visible mobile close/focus-restore path.                    |

## Next Beads

### Bead 23 - Fix Title Regression

- Workstream: `code`
- Risk class: `medium`
- Primary agent: Editor Core Agent
- Fallback agent: QA & Property-Based Testing Agent
- Status: Complete.
- Scope: document title editing, visible title state, persistence/reload behavior, and any title handoff into history/autosave if currently implied by the UI.
- Acceptance tests:
  - [x] Reproduce the current failure with a failing Playwright test before fixing.
  - [x] A user can edit the title from the main editor UI.
  - [x] The title survives reload or the currently supported persistence boundary.
  - [x] Title text does not overlap chrome on mobile.
  - [x] Relevant lint, typecheck, unit/e2e, and build checks pass.

### Bead 24 - Fix @Mention Regression

- Workstream: `code`
- Risk class: `medium`
- Primary agent: Mentions & Chips Agent
- Fallback agent: Share & RBAC Agent
- Status: Complete.
- Scope: real editor `@` trigger flow, suggestions, keyboard/click selection, inserted mention chip rendering, date mentions, and RBAC-hidden suggestions.
- Acceptance tests:
  - [x] Reproduce the current public workflow failure with a failing Playwright test before fixing.
  - [x] Typing `@` in the editor opens reachable suggestions.
  - [x] Selecting a user inserts an inline mention node/chip.
  - [x] Typing a natural date such as `@next Friday 3pm` produces the date chip behavior expected by `agents.md`.
  - [x] Hidden mentions do not leak inaccessible group/user details.
  - [x] Existing `mention-*` and date mention tests remain green.

### Bead 25 - Fix Sidebar Regression

- Workstream: `code`
- Risk class: `medium`
- Primary agent: Editor Core Agent
- Fallback agent: QA & Property-Based Testing Agent
- Status: Complete.
- Scope: left sidebar visibility, collapse/expand, outline list, outline click behavior, mobile drawer open/close, scroll lock, focus restore, and active/hover/touch states.
- Acceptance tests:
  - [x] Reproduce the current sidebar failure with one or more failing Playwright tests before fixing.
  - [x] Desktop sidebar collapse/expand works without losing outline access.
  - [x] Outline item click focuses the intended document section.
  - [x] Mobile sidebar drawer opens, locks background scroll, closes, and restores focus.
  - [x] Sidebar text/icons remain readable and do not overlap at mobile and desktop widths.
  - [x] Existing mobile, outline, and focus-mode tests remain green.

## Shutdown State

- Local Lash web server: stopped/not running.
- Public test site remains available: `https://lash-9xx.pages.dev/`.
- Next implementation should start at Bead 26 unless the user reprioritizes.
