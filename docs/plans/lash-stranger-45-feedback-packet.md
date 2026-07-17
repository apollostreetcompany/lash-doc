# Lash Stranger-Quality Release Feedback Packet

## Header

Release baseline: commit `002333017fe2bca4ec589f8d157c1aa21a4b77da`

Qualification branch: `codex/ux/bead-38-stranger-45-sprint`

Target worktree: `/Users/borker/dev/lash-doc`

Packet owner and shared-ledger writer: primary Codex agent `/root`

Packet phase: planning; implementation outcomes remain unproved until the
closeout receipts named below pass.

## Raw Artifacts

| Artifact ID | Source                                      | Path or URL                                                 |
| ----------- | ------------------------------------------- | ----------------------------------------------------------- |
| `RAW-01`    | Project-owner objective                     | `artifacts/stranger-test/raw/user-objective-2026-07-18.md`  |
| `RAW-02`    | Zero-coaching fresh-eyes audit              | `docs/reviews/lash-stranger-fresh-eyes-audit-2026-07-18.md` |
| `RAW-03`    | Desktop and mobile baseline captures        | `artifacts/stranger-test/baseline/`                         |
| `RAW-04`    | Falsifiable stranger qualification contract | `docs/plans/lash-stranger-test-45-criteria.md`              |
| `RAW-05`    | Existing next-milestone contract            | `docs/plans/lash-next-milestone-2026-06-30.md`              |

## Feedback Matrix

The reactor IDs below map one-to-one to the audit IDs with the `STR-` namespace.
The shorter form is used because the vetted packet validator accepts one-hyphen
feedback IDs.

| Feedback ID | Audit ID      | Severity | Classification                         | Surface                          | Disposition                              |
| ----------- | ------------- | -------: | -------------------------------------- | -------------------------------- | ---------------------------------------- |
| `FLOW-01`   | `STR-FLOW-01` |       P0 | Data loss and false durable-save state | Local writing and reload         | Active first product bead                |
| `FLOW-02`   | `STR-FLOW-02` |       P0 | False collaboration success            | Invite and clean-browser join    | Active honesty gate, then deployed proof |
| `FLOW-03`   | `STR-FLOW-03` |       P1 | Mobile interaction trap                | Focus Mode at 375 × 812          | Active rapid UX bead                     |
| `FLOW-04`   | `STR-FLOW-04` |       P1 | Information architecture and layout    | Share rail                       | Queued shell bead                        |
| `FLOW-05`   | `STR-FLOW-05` |       P1 | Dead primary navigation control        | Desktop shell                    | Queued shell bead                        |
| `FLOW-06`   | `STR-FLOW-06` |       P2 | Burst-input correctness                | Editor typing                    | Queued deterministic investigation       |
| `VIS-01`    | `STR-VIS-01`  |       P1 | First-run discoverability              | Empty document body              | Active rapid UX bead                     |
| `VIS-02`    | `STR-VIS-02`  |       P2 | Unwanted entrance motion               | Closed mobile collaboration rail | Queued shell bead                        |

Redundant feedback-capture path:
`CONTINUITY.md` Decision 75 and the stable matrix in
`docs/reviews/lash-stranger-fresh-eyes-audit-2026-07-18.md`.

Queue non-empty verified before reviewer handoff:
`2026-07-17T20:16:37Z`, owner `/root`, count 8.

The queue is ordered by trust and task blocking, not visual novelty:
`FLOW-01`, `FLOW-03`, `FLOW-02`, `VIS-01`, `FLOW-04`, `FLOW-05`, `VIS-02`,
then `FLOW-06`. Real cross-device collaboration remains a production gate even
when the immediate `FLOW-02` repair is honest local-only behavior.

## Supersession Log

No supersessions.

## Evidence Matrix

| Feedback ID | Current-state evidence                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FLOW-01`   | `artifacts/stranger-test/baseline/desktop-writing-before-reload.png` and `artifacts/stranger-test/baseline/desktop-reload-body-lost.png` show the same titled route before and after body loss; `apps/web/components/editor/panels/AutosaveIndicator.tsx:13` invokes autosave without a durable callback; verified_at:002333017fe2bca4ec589f8d157c1aa21a4b77da                 |
| `FLOW-02`   | `artifacts/stranger-test/baseline/desktop-invite-created-local-only.png` and `artifacts/stranger-test/baseline/desktop-invitee-link-no-content.png` show owner success copy and a blank invitee document; `apps/web/lib/inviteAccess.ts:84` creates a browser-local link while the default realtime provider is disabled; verified_at:002333017fe2bca4ec589f8d157c1aa21a4b77da |
| `FLOW-03`   | `artifacts/stranger-test/baseline/mobile-focus-mode.png` shows the blank viewport; the audit records the exit control outside the viewport; verified_at:002333017fe2bca4ec589f8d157c1aa21a4b77da                                                                                                                                                                               |
| `FLOW-04`   | `artifacts/stranger-test/baseline/mobile-share-drawer.png` shows Share active while Doc Chat begins the drawer; `artifacts/stranger-test/baseline/desktop-share-local-only.png` shows document-context loss during rail scrolling; verified_at:002333017fe2bca4ec589f8d157c1aa21a4b77da                                                                                        |
| `FLOW-05`   | `artifacts/stranger-test/baseline/desktop-sidebar-coming-soon.png` shows the desktop menu backdrop and unchanged icon rail; verified_at:002333017fe2bca4ec589f8d157c1aa21a4b77da                                                                                                                                                                                               |
| `FLOW-06`   | `docs/reviews/lash-stranger-fresh-eyes-audit-2026-07-18.md:172` records deterministic first-character reordering at 0–20 ms spacing and non-reproduction at ordinary 50–100 ms spacing; verified_at:002333017fe2bca4ec589f8d157c1aa21a4b77da                                                                                                                                   |
| `VIS-01`    | `artifacts/stranger-test/baseline/desktop-overview-settled.png` and `artifacts/stranger-test/baseline/mobile-overview-settled.png` show a nearly invisible dot as the only empty-body invitation; verified_at:002333017fe2bca4ec589f8d157c1aa21a4b77da                                                                                                                         |
| `VIS-02`    | `artifacts/stranger-test/baseline/mobile-overview-fresh.png` and `artifacts/stranger-test/baseline/mobile-overview-settled.png` show the collaboration rail crossing the first paint before settling; verified_at:002333017fe2bca4ec589f8d157c1aa21a4b77da                                                                                                                     |

## Acceptance Tests And Proofs

| Feedback ID | Test or proof                                                                                                                              | Expected result                                                                                                                                                                                        | Receipt                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `FLOW-01`   | Fail-first unit coverage plus `pnpm run test:e2e -- apps/web/e2e/autosave/local-body-persistence.spec.ts`; before/after reload screenshots | Per-document ProseMirror JSON and title survive reload/new launch; corrupt primary recovers last-good data visibly; failed storage cannot show saved; realtime mode has no competing local body writer | `artifacts/stranger-test/receipts/FLOW-01.json` and `artifacts/stranger-test/final/FLOW-01-reload.png`       |
| `FLOW-02`   | `pnpm run test:e2e -- apps/web/e2e/share/invite-access.spec.ts`; clean-context click-through screenshot                                    | Local-only mode cannot issue a success-looking invite; configured realtime join hydrates the same title/body before success and preserves scope                                                        | `artifacts/stranger-test/receipts/FLOW-02.json` and `artifacts/stranger-test/final/FLOW-02-share-gate.png`   |
| `FLOW-03`   | `pnpm run test:e2e -- apps/web/e2e/focus-mode/focus-mode-ui.spec.ts`; 375 × 812 screenshot and keyboard click-through                      | Focus keeps title/editor visible, exposes a 44 px on-screen exit, preserves selection and scroll, and exits with keyboard or touch                                                                     | `artifacts/stranger-test/receipts/FLOW-03.json` and `artifacts/stranger-test/final/FLOW-03-mobile-focus.png` |
| `FLOW-04`   | `pnpm run test:e2e -- apps/web/e2e/shell/share-rail-navigation.spec.ts`; desktop/mobile screenshots                                        | Activating Share presents Share first; rail scroll is independent; document/topbar remain stationary                                                                                                   | `artifacts/stranger-test/receipts/FLOW-04.json` and `artifacts/stranger-test/final/FLOW-04-share-rail.png`   |
| `FLOW-05`   | `pnpm run test:e2e -- apps/web/e2e/shell/sidebar-navigation.spec.ts`; desktop click-through recording                                      | Desktop menu either reveals usable navigation or is absent; no dimmed dead state; reachable controls stay in viewport                                                                                  | `artifacts/stranger-test/receipts/FLOW-05.json` and `artifacts/stranger-test/final/FLOW-05-sidebar.png`      |
| `FLOW-06`   | Seeded unit/input-order test plus `pnpm run test:e2e -- apps/web/e2e/editor/fast-paragraph-input.spec.ts`; trace log                       | Repeated 0–20 ms paragraph input preserves exact grapheme order without weakening typing-latency gates                                                                                                 | `artifacts/stranger-test/receipts/FLOW-06.json` and `artifacts/stranger-test/final/FLOW-06-input-trace.log`  |
| `VIS-01`    | `pnpm run test:e2e -- apps/web/e2e/editor/empty-document-entry.spec.ts`; desktop/mobile visual proof                                       | Empty body shows a calm writing prompt; clicking the paper focuses the editor; typing removes the prompt without layout shift                                                                          | `artifacts/stranger-test/receipts/VIS-01.json` and `artifacts/stranger-test/final/VIS-01-empty-document.png` |
| `VIS-02`    | `pnpm run test:e2e -- apps/web/e2e/shell/mobile-rail-motion.spec.ts`; first-frame screenshot and reduced-motion recording                  | A closed rail begins off-canvas without covering the editor and no unintended entrance motion occurs                                                                                                   | `artifacts/stranger-test/receipts/VIS-02.json` and `artifacts/stranger-test/final/VIS-02-mobile-entry.png`   |

## Outcome Receipt Contract

| Feedback ID | Bead | Test/proof                                                  | Expected result                                                               | Receipt path                                    |
| ----------- | ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `FLOW-01`   | B39  | Unit tests, persistence browser test, and reload screenshot | Durable local save/recovery is truthful and realtime-isolated                 | `artifacts/stranger-test/receipts/FLOW-01.json` |
| `FLOW-02`   | B41  | Invite browser test and clean-context screenshot            | Local-only share is honestly gated; realtime share hydrates the same document | `artifacts/stranger-test/receipts/FLOW-02.json` |
| `FLOW-03`   | B40  | Mobile Focus browser test and screenshot                    | Focus remains usable and escapable at the target viewport                     | `artifacts/stranger-test/receipts/FLOW-03.json` |
| `FLOW-04`   | B43  | Rail browser test and desktop/mobile screenshot             | Named rail section is first and independently scrollable                      | `artifacts/stranger-test/receipts/FLOW-04.json` |
| `FLOW-05`   | B43  | Sidebar browser test and desktop click-through              | Desktop navigation has no dead dimming action                                 | `artifacts/stranger-test/receipts/FLOW-05.json` |
| `FLOW-06`   | B44  | Seeded input-order test and trace log                       | Exact text order survives the stress sequence                                 | `artifacts/stranger-test/receipts/FLOW-06.json` |
| `VIS-01`    | B42  | Empty-document browser test and visual proof                | Writing affordance is discoverable and non-disruptive                         | `artifacts/stranger-test/receipts/VIS-01.json`  |
| `VIS-02`    | B43  | First-frame browser test and reduced-motion proof           | Closed mobile rail never sweeps across content                                | `artifacts/stranger-test/receipts/VIS-02.json`  |

## Deliberate Behavior Changes

| id            | description                                                                                                | authorized_by                                                  | scope                           |
| ------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| `behavior-01` | “Saved” means the local body write completed, with a visible error or recovery state otherwise             | Project-owner 4.5/5 objective plus audit hard-fail rule        | Local-only document persistence |
| `behavior-02` | Share creation is unavailable with explanatory copy when no collaboration runtime can carry document state | Project-owner trust objective plus product contract            | Local-only share surface        |
| `behavior-03` | Mobile Focus retains a minimal title/editor/exit shell                                                     | Project-owner smoothness objective plus accessibility contract | Narrow-screen Focus Mode        |
| `behavior-04` | Selecting a rail tab exposes that named section first and keeps rail scrolling local                       | Project-owner normal-doc flow objective                        | Collaboration rail              |
| `behavior-05` | A desktop menu control must reveal usable navigation or not render                                         | Project-owner normal-doc flow objective                        | Desktop shell                   |
| `behavior-06` | Stress input must preserve exact character order                                                           | Existing editor correctness invariant                          | Editor input pipeline           |
| `behavior-07` | Empty documents provide a calm, non-content writing invitation                                             | Project-owner delight objective                                | Empty editor                    |
| `behavior-08` | Closed mobile chrome begins visually closed and respects reduced motion                                    | Project-owner calmness objective                               | Mobile shell motion             |

## Bead Contracts

### Bead B38 — Stranger Gate, Intake, and Baseline

Feedback IDs: `FLOW-01`, `FLOW-02`, `FLOW-03`, `FLOW-04`, `FLOW-05`,
`FLOW-06`, `VIS-01`, `VIS-02`

Owned files: `agents.md`, `AGENTS-archive-v1.md`, `CONTINUITY.md`,
`MISTAKES.md`, `docs/plans/lash-stranger-test-45-criteria.md`,
`docs/plans/lash-stranger-45-feedback-packet.md`,
`docs/reviews/lash-stranger-fresh-eyes-audit-2026-07-18.md`, and
`artifacts/stranger-test/baseline/`

Out of scope: product code, deployment, production-service mutation, and a
qualification score.

Risk class: low docs/process because this bead freezes evidence and governance
without changing runtime behavior.

Acceptance tests: vetted packet plan validation, Prettier check, internal-path
check, policy consistency review, screenshot dimension inspection, and
`git diff --check`.

Human-visible boundary proof: 15 screenshots in
`artifacts/stranger-test/baseline/` plus the reviewed evidence index.

Outcome receipt: `handoff/beads.jsonl` B38 row and the pushed B38 commit.

Review gates: independent audit review, docs consistency review, packet
validator green, and branch autoreview at closeout.

Rollback: revert the one B38 documentation commit; preserve raw audit evidence
for traceability.

### Bead B39 — Local Body Persistence and Honest Recovery

Feedback IDs: `FLOW-01`

Owned files: `apps/web/lib/localDocumentPersistence.ts`,
`apps/web/lib/autosave.ts`,
`apps/web/components/editor/panels/AutosaveIndicator.tsx`,
`apps/web/components/shell/TopBar.tsx`,
`apps/web/components/editor/EditorWorkspace.tsx`, focused unit tests,
`apps/web/e2e/autosave/local-body-persistence.spec.ts`, and B39 proof artifacts.

Out of scope: persisting local history/comments, backend schema, production
realtime deployment, or changing the Yjs wire protocol.

Risk class: high because it introduces a versioned persisted-state envelope
and changes the meaning of durable save.

Acceptance tests: establish existing autosave baseline; add fail-first parsing,
backup, quota/error, reload, fresh-launch, per-document isolation, and realtime
no-double-write tests; run lint/typecheck and high-risk relevant integration
coverage; capture the reload screenshot.

Human-visible boundary proof: same-document before/reload/recovery screenshots
at `artifacts/stranger-test/final/FLOW-01-reload.png`.

Outcome receipt: `artifacts/stranger-test/receipts/FLOW-01.json`.

Review gates: GPT-5.6 Sol XHigh Architect sign-off, Frontend/Editor Engineer
implementation, independent Analyst review, packet closeout validation, and
autoreview.

Rollback: stop consuming the versioned local keys and revert B39; never delete
existing browser records during rollback.

### Bead B40 — Viewport-Safe Mobile Focus

Feedback IDs: `FLOW-03`

Owned files: `apps/web/components/shell/AppShell.tsx`,
`apps/web/components/editor/panels/FocusModeToggle.tsx`,
`apps/web/app/globals.css`, focused accessibility coverage,
`apps/web/e2e/focus-mode/focus-mode-ui.spec.ts`, and B40 proof artifacts.

Out of scope: desktop editor redesign, mobile toolbar redesign, and rail
information architecture.

Risk class: medium because it changes responsive layout and focus behavior
without contracts, schema, security, or deployment changes.

Acceptance tests: confirm fail-first 375 × 812 behavior; prove title/editor and
a 44 px exit remain visible; keyboard/touch enter-exit preserves selection and
scroll; run existing Focus accessibility/UI tests and visual screenshots.

Human-visible boundary proof:
`artifacts/stranger-test/final/FLOW-03-mobile-focus.png`.

Outcome receipt: `artifacts/stranger-test/receipts/FLOW-03.json`.

Review gates: Frontend Engineer implementation, independent UX/accessibility
review, targeted browser tests, and autoreview.

Rollback: revert B40 CSS/component changes as one commit.

### Bead B41 — Collaboration-Truth Gate

Feedback IDs: `FLOW-02`

Owned files: `apps/web/components/editor/panels/SharePanel.tsx`,
`apps/web/components/editor/EditorWorkspace.tsx`,
`apps/web/lib/inviteAccess.ts`, focused share tests,
`apps/web/e2e/share/invite-access.spec.ts`, and B41 proof artifacts.

Out of scope: inventing production secrets, claiming an undeployed runtime,
email delivery, or changing public invite-token shape without owner approval.

Risk class: high because invitation and access-policy semantics are
security-sensitive.

Acceptance tests: fail-first local-only negative test; configured local
realtime positive clean-context hydration/convergence and narrower-scope
negative test; lint/typecheck; screenshot the local-only explanation.

Human-visible boundary proof:
`artifacts/stranger-test/final/FLOW-02-share-gate.png`.

Outcome receipt: `artifacts/stranger-test/receipts/FLOW-02.json`.

Review gates: Architect policy sign-off, Share/Frontend Engineer
implementation, security Analyst review, packet closeout validation, and
autoreview.

Rollback: revert B41 UI/policy behavior without deleting invite records; the
known local-only limitation must remain documented.

### Bead B42 — Calm Empty-Document Entry

Feedback IDs: `VIS-01`

Owned files: `apps/web/components/editor/EditorWorkspace.tsx`,
`apps/web/app/globals.css`,
`apps/web/e2e/editor/empty-document-entry.spec.ts`, and B42 proof artifacts.

Out of scope: onboarding tours, templates, generated sample content, or
editor-wide visual redesign.

Risk class: medium because it changes a central first-run interaction and
responsive presentation.

Acceptance tests: fail-first desktop/mobile discoverability test; clicking the
paper focuses the editor; typing removes the prompt with no persisted text or
layout shift; existing editor accessibility tests remain green.

Human-visible boundary proof:
`artifacts/stranger-test/final/VIS-01-empty-document.png`.

Outcome receipt: `artifacts/stranger-test/receipts/VIS-01.json`.

Review gates: Frontend Engineer implementation, independent UX review,
targeted browser tests, and autoreview.

Rollback: revert B42 as one visual-interaction commit.

### Bead B43 — Stable, Named Collaboration Chrome

Feedback IDs: `FLOW-04`, `FLOW-05`, `VIS-02`

Owned files: `apps/web/components/shell/AppShell.tsx`,
`apps/web/components/shell/RightRail.tsx`,
`apps/web/components/shell/Sidebar.tsx`, `apps/web/app/globals.css`, focused
shell tests, and B43 proof artifacts.

Out of scope: feature logic inside Chat/History/AI/Share, new navigation
destinations, or persistence.

Risk class: medium because it changes shared responsive shell behavior across
several UI surfaces.

Acceptance tests: fail-first mobile and desktop shell paths; named tab first;
independent rail scroll; stable document/topbar; no desktop dead dimmer;
closed first frame and reduced-motion proof.

Human-visible boundary proof:
`artifacts/stranger-test/final/FLOW-04-share-rail.png`,
`artifacts/stranger-test/final/FLOW-05-sidebar.png`, and
`artifacts/stranger-test/final/VIS-02-mobile-entry.png`.

Outcome receipt: `artifacts/stranger-test/receipts/FLOW-04.json`,
`artifacts/stranger-test/receipts/FLOW-05.json`, and
`artifacts/stranger-test/receipts/VIS-02.json`.

Review gates: Frontend Engineer implementation, independent responsive/a11y
review, targeted browser tests, and autoreview.

Rollback: revert B43 shell commit; do not mix feature-state changes into the
rollback.

### Bead B44 — Deterministic Burst-Input Investigation

Feedback IDs: `FLOW-06`

Owned files: a focused investigation report, deterministic editor input test,
the smallest proven editor fix if reproduction is product-caused, and B44
trace/receipt artifacts.

Out of scope: weakening timing SLOs, hiding corrupt output, or broad editor
refactors before causality is established.

Risk class: medium until proven otherwise; escalate to high if the repair
changes schema, composition, collaboration, or public editor contracts.

Acceptance tests: seeded repeated 0–20 ms paragraph sequences, ordinary-speed
control sequences, exact grapheme assertions, typing-latency checks, and
trace-log review.

Human-visible boundary proof:
`artifacts/stranger-test/final/FLOW-06-input-trace.log` plus a short recording
if the visible corruption reproduces.

Outcome receipt: `artifacts/stranger-test/receipts/FLOW-06.json`.

Review gates: Editor Core Engineer investigation, independent Analyst
causality review, risk reclassification, targeted tests, and autoreview.

Rollback: remove only the B44 test/fix after preserving the reproduction trace.

## Review Gates

- `FLOW-01` gate state red until architecture, implementation, reload/recovery
  proof, high-risk tests, and independent review pass.
- `FLOW-02` gate state red until local-only behavior is honest and a configured
  two-clean-context runtime proves same-document hydration and scope.
- `FLOW-03` gate state red until target-viewport Focus proof and accessibility
  review pass.
- `FLOW-04` gate state red until named-section and stable-document visual proof
  pass.
- `FLOW-05` gate state red until desktop navigation has no dead primary action.
- `FLOW-06` gate state red until exact-order stress proof establishes cause and
  outcome.
- `VIS-01` gate state red until the empty-body entry path passes desktop/mobile
  click-through and visual review.
- `VIS-02` gate state red until first-frame and reduced-motion proof pass.

Packet review order: source-faithful audit review, bead entry-gate review,
required specialist path, independent outcome review, vetted packet closeout
validation, then vetted autoreview. No red gate may be described as fixed or
approved.
