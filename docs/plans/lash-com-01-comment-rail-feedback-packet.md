# Lash COM-01 Comment Rail Feedback Packet

## Header

Release/build target: COM-01 comment and conversation rail refinement for Lash web.

Baseline commit: `01d08124373df396a38b14773707577765ae2919` on `main`.

Packet author/date: Codex, 2026-06-24 UTC.

Target worktree: `/Users/borker/dev/lash-doc-com-01`.

Target branch: `codex/ux/com-01-comment-rail`.

Goal: Make comments and document chat feel attached to document context, closer to Quip's document conversation model, while preserving durable thread behavior, keyboard access, and writing focus.

Out of scope:

- Replacing the existing TipTap/Yjs document collaboration architecture.
- Adding a production AI model call for chat replies.
- Building a new server comment API or global moderation/audit service.
- Changing share-link authorization semantics.
- Replacing the current text-occurrence anchor model; repeated identical text can still map to the first matching occurrence until a later anchor-model bead stores true ProseMirror positions.

Validation commands:

- `python3 /Users/borker/dev/skill-library-vetted/skills/release-feedback-reactor/scripts/validate_feedback_packet.py docs/plans/lash-com-01-comment-rail-feedback-packet.md`
- `pnpm exec eslint apps/web/components/editor/panels/ChatPanel.tsx apps/web/components/shell/RightRail.tsx apps/web/e2e/doc-chat/chat-durable.spec.ts --max-warnings=0`
- `pnpm run test:e2e -- --project=chromium apps/web/e2e/doc-chat/chat-durable.spec.ts apps/web/e2e/doc-chat/chat-anchor-map.spec.ts apps/web/e2e/doc-chat/chat-current-context.spec.ts apps/web/e2e/a11y/sr-thread-nav.spec.ts`
- `node scripts/visual-snap.mjs http://127.0.0.1:3000 artifacts/ux-sprint/lash/com-01`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run build`

## Raw Artifacts

| Artifact ID | Source                       | Path or URL                                                                                                             | Build             | Notes                                                                                                         |
| ----------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| RAW-01      | Lash visual baseline         | `artifacts/ux-sprint/lash/com-01/baseline/desktop-1440-chat.png`                                                        | `01d0812`         | Current post-outline desktop chat state captured from the COM-01 worktree.                                    |
| RAW-02      | Lash prior proof             | `artifacts/ux-sprint/reports/out-02-document-outline-proof.md:57`                                                       | `01d0812`         | Records the remaining concern that the rail is heavier than Quip's conversation rail.                         |
| RAW-03      | Lash prior proof             | `artifacts/ux-sprint/reports/product-delight-visual-proof.md:20`                                                        | `11ff925` lineage | Records that chat improved but still lacks document-attached comment affordance.                              |
| RAW-04      | Quip accessibility reference | `https://quip.com/training/accessibility-for-quip`                                                                      | web reference     | Describes section-specific comments and conversation pane behavior.                                           |
| RAW-05      | Quip Trailhead reference     | `https://trailhead.salesforce.com/content/learn/modules/quip-for-service-cloud/collaborate-with-quip-for-service-cloud` | web reference     | Describes two channels: document conversation and specific comments, with screenshots referenced in the page. |
| RAW-06      | Quip chat reference          | `https://quip.com/blog/chat-import-export`                                                                              | web reference     | Describes Quip chat direction as cleaner, compact, and consistent across device classes.                      |
| RAW-07      | Current feature tracker      | `FEATURE_AUDIT/STORIES.csv:110`                                                                                         | `01d0812`         | Canonical C15 selection-anchored thread story.                                                                |
| RAW-08      | Existing e2e coverage        | `apps/web/e2e/doc-chat/chat-durable.spec.ts:166`                                                                        | `01d0812`         | Existing durable comments and realtime sync coverage.                                                         |

## Feedback Matrix

| ID     | Severity | Classification | Repro status | Source               | Raw artifact                                   | Surface                                      | User wording                                                                                                   | Expected behavior                                                                                                                                                                                                        |
| ------ | -------- | -------------- | ------------ | -------------------- | ---------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| COM-01 | P1       | UX regression  | reproducible | sprint visual review | RAW-01, RAW-02, RAW-03, RAW-04, RAW-05, RAW-06 | Document chat, right rail, anchored comments | Conversation, comments, and suggestions should feel attached to the document, not like a separate admin panel. | A collaborator can select text, create a thread, see a quiet document-side anchor marker, understand the current target text, reply, resolve/reopen, and keep writing without the conversation rail dominating the page. |

## Feature And Owner Map

| Feedback ID | Feature                             | Owner bead                     | Code paths                                                                                                                                                           | Existing tests                                                                                                                                     | Missing proof                                                                                                                                                                                                                                                                                                                |
| ----------- | ----------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COM-01      | Document chat and conversation rail | COM-01 comment rail refinement | `apps/web/components/editor/panels/ChatPanel.tsx:357`, `apps/web/components/shell/RightRail.tsx:91`, `apps/web/app/globals.css:623`, `apps/web/app/globals.css:2388` | `apps/web/e2e/doc-chat/chat-durable.spec.ts:166`, `apps/web/e2e/doc-chat/chat-anchor-map.spec.ts:15`, `apps/web/e2e/a11y/sr-thread-nav.spec.ts:15` | Visual proof that each Lash comment/chat screenshot is examined against Quip reference behavior, that the thread visibly points back to the document range when mapped, that reload shows explicit orphan handling when the seeded document content is gone, and that realtime sync exposes the marker on the remote client. |

## Evidence Matrix

| Feedback ID | Evidence type  | Evidence                                                                                                                | What it proves                                                                                                                       | Inference                                                                          |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| COM-01      | product proof  | `artifacts/ux-sprint/reports/product-delight-visual-proof.md:20`                                                        | The prior pass explicitly left document-attached comment affordance incomplete.                                                      | Direct product debt from prior proof.                                              |
| COM-01      | product proof  | `artifacts/ux-sprint/reports/out-02-document-outline-proof.md:57`                                                       | The right rail remains heavier than the Quip conversation rail after OUT follow-up.                                                  | Direct product debt from prior proof.                                              |
| COM-01      | implementation | `apps/web/components/editor/panels/ChatPanel.tsx:271`                                                                   | Thread creation already uses current selection and base version, so the bead can improve presentation without replacing persistence. | Scope can stay UI-focused.                                                         |
| COM-01      | implementation | `apps/web/components/editor/panels/ChatPanel.tsx:404`                                                                   | Existing thread rendering is confined to the chat rail list.                                                                         | Current visual attachment is mainly text inside the rail.                          |
| COM-01      | implementation | `apps/web/app/globals.css:2388`                                                                                         | Threads are styled as bordered card blocks, increasing admin-panel weight.                                                           | Rail can become lighter with less card treatment.                                  |
| COM-01      | implementation | `apps/web/components/shell/RightRail.tsx:91`                                                                            | Rail is a complementary activity region with section navigation and all panels visible as siblings.                                  | Changes must preserve section navigation semantics.                                |
| COM-01      | reference      | `https://quip.com/training/accessibility-for-quip`                                                                      | Quip distinguishes section-specific comment indicators from the document-level conversation pane.                                    | Lash should expose both an anchor affordance and a quiet rail summary.             |
| COM-01      | reference      | `https://trailhead.salesforce.com/content/learn/modules/quip-for-service-cloud/collaborate-with-quip-for-service-cloud` | Quip describes comments as specific to document parts and the conversation as a right sidebar.                                       | Lash should make thread specificity obvious without hiding document-level context. |
| COM-01      | reference      | `https://quip.com/blog/chat-import-export`                                                                              | Quip frames improved chat as cleaner, compact, and consistent across desktop, tablet, and phone.                                     | Lash should favor compact interaction and avoid heavy nested blocks.               |

## Acceptance Tests And Proofs

| Feedback ID | Test/proof              | Command or steps                                                                                                                                                                       | Expected result                                                                                                                                                                                                                                    | Receipt                                                   |
| ----------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| COM-01      | packet validation       | `python3 /Users/borker/dev/skill-library-vetted/skills/release-feedback-reactor/scripts/validate_feedback_packet.py docs/plans/lash-com-01-comment-rail-feedback-packet.md`            | Packet passes and reports `COM-01`.                                                                                                                                                                                                                | `artifacts/ux-sprint/reports/com-01-packet-validate.log`  |
| COM-01      | fail-first or guard e2e | `pnpm run test:e2e -- --project=chromium apps/web/e2e/doc-chat/chat-durable.spec.ts` with COM-01 assertions added before implementation                                                | The new assertion fails until the UI exposes an anchored, document-linked thread affordance. Existing durable thread assertions still pass after implementation, including explicit orphan state after reload and remote-client marker visibility. | `artifacts/ux-sprint/reports/com-01-e2e.log`              |
| COM-01      | accessibility e2e       | `pnpm run test:e2e -- --project=chromium apps/web/e2e/a11y/sr-thread-nav.spec.ts`                                                                                                      | Thread article, message list, reply action, and new anchor affordance remain labeled and keyboard reachable.                                                                                                                                       | `artifacts/ux-sprint/reports/com-01-a11y.log`             |
| COM-01      | visual proof            | Capture screenshots with `node scripts/visual-snap.mjs http://127.0.0.1:3000 artifacts/ux-sprint/lash/com-01` and examine each relevant screenshot against RAW-04, RAW-05, and RAW-06. | `desktop-1440-chat.png`, `desktop-1440.png`, `tablet-1024.png`, `tablet-large-768.png`, `mobile-375.png`, and `focus-mode-1440.png` are each reviewed; chat is quieter and visibly range-attached without crowding the editor.                     | `artifacts/ux-sprint/reports/com-01-visual-proof.md`      |
| COM-01      | static checks           | `pnpm run typecheck && pnpm run lint && pnpm run build`                                                                                                                                | Typecheck, lint, and production build pass.                                                                                                                                                                                                        | `artifacts/ux-sprint/reports/com-01-static.log`           |
| COM-01      | feature tracker         | Update `FEATURE_AUDIT/STORIES.csv` and `FEATURE_AUDIT/STORIES_SUMMARY.md`; run deterministic CSV validation.                                                                           | C15/COM-01 status reflects fixed/pass or a narrower accurately named partial if evidence does not prove full completion.                                                                                                                           | `artifacts/ux-sprint/reports/com-01-tracker-validate.log` |

## Bead Contracts

Bead: COM-01 Comment Rail Refinement

Feedback IDs: COM-01.

Goal: Replace the current admin-panel feeling with a quiet, document-attached conversation experience: a derived anchor cue near the target text, compact thread summary in the rail, clear current-context preview, and preserved reply/resolve/reopen behavior.

Risk class: medium, because this touches shared editor layout, chat a11y semantics, visual evidence, and durable comment e2e coverage, but does not change data schemas or server authorization.

Owned files:

- `apps/web/components/editor/panels/ChatPanel.tsx`
- `apps/web/components/shell/RightRail.tsx`
- `apps/web/app/globals.css`
- `apps/web/e2e/doc-chat/chat-durable.spec.ts`
- `apps/web/e2e/doc-chat/chat-anchor-map.spec.ts`
- `apps/web/e2e/a11y/sr-thread-nav.spec.ts`
- `FEATURE_AUDIT/STORIES.csv`
- `FEATURE_AUDIT/STORIES_SUMMARY.md`
- `CONTINUITY.md`
- `HANDOFF.md`
- `handoff/beads.jsonl`
- `artifacts/ux-sprint/lash/com-01/`
- `artifacts/ux-sprint/reports/com-01-*`

Out of scope:

- New backend comment APIs.
- New AI model integration.
- Share-scope semantics.
- Realtime Worker protocol changes.
- Broad typography or palette redesign unrelated to comments/chat.

Source evidence:

- `apps/web/components/editor/panels/ChatPanel.tsx:271`
- `apps/web/components/editor/panels/ChatPanel.tsx:404`
- `apps/web/components/shell/RightRail.tsx:91`
- `apps/web/app/globals.css:623`
- `apps/web/app/globals.css:2388`
- `apps/web/e2e/doc-chat/chat-durable.spec.ts:166`
- `artifacts/ux-sprint/reports/product-delight-visual-proof.md:20`
- `artifacts/ux-sprint/reports/out-02-document-outline-proof.md:57`
- `https://quip.com/training/accessibility-for-quip`
- `https://trailhead.salesforce.com/content/learn/modules/quip-for-service-cloud/collaborate-with-quip-for-service-cloud`

Implementation constraints:

- Preserve localStorage and Yjs persistence behavior.
- Preserve role `article` thread navigation and labeled message lists.
- Preserve `chat-*` test IDs unless adding new IDs.
- Do not make the rail heavier, wider, or more card-like.
- Do not rely on hover for core comment discovery.
- Use stable dimensions so the rail does not resize while replying or resolving.
- Document that COM-01 does not solve duplicate-text anchor precision; it makes the current mapped target visible and actionable.

Acceptance tests/proofs:

- `python3 /Users/borker/dev/skill-library-vetted/skills/release-feedback-reactor/scripts/validate_feedback_packet.py docs/plans/lash-com-01-comment-rail-feedback-packet.md`
- `pnpm exec eslint apps/web/components/editor/panels/ChatPanel.tsx apps/web/components/shell/RightRail.tsx apps/web/e2e/doc-chat/chat-durable.spec.ts --max-warnings=0`
- `pnpm run test:e2e -- --project=chromium apps/web/e2e/doc-chat/chat-durable.spec.ts apps/web/e2e/doc-chat/chat-anchor-map.spec.ts apps/web/e2e/doc-chat/chat-current-context.spec.ts apps/web/e2e/a11y/sr-thread-nav.spec.ts`
- `node scripts/visual-snap.mjs http://127.0.0.1:3000 artifacts/ux-sprint/lash/com-01`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run build`

UX proof: `artifacts/ux-sprint/reports/com-01-visual-proof.md` must compare every captured COM-01 screenshot to Quip reference behavior from RAW-04, RAW-05, and RAW-06 and call out any remaining mismatch.

Review gates:

- Packet validator must pass before implementation.
- Read-only RepoPrompt or Codex subagent must review the COM-01 plan/implementation and report missing UX, a11y, or test coverage.
- Primary-agent final review must inspect screenshots, not only tests.
- PR CI must pass before merge.

Rollback: Revert the COM-01 PR; data contracts remain unchanged.

Expected subagent report:

- Files inspected.
- Recommended UI shape.
- Risks to durable chat behavior.
- Tests/proofs to add or preserve.
- Visual/a11y concerns.
- Workflow feedback for `/tmp/refactor-lash-workflow-orchestration.md`.

## Subagent Prompt Packets

### COM-01 Read-Only UX/Architecture Review

You are reviewing COM-01 from `docs/plans/lash-com-01-comment-rail-feedback-packet.md`.

Feedback IDs:

- COM-01: Conversation, comments, and suggestions should feel attached to the document, not like a separate admin panel.

Owned files to inspect:

- `apps/web/components/editor/panels/ChatPanel.tsx`
- `apps/web/components/shell/RightRail.tsx`
- `apps/web/app/globals.css`
- `apps/web/e2e/doc-chat/chat-durable.spec.ts`
- `apps/web/e2e/a11y/sr-thread-nav.spec.ts`
- `FEATURE_AUDIT/STORIES.csv`

In scope:

- Recommend the narrowest UI changes that make thread anchoring and conversation rail behavior feel writing-native.
- Identify tests and screenshots that would prove the change.
- Identify a11y risks for keyboard and screen reader users.

Out of scope:

- Writing code.
- Changing backend persistence.
- Changing share/RBAC.
- Broad visual redesign outside comment/chat.

Evidence to read first:

- `apps/web/components/editor/panels/ChatPanel.tsx:271`
- `apps/web/components/editor/panels/ChatPanel.tsx:404`
- `apps/web/app/globals.css:2388`
- `artifacts/ux-sprint/reports/product-delight-visual-proof.md:20`
- `artifacts/ux-sprint/reports/out-02-document-outline-proof.md:57`
- `https://quip.com/training/accessibility-for-quip`
- `https://trailhead.salesforce.com/content/learn/modules/quip-for-service-cloud/collaborate-with-quip-for-service-cloud`

Acceptance tests/proofs:

- Focused doc-chat e2e with new anchor-affordance assertions.
- Screen-reader thread navigation e2e.
- Visual proof screenshots under `artifacts/ux-sprint/lash/com-01/`.

Risk class:

- Medium, because shared editor UX and a11y change while data contracts stay fixed.

Required tools:

- RepoPrompt file tree/search/read.
- Optional browser screenshot inspection if available.

Report with:

- Changes recommended.
- Tests/proofs required.
- Screenshots to inspect.
- Assumptions.
- Risks.
- Follow-up recommendations.
- Workflow feedback for `/tmp/refactor-lash-workflow-orchestration.md`.

Stop conditions:

- If the proposed UI requires a product choice not covered by this packet.
- If anchor behavior cannot be proven without data-model changes.

## Review Gates

| Gate | Target        | Tool                                | Pass condition                                                                         | Receipt                                                  |
| ---- | ------------- | ----------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R1   | COM-01 packet | validator                           | `COM-01` is mapped to raw artifacts, evidence, tests, bead contract, and visual proof. | `artifacts/ux-sprint/reports/com-01-packet-validate.log` |
| R2   | COM-01 plan   | RepoPrompt read-only subagent       | No blocking missing-contract or a11y findings.                                         | `/tmp/refactor-lash-workflow-orchestration.md`           |
| R3   | COM-01 UX     | Playwright screenshot/click-through | Each relevant screenshot is examined against Quip references and recorded.             | `artifacts/ux-sprint/reports/com-01-visual-proof.md`     |
| R4   | COM-01 code   | local tests                         | Focused e2e, a11y e2e, lint, typecheck, and build pass.                                | `artifacts/ux-sprint/reports/com-01-*.log`               |
| R5   | final branch  | PR CI                               | Required `build-and-test` passes before merge.                                         | GitHub Actions URL                                       |

## Open Questions

| Question                                                                              | Blocks? | Options                                                            | Recommendation                                                                                                                      | Owner   |
| ------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Should COM-01 add document-level message composition separate from anchored comments? | no      | Add now, defer to future bead                                      | Defer; this bead should make the current anchored thread and rail experience excellent before expanding scope.                      | Product |
| Should the rail be open by default on desktop after COM-01?                           | no      | Keep current state, auto-open after first thread, close by default | Keep current behavior and make the selected thread/anchor cue visible when rail is open; avoid surprising writers with more chrome. | Product |
