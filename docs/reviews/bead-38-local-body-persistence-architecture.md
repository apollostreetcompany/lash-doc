# Bead 38 — Local Document Body Persistence Architecture Review

**Branch:** `codex/ux/bead-38-stranger-45-sprint`
**Baseline:** `002333017fe2bca4ec589f8d157c1aa21a4b77da`
**Review role:** Required Architect
**Risk class:** **High** — persisted user state, corruption recovery, schema validation, and separation from the realtime source of truth
**Verdict:** **APPROVE implementation with mandatory conditions**

Implementation may proceed using the versioned two-slot localStorage design below. This is approval to implement, not approval to merge. Merge is blocked until every lifecycle, corruption, cross-tab, quota, realtime-isolation, security, and test gate in this report passes.

## Executive decision

The proposed versioned per-document primary plus last-good backup is the smallest acceptable design for this rapid local-only product bead. It fits the existing app-level persistence boundary, requires no backend or Yjs protocol change, and can make the current “All changes saved” claim truthful.

The proposal is not safe as written unless the implementation also does all of the following:

1. Hydrates and schema-validates before local autosave can subscribe.
2. Keeps recovery mode read-only until the user deliberately promotes the recovered copy.
3. Flushes pending local work on page hide and workspace teardown instead of only cancelling it.
4. Detects cross-tab revision conflicts and fails visibly rather than silently overwriting.
5. Treats persisted JSON as untrusted and rejects unsafe URL-bearing attributes.
6. Throws on body-storage failures and publishes the test hook only after the real save succeeds.
7. Omits the local autosave path and indicator entirely when realtime collaboration is enabled.

Without those amendments, the verdict is **reject** because the bead could still lose work or falsely report it saved.

## Evidence and current truth

RepoPrompt inspection found:

- `apps/web/lib/autosave.ts:235-300` makes `onSave` optional. Its wrapper publishes `window.__lashLastSave` before invoking the optional callback, so a missing or failing persistence callback can still look successful to tests.
- `apps/web/components/editor/panels/AutosaveIndicator.tsx:22-29` accepts only an editor and calls `useAutosave(editor)` without a persistence callback.
- `apps/web/components/shell/TopBar.tsx:80-86` always renders that indicator.
- `apps/web/components/editor/EditorWorkspace.tsx:557-616` creates the extension set and editor without local body content or a local hydration state.
- `apps/web/components/editor/EditorWorkspace.tsx:418-435` creates a distinct realtime Y.Doc/provider and exposes an explicit `realtimeCollaboration.enabled` boundary.
- `apps/web/lib/documentRegistry.ts:28-31, 58-83, 113-141` already normalizes per-document metadata keys, sorts by `updatedAt`, and can bump a registry record through `upsertDocument`.
- `apps/web/lib/realtimeCollaboration.ts:74-95, 517-535` makes realtime an explicit opt-in and returns `{ doc, enabled, provider }`; server durability is already owned by Yjs/Durable Objects.
- `apps/web/e2e/autosave/autosave-indicator.spec.ts:29-66` proves only that a snapshot reached a window hook, not that body content reached durable storage.
- `FEATURE_AUDIT/STORIES.csv` rows F-C19-01 through F-C19-07 mark autosave mechanics as passing, but none proves local body reload. Rows F-C01-02 through F-C01-05 and F-C25-01 through F-C25-06 prove route, title, and registry behavior only. F-C21-08 correctly covers the separate realtime persistence path.
- The existing stranger artifact `artifacts/stranger-test/baseline/desktop-reload-body-lost.png` is direct browser-visible evidence of the defect.

The current tracker language therefore overstates local autosave durability. A later designated ledger/tracker writer should correct that claim; this reviewer does not own those files.

## Designs considered

### Design A — Versioned localStorage primary plus last-good backup

**Decision: selected for Bead 38.**

Store one versioned envelope per normalized document id at:

- Primary: `lash:body:<normalized-id>`
- Backup: `lash:body-backup:<normalized-id>`

Advantages:

- Smallest change to the existing local-first browser architecture.
- Synchronous writes allow a best-effort pending-save flush during page hide or route teardown.
- Easy per-document isolation and rollback; older builds ignore the new keys.
- No ambiguity with realtime when the path is disabled under `realtimeCollaboration.enabled`.

Costs and limits:

- localStorage is synchronous, quota-limited, and has no transaction spanning two keys.
- It cannot merge concurrent local-tab edits.
- Large bodies require bounded parsing/validation and browser performance proof.

This is acceptable only with the conflict and failure rules below. It is a rapid-product bridge, not the final storage architecture for arbitrarily large documents.

### Design B — IndexedDB transactional snapshot store

**Decision: defer; preferred follow-up if local document size or multi-tab use grows.**

Use an object store keyed by document id, with primary, backup, revision, and schema version updated in one read-write transaction.

Advantages:

- Atomic multi-record update and compare-before-write behavior.
- Larger practical capacity and asynchronous I/O.
- Better foundation for revisions, multiple recovery points, and large documents.

Costs:

- More lifecycle, migration, test, and browser failure surface for a rapid bead.
- Page-unload completion is less deterministic.
- Requires a new database adapter and upgrade policy rather than using established metadata patterns.

Choose this when the local body regularly approaches the localStorage budget, when more than one recovery generation is required, or when concurrent local-tab editing becomes a supported workflow.

### Design C — Persist every local document as Yjs, for example through IndexedDB

**Decision: reject for this bead.**

This would unify local and realtime document representation and could later enable offline CRDT sync.

Advantages:

- One operation model for local, offline, and realtime collaboration.
- Natural convergence and incremental persistence.

Costs:

- Introduces a second Yjs persistence authority beside the Durable Object path.
- Requires migration from plain TipTap JSON, provider lifecycle changes, and explicit authority rules when realtime is toggled.
- Expands a body-reload repair into collaboration protocol work.

The current architecture deliberately treats local JSON and realtime Yjs as separate modes. Do not blur that boundary in a rapid persistence fix.

### Design D — Single unversioned localStorage key

**Decision: reject.**

It is smaller but provides no schema evolution, no last-good recovery, and no defense against corrupt or partially incompatible state. It cannot satisfy the stated trust objective.

## Required storage contract

Create a focused app-level module, recommended as:

`apps/web/lib/localDocumentBodyPersistence.ts`

The module owns keys, envelope parsing, validation orchestration, rotation, promotion, typed errors, and optimistic revision checks. It must not own React state or Yjs.

### Envelope

Version 1 must contain only reconstructed, typed fields:

- `version: 1` — storage envelope version.
- `schemaVersion: "lash-schema-v1"` — content schema identity.
- `documentId` — normalized id and exact match for the requested document.
- `revision` — non-negative integer incremented per accepted primary write.
- `writeId` — unique id for diagnostics and read-back verification.
- `savedAt` — valid ISO timestamp.
- `doc` — TipTap document JSON.

Unknown envelope versions or schema versions must fail closed. Preserve their raw strings; never silently coerce, delete, or overwrite them. Future schema changes add explicit migrations before hydration.

### Validation

Validation is two-stage:

1. Structural validation before touching the editor:
   - Envelope is a non-array object of supported version.
   - Id, revision, write id, and timestamp have valid bounded types.
   - `doc` is a non-array object with `type === "doc"` and array content.
   - Raw payload, node count, depth, and string lengths are bounded to prevent pathological parsing/rendering.
2. Current schema validation:
   - Build the candidate with the active editor schema using `editor.schema.nodeFromJSON(candidate)`.
   - Call the ProseMirror node integrity check before `setContent`.
   - Reject unknown nodes, marks, invalid content expressions, and invalid required attributes; do not rely on TipTap silently dropping unsupported content.

Schema validity alone is not security validation. Traverse URL-bearing attributes and enforce safe schemes and bounded strings for links, chips, chip icons, image sources, and previews. At minimum reject `javascript:`, executable `data:` payloads, and unexpected protocols. Reconstruct values field by field; do not merge arbitrary parsed objects into configuration, DOM attributes, or prototypes. Persisted strings must never reach `innerHTML`, `eval`, or script-bearing DOM paths.

### Read and recovery

Read order:

1. Read and validate primary.
2. If primary is missing, malformed, unsupported, or schema-invalid, validate backup.
3. If primary is valid, hydrate it and retain its revision as the expected revision.
4. If only backup is valid, hydrate it automatically but enter `recovered-awaiting-confirmation`.
5. If both copies are invalid, preserve both strings, do not enable local autosave, and show a visible fail-closed recovery error.
6. If storage access itself throws, allow the user to keep editing/exporting but show that local persistence is unavailable and never show “All changes saved.”

Fallback must not mutate either key. In particular, opening a recovered backup must not automatically overwrite the malformed primary.

### Deliberate recovery action

When backup content is hydrated:

- Show a visible, keyboard-accessible notice explaining that the primary copy could not be opened and the last good copy is being displayed.
- Keep the editor read-only and local autosave disabled until the user chooses **Keep recovered copy**. This prevents the first keystroke from implicitly promoting recovery and making the deliberate action meaningless.
- The action validates the currently displayed recovered document again, writes it as the new primary, leaves the valid backup intact, bumps the registry, then enables editing/autosave.
- Never rotate the malformed primary into the backup.

If product wants editable recovery before confirmation later, it needs a separate recovery-draft key. That is outside this rapid bead.

### Save and rotation

For a normal local save:

1. Validate the outgoing snapshot.
2. Re-read the primary and compare its revision/write id with the revision loaded by this tab.
3. If a different valid revision exists, throw a typed cross-tab conflict; do not write either key.
4. If an existing primary is valid, write that exact validated envelope to the backup first.
5. If the backup write fails, abort before touching primary.
6. Write the new envelope to primary with the next revision and a fresh write id.
7. Read primary back and verify the write id.
8. Call the existing `upsertDocument` with the active id/title to bump `updatedAt`, then refresh the same-tab registry view.
9. Update the tab’s expected revision only after successful verification.

Each localStorage `setItem` is atomic for its own key, not across both keys. The required ordering guarantees that a failed primary write leaves the old primary plus a valid backup, and a failed backup write leaves the primary untouched. A malformed current primary must never replace a valid backup.

All body-write, rotation, read-back, conflict, quota, and unavailable-storage failures must throw to the autosave scheduler. Secondary registry failure may conservatively report save failure; body writes are idempotent and a retry can repair registry recency. False “saved” is worse than a conservative error.

## React and autosave lifecycle

Use an explicit state machine in `EditorWorkspace`, not effect-order assumptions:

- `loading`
- `ready`
- `recovered-awaiting-confirmation`
- `conflict`
- `unavailable`
- `failed`

Required sequence for local mode:

1. Create the editor with local autosave disabled.
2. In a layout-phase hydration step, read and validate primary/backup with the actual editor schema.
3. Apply valid content once with update emission disabled.
4. Set the hydration state.
5. Only when state is `ready` may the TopBar mount/enable `AutosaveIndicator` with a required real save callback.

The loading and recovery gates must also prevent history, outline, or test consumers from treating the temporary empty editor as the loaded document. The UI should keep the existing “Preparing your editor…” boundary until local hydration is complete.

Do not depend on parent/child passive-effect ordering. A later refactor must not be able to subscribe autosave before hydration.

### Pending work on teardown

The current scheduler cleanup cancels a pending debounce. Once the callback is real persistence, cancellation can lose a user’s last sub-500 ms edit on reload or document navigation.

Required behavior:

- On `pagehide` and when the autosave subscription/workspace is torn down, synchronously initiate a flush when scheduler status is pending.
- Do not create a save when the editor was never dirty.
- The local callback must perform its localStorage write synchronously before returning, even though the scheduler accepts a Promise.
- If a safe flush cannot complete, preserve the unsaved/error signal rather than marking saved.

Add a fail-first browser test that types and immediately reloads or switches documents without waiting for the normal debounce.

### Truthful indicator and test hook

- Make the save callback required by `AutosaveIndicator`; do not allow the component to render a saved state with no persistence owner.
- `TopBar` should receive an optional local-autosave configuration. If absent, it renders no local autosave indicator.
- In `useAutosave`, await the real callback first. Publish `window.__lashLastSave` only after success.
- A rejected callback must leave the last successful timestamp/hook unchanged and transition to `Save failed`.

## Cross-tab policy

Local tabs do not merge. The safe rapid policy is detect, stop, and explain:

- Envelope revision/write id is the optimistic concurrency token.
- Listen for storage events on the active body primary key.
- When another tab writes a different revision, pause local autosave and show a visible “This document changed in another tab” notice.
- Never auto-apply remote localStorage content into an active editor; that would destroy selection and unsaved text.
- A subsequent save with a stale expected revision must throw rather than overwrite.
- Offer reload/open-newer-copy as the safe action. An explicit force-overwrite action is out of scope.

There remains a narrow simultaneous read-before-write race because localStorage has no compare-and-swap transaction. This bead may proceed only if the UI/tested contract is **single active local editor with fail-loud conflict detection**, not collaborative multi-tab editing. If exact concurrent-tab preservation becomes a requirement, move to the IndexedDB transactional design rather than adding an ad hoc lock protocol.

## Realtime isolation

When `realtimeCollaboration.enabled` is true:

- Do not read either local body key.
- Do not hydrate local JSON.
- Do not mount or enable local body autosave.
- Do not write primary, backup, registry `updatedAt` from body transactions, or local recovery state.
- Continue to use the existing realtime sync state and Yjs/Durable Object hydration as the only body truth.

Titles and existing local invite/metadata bridges are separate concerns and may continue as currently designed. No changes are required in `apps/web/lib/realtimeCollaboration.ts` or the Durable Object persistence protocol.

This isolation must be tested with a seeded local-body sentinel that remains unread and unchanged while realtime mode edits and reloads through Yjs.

## Quota, private browsing, and large documents

- Catch and classify `QuotaExceededError`, `SecurityError`, unavailable storage, parse failure, schema failure, and cross-tab conflict separately.
- Never clear all localStorage or delete the last-good backup as error recovery.
- On quota/private-mode failure, keep the editor usable so the user can copy/export, show a persistent warning, and keep the autosave status at error.
- Do not promise browser-restart durability in private browsing; the UI can only report successful writes in the current storage context.
- Keep JSON snapshot, stringify, rotation, and validation work inside the debounced save, never per transaction/keystroke.
- Validate backup only when primary fails on read. On save, validation of the current primary is required before rotation.
- Establish a documented maximum raw envelope size. Reject oversize payloads visibly before attempting repeated quota-failing writes.
- Browser-measure 100 KB and existing 50k-word fixtures. Required proof: typing p95 remains within the existing gate, no long task is added during typing, save completes visibly within the accepted autosave browser budget, and reload stays within cold-open expectations.

localStorage should be replaced with IndexedDB if measured serialization/validation materially violates these budgets or realistic documents approach the storage cap.

## Smallest safe ownership and exact target files

### Production files

1. **Create** `apps/web/lib/localDocumentBodyPersistence.ts`
   - Keys, envelope, typed errors, structural/safety validation, read/fallback, revision check, rotation, promotion.
2. **Modify** `apps/web/components/editor/EditorWorkspace.tsx`
   - Mode selection, hydration state machine, schema validation callback, save callback, storage listener, registry bump, recovery/conflict orchestration.
3. **Create** `apps/web/components/editor/panels/LocalBodyRecoveryNotice.tsx`
   - Accessible recovery/conflict/unavailable notice and deliberate actions only.
4. **Modify** `apps/web/components/editor/panels/AutosaveIndicator.tsx`
   - Require a real callback; no phantom persistence.
5. **Modify** `apps/web/components/shell/TopBar.tsx`
   - Accept optional local-autosave configuration; omit it in realtime/non-ready states.
6. **Modify** `apps/web/lib/autosave.ts`
   - Publish hooks after success and flush pending local work on safe lifecycle boundaries without saving a never-dirty editor.
7. **Modify only if styling is needed** `apps/web/app/globals.css`
   - Calm, accessible notice/error styling.

Use existing `normalizeDocumentId`, `upsertDocument`, and realtime `.enabled`; do not move body storage into `documentRegistry.ts`, do not modify `realtimeCollaboration.ts`, and do not touch worker/storage protocol files.

### Test files

1. **Create** `packages/testing/unit/autosave/local-document-body-persistence.test.ts`
2. **Modify** `packages/testing/unit/autosave/autosave-latency.test.ts`
3. **Create** `apps/web/e2e/autosave/local-body-persistence.spec.ts`
4. **Modify** `apps/web/e2e/autosave/autosave-indicator.spec.ts`
5. **Modify as needed for key cleanup/isolation** `apps/web/e2e/document-identity/document-identity.spec.ts`
6. **Add the realtime sentinel assertion** to `apps/web/e2e/online-typing/online-typing-entry-gate.spec.ts` or an equivalently worker-backed focused spec.

No unrelated editor-core, history, share, or worker refactor is approved.

## Fail-first test gates

### Unit gates

Write these before implementation and confirm they fail for the intended reason:

1. Valid v1 primary round-trips under a normalized id and schema validator.
2. Malformed JSON primary plus valid backup returns backup with recovery required and mutates neither key.
3. Structurally valid but schema-invalid primary falls back to a valid backup.
4. Unsupported version/schema fails closed and preserves raw data.
5. Wrong-document envelope is rejected.
6. Valid primary rotates to backup before the next primary.
7. Backup write failure leaves primary untouched and throws.
8. Primary write failure leaves old primary and valid backup and throws.
9. Malformed current primary never replaces a valid backup.
10. Recovery promotion writes the recovered copy without backing up malformed primary.
11. Quota and security exceptions become typed failures.
12. Stale expected revision throws a cross-tab conflict and writes nothing.
13. Unsafe URL-bearing JSON is rejected; plain text remains inert.
14. Autosave callback rejection yields `error`, preserves the last successful save time, and does not publish a success hook.
15. Pending cleanup/page-hide flushes once; idle cleanup writes nothing.

### Browser gates

1. Local document body survives normal reload and browser-context restart.
2. Two document ids keep bodies isolated; switching away and back restores the correct body.
3. Typing then immediately reloading or switching routes does not lose the final edit.
4. Corrupt primary plus valid backup:
   - backup content is visible;
   - recovery notice is visible and announced;
   - editor/local autosave remain gated;
   - primary/backup remain unchanged before confirmation;
   - **Keep recovered copy** promotes safely;
   - subsequent edit, save, and reload succeed.
5. Corrupt primary and backup fail closed without overwriting either key or claiming saved.
6. Forced quota/storage failure shows `Save failed`, keeps the previous last-good data, and leaves export/copy usable.
7. A second tab’s body write produces a conflict notice; the stale tab cannot overwrite it.
8. Seeded executable/unsafe attributes neither execute nor hydrate; valid backup recovery is used.
9. Realtime mode ignores and does not modify seeded local primary/backup keys while the existing Yjs reload-durability test still passes.
10. Registry `updatedAt` increases after a successful body save and the document switcher refreshes.
11. Existing IME tests still prove one final composed snapshot.
12. Existing title, outline, history, suggestion, autosave, document identity, online typing, large-document, and accessibility tests remain green.

### High-risk validation

Before merge:

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test:unit`
- Targeted Playwright local-body, autosave, identity, IME, online-typing, and large-document specs
- Full required Playwright CI suite
- `pnpm run build`
- Independent Analyst review covering completeness, quality, consistency, tests, and security
- Protected PR `build-and-test` green

No skip, todo, xfail, test-hook-only assertion, or manual localStorage inspection substitutes for reload proof.

## Browser-visible proof

The implementing owner should retain:

- Existing before evidence: `artifacts/stranger-test/baseline/desktop-writing-before-reload.png` and `desktop-reload-body-lost.png`.
- After reload with restored body.
- Corrupt-primary recovery notice with recovered content visible.
- Quota failure showing `Save failed` while the prior good copy remains.
- Realtime mode showing its Yjs sync state with the local autosave indicator absent.

Recommended receipt:

`artifacts/stranger-test/bead-38/local-body-persistence-proof.md`

The receipt must include exact route/id, primary and backup revision facts without exposing document content unnecessarily, commands/results, screenshot paths, accessibility notes, and the rollback result.

## Rollback

Code rollback is low operational risk:

- Old builds ignore the namespaced body keys.
- Do not delete or migrate keys during rollback.
- Keep primary and backup for a later fixed build or manual export.
- Realtime Yjs/Durable Object state is untouched.
- If implementation fails after deployment, revert the product commit and redeploy; no server/schema rollback is needed.

Do not ship cleanup code that removes unknown/corrupt envelopes. Destructive recovery requires separate owner approval.

## Review checklist

| Dimension        | Result                       | Notes                                                                                                                                   |
| ---------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Completeness     | **Approved with conditions** | Candidate covers the core store, but lifecycle flush, dual-corruption, and deliberate recovery gating are mandatory additions.          |
| Quality          | **Approved**                 | A focused app-level adapter plus a small notice component is the smallest maintainable ownership split.                                 |
| Consistency      | **Approved**                 | Matches existing per-doc normalization/registry patterns and preserves Yjs as the sole realtime body authority.                         |
| Test sufficiency | **Blocked until gates pass** | Current autosave test proves only a window hook; reload, corruption, quota, cross-tab, and realtime-negative proofs are required.       |
| Security         | **Approved with conditions** | Schema checking is necessary but insufficient; unsafe URL attributes, pathological JSON, and prototype/config merging must fail closed. |

## Final sign-off

**APPROVE implementation to proceed** with Design A and every mandatory amendment in this report.

**Do not merge** if any of the following remains true:

- hydration can trigger autosave;
- recovered content can be silently promoted by typing;
- pending teardown cancels the last edit;
- another tab can be knowingly overwritten without conflict;
- storage failure can still show “All changes saved”;
- unsafe schema-valid attributes can hydrate;
- realtime mode reads or writes local body keys;
- reload, recovery, quota, cross-tab, realtime isolation, and high-risk CI gates are not green.
