# REGRESSIONS.md - Lash

## Current Regression List

These are user-reported regressions observed after the public Cloudflare test deploy. Treat each item as unconfirmed until its first bead reproduces the problem with a failing test.

| ID    | Title                      | Status | Owner Profile                | Notes                                                                                                                                                                 |
| ----- | -------------------------- | ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001 | Title not working          | Open   | Editor Core Agent            | Document title behavior needs triage. Confirm whether the failure is editing, persistence, layout, export, or all of those.                                           |
| R-002 | @mentioning not working    | Open   | Mentions & Chips Agent       | Mention trigger/insertion must be checked in the real editor path, not just panel/test-hook paths. Existing tests may be passing against an incomplete user workflow. |
| R-003 | Sidebar not really working | Open   | Editor Core Agent + QA Agent | Sidebar behavior is broad; first pass should verify desktop collapse, mobile drawer, outline navigation, focus restore, and active state behavior.                    |

## Next Beads

### Bead 23 - Fix Title Regression

- Workstream: `code`
- Risk class: `medium`
- Primary agent: Editor Core Agent
- Fallback agent: QA & Property-Based Testing Agent
- Scope: document title editing, visible title state, persistence/reload behavior, and any title handoff into history/autosave if currently implied by the UI.
- Acceptance tests:
  - Reproduce the current failure with a failing Playwright test before fixing.
  - A user can edit the title from the main editor UI.
  - The title survives reload or the currently supported persistence boundary.
  - Title text does not overlap chrome on desktop or mobile.
  - Relevant lint, typecheck, unit/e2e, and build checks pass.

### Bead 24 - Fix @Mention Regression

- Workstream: `code`
- Risk class: `medium`
- Primary agent: Mentions & Chips Agent
- Fallback agent: Share & RBAC Agent
- Scope: real editor `@` trigger flow, suggestions, keyboard/click selection, inserted mention chip rendering, date mentions, and RBAC-hidden suggestions.
- Acceptance tests:
  - Reproduce the current public workflow failure with a failing Playwright test before fixing.
  - Typing `@` in the editor opens reachable suggestions.
  - Selecting a user/group inserts an inline mention node/chip.
  - Typing a natural date such as `@next Friday 3pm` produces the date chip behavior expected by `agents.md`.
  - Hidden mentions do not leak inaccessible group/user details.
  - Existing `mention-*` and date mention tests remain green.

### Bead 25 - Fix Sidebar Regression

- Workstream: `code`
- Risk class: `medium`
- Primary agent: Editor Core Agent
- Fallback agent: QA & Property-Based Testing Agent
- Scope: left sidebar visibility, collapse/expand, outline list, outline click behavior, mobile drawer open/close, scroll lock, focus restore, and active/hover/touch states.
- Acceptance tests:
  - Reproduce the current sidebar failure with one or more failing Playwright tests before fixing.
  - Desktop sidebar collapse/expand works without losing outline access.
  - Outline item click focuses the intended document section.
  - Mobile sidebar drawer opens, locks background scroll, closes, and restores focus.
  - Sidebar text/icons remain readable and do not overlap at mobile and desktop widths.
  - Existing mobile, outline, focus-mode, and cross-browser smoke tests remain green.

## Shutdown State

- Local Lash web server: stopped/not running.
- Public test site remains available: `https://lash-9xx.pages.dev/`.
- Next implementation should start at Bead 23 unless the user reprioritizes.
