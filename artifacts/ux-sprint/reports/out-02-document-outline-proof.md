# OUT-02 Document-Side Outline Proof

Date: 2026-06-24

Branch: `codex/ux/delightful-writing-followup`

Feedback: OUT-01 follow-up from the delight sprint. Product Delight Wave 1 left the outline visually anchored in the dark global sidebar; this bead moves the primary outline into the document canvas area at desktop widths while preserving collapsed-sidebar and mobile-drawer access.

## Quip Reference

- `QUIP_DESIGN_NOTES.md` section 7: the outline should sit near the document canvas, outside the main content column, without card chrome.
- `QUIP_DESIGN_NOTES.md` section 10: below desktop widths, the sidebar/drawer model can take over.

## Implementation

- `EditorWorkspace.tsx` now renders the canonical `OutlinePanel` in `.lash-document-outline` beside the document paper when focus mode is off.
- `Sidebar.tsx` keeps the collapsed `sidebar-outline-access` affordance, but does not render a duplicate sidebar outline in the default collapsed desktop state.
- `OutlinePanel.tsx` supports scoped test IDs/title IDs so the sidebar fallback does not collide with the canonical document outline.
- `globals.css` gives the document outline a quiet, sticky, borderless desktop treatment and keeps the global sidebar icon-only by default.

## Visual Evidence

Fresh screenshots:

- `artifacts/ux-sprint/lash/followup-outline/desktop-1440.png`
- `artifacts/ux-sprint/lash/followup-outline/desktop-1440-outline.png`
- `artifacts/ux-sprint/lash/followup-outline/desktop-1440-chat.png`
- `artifacts/ux-sprint/lash/followup-outline/mobile-375.png`

Observed result:

- Desktop now opens with a collapsed global nav rail and document-side outline, closer to the Quip layout contract.
- The outline is no longer visually presented as workspace navigation.
- The collapsed sidebar no longer leaks `Soon` badge text into the icon rail.
- Mobile remains a writing-first surface with the existing drawer flow unchanged.

## Validation

- `artifacts/ux-sprint/reports/out-02-static-checks.log`
  - `git diff --check`
  - `pnpm run typecheck`
  - focused ESLint on touched shell/outline files
- `artifacts/ux-sprint/reports/out-02-outline-e2e.log`
  - `sidebar-regression.spec.ts`
  - `outline-collapse-basic.spec.ts`
  - `outline-persist.spec.ts`
  - `outline-caret-move.spec.ts`
  - `sr-headings.spec.ts`
  - `focus-mode-ui.spec.ts`
  - Result: 8 passed.
- `artifacts/ux-sprint/reports/out-02-visual-snap.log`
  - `node scripts/visual-snap.mjs http://127.0.0.1:3000 artifacts/ux-sprint/lash/followup-outline`
  - Result: full screenshot set captured and local server stopped.

## Residual Risk

- The right rail still reads heavier than Quip's conversation rail; that remains COM-01 follow-up work.
- At 1280-1440px with the rail open, the outline competes for horizontal space. Current screenshots are acceptable, but a later pass should consider auto-collapsing the activity rail sooner or letting the outline overlay when both side surfaces are open.
