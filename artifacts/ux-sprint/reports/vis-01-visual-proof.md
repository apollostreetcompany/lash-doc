# VIS-01 Visual Proof — Lash Baseline vs Quip References

Date: 2026-06-24
Worktree: `/Users/borker/dev/lash-doc-delight-sprint`
Branch: `codex/ux/delightful-writing-sprint`
Scope: Bead 1 VIS-01 evidence baseline only.

## Validation receipt

- Port check: `lsof -n -P -iTCP:3000 -sTCP:LISTEN` returned no listener before starting the server.
- Dependency setup: `pnpm install --frozen-lockfile` was required because `node_modules` was missing; lockfile hunk introduced by install was reverted because `pnpm-lock.yaml` is out of VIS-01 scope.
- Build: `NEXT_PUBLIC_LASH_TEST_HOOKS=true pnpm --filter @lash/web build` passed.
- Server: `NEXT_PUBLIC_LASH_TEST_HOOKS=true bash scripts/lash-web-start.sh` passed and started `http://127.0.0.1:3000` in tmux session `lash-doc-web`.
- Snapshot command: `node scripts/visual-snap.mjs http://localhost:3000 artifacts/ux-sprint/lash/baseline` passed after rerun outside the sandbox because Chromium launch was denied by macOS MachPort sandbox permissions.

## Quip reference sources

Quip screenshots are not stored in-repo for this bead because the plan marks that permission as UNCONFIRMED. References are URL-only:

- Quip fresh product shell: https://quip.com/blog/new-faster-smarter-quip
- Quip document outline: https://quip.com/blog/document-outlines
- Quip highlights / inline formatting: https://quip.com/blog/multicolored-highlights
- Quip document + conversation + tables: https://www.softwareadvice.co.uk/software/35270/quipcms
- Quip spreadsheets / mobile editing: https://quip.com/blog/spreadsheets
- Local notes: `QUIP_DESIGN_NOTES.md`

## Screenshot inventory and gap notes

| Lash screenshot | Quip reference | Concrete observed gap | Severity |
| --- | --- | --- | --- |
| `artifacts/ux-sprint/lash/baseline/desktop-1440.png` | Fresh shell + document/conversation references | Lash exposes dense top toolbar, left nav, right rail, and document metadata at first paint; Quip references read calmer and put the document body first. | High |
| `artifacts/ux-sprint/lash/baseline/tablet-1024.png` | Fresh shell reference | Tablet layout keeps much of the desktop chrome, making the writing canvas feel boxed in compared with Quip's lighter tablet/editor presentation. | High |
| `artifacts/ux-sprint/lash/baseline/tablet-large-768.png` | Mobile/tablet editing reference | Mid-size tablet capture is functional but cramped; Quip mobile/tablet references emphasize a simpler review/edit flow. | Medium |
| `artifacts/ux-sprint/lash/baseline/mobile-375.png` | Spreadsheets/mobile editing reference | Mobile baseline compresses core writing and review surfaces into narrow chrome; the key risk is review/edit discoverability away from desktop. | High |
| `artifacts/ux-sprint/lash/baseline/focus-mode-1440.png` | Fresh shell reference | Focus mode moves closer to a calm page, but normal desktop mode still needs to make this writing-first hierarchy feel like the default. | Medium |
| `artifacts/ux-sprint/lash/baseline/desktop-1440-chat.png` | Document + conversation reference | Conversation exists but reads like a right-side admin rail rather than feedback attached to specific document context. | High |
| `artifacts/ux-sprint/lash/baseline/desktop-1440-table.png` | Spreadsheets + inline formatting references | Table state is usable but toolbar/table controls are visually louder than Quip's familiar spreadsheet-like affordances. | Medium |
| `artifacts/ux-sprint/lash/baseline/desktop-1440-outline.png` | Document outline reference | Baseline captures the default rendered outline against a long, mid-scrolled memo. Outline is present, but it competes with the full dark navigation column and feels less like lightweight document structure. | High |
| `artifacts/ux-sprint/lash/baseline/entrance-100ms.png` | Fresh shell reference | Early entrance frame emphasizes large app chrome before the document settles; Quip references prioritize fast comprehension of the document surface. | Medium |
| `artifacts/ux-sprint/lash/baseline/entrance-240ms.png` | Fresh shell reference | Motion still exposes multiple competing regions at once; opportunity is to make entrance choreography guide attention to the page. | Medium |
| `artifacts/ux-sprint/lash/baseline/entrance-380ms.png` | Fresh shell reference | Shell is mostly settled but the document still shares attention with rail/sidebar chrome. | Medium |
| `artifacts/ux-sprint/lash/baseline/entrance-520ms.png` | Fresh shell reference | Later entrance frame remains visually busy relative to Quip's calmer writing-first references. | Low |
| `artifacts/ux-sprint/lash/baseline/entrance-700ms.png` | Fresh shell reference | End of entrance reaches stable baseline; remaining gap is static hierarchy rather than motion correctness. | Low |

## Baseline files confirmed

Expected VIS-01 files exist in `artifacts/ux-sprint/lash/baseline/`:

- `desktop-1440.png`
- `tablet-1024.png`
- `tablet-large-768.png`
- `mobile-375.png`
- `focus-mode-1440.png`
- `desktop-1440-chat.png`
- `desktop-1440-table.png`
- `desktop-1440-outline.png`
- `entrance-100ms.png`
- `entrance-240ms.png`
- `entrance-380ms.png`
- `entrance-520ms.png`
- `entrance-700ms.png`

## Assumptions and risks

- Quip reference images remain URL-only until the project confirms they may be stored under `artifacts/ux-sprint/raw/quip/`.
- The outline baseline intentionally uses only the existing rendered outline and a seeded long document; no product hook, test id, or collapsed-outline product state was added.
- The local server remains a validation service, not a deploy proof.

## Follow-up recommendations

1. Bead 2 should compare postfix screenshots against this baseline and preserve the same filenames under `artifacts/ux-sprint/lash/postfix/`.
2. Prioritize calm default canvas hierarchy, lighter outline affordance, and attached chat/comment context before smaller toolbar polish.
3. If reviewers need a collapsed-heading outline variant, implement the needed product interaction in Bead 2 and capture it as postfix evidence, not as VIS-01 baseline scope.
