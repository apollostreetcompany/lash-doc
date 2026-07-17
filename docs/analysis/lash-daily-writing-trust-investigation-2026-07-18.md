# Investigation: Lash Daily-Writing Trust

Date: 2026-07-18
Workstream: research/analysis
Investigation risk: Low
Verified commit: `002333017fe2bca4ec589f8d157c1aa21a4b77da`
Branch: `codex/ux/bead-38-stranger-45-sprint`

## Summary

The highest-value stranger trust gap is confirmed and is more severe than “reload confidence is not good enough”: local-only Lash documents do not persist their body at all, while the UI reports **“All changes saved.”** The autosave hook captures TipTap JSON and publishes it only to a test hook unless a caller supplies `onSave`; the production `AutosaveIndicator` supplies no callback. Reloading, switching documents, or closing the page therefore discards a local document body even after the saved confirmation.

Realtime documents follow a separate, materially stronger path. When realtime is explicitly enabled, TipTap binds to a Y.Doc; accepted updates are appended to Durable Object SQLite before `sync-ack`, and new sockets hydrate from the latest snapshot plus tail updates. The realtime path must remain the sole body authority for those documents.

Recommended rapid product bead: **WT-01 — Trustworthy Local Save + Last-Good Recovery**. Persist versioned, per-document TipTap JSON only for local-only documents; hydrate it before ordinary editing; maintain a last-known-good backup; make the existing save indicator succeed only after a real storage write; flush on document navigation/page lifecycle; and show a quiet recovery notice when fallback data is used. This is a Medium-risk client persistence bead with no public API, canonical editor schema, server schema, or deployment change.

## Stranger-Value Decision

This gap is a 4.5/5 hard fail, not a papercut:

- A stranger can type ordinary prose, see “All changes saved,” reload, and find an empty document.
- The title and document entry survive, increasing the impression that the body should also be safe.
- History appears useful in-session but is also memory-only, so it cannot recover the missing body after reload.
- On mobile the saved text is reduced to an unlabeled visual dot, making the false assurance harder to inspect.

Fixing this converts the most damaging experience—silent loss after explicit reassurance—into boring, visible reliability. It should precede recents polish, broader mobile delight, or a richer export affordance.

## Scope and Method

The investigation traced:

- route entry, document creation/opening, registry and title metadata;
- editor construction and local/realtime body initialization;
- autosave, IME gating, cleanup, history recording, restore, and reload;
- localStorage and sessionStorage authorities;
- Yjs provider, Worker acknowledgement, Durable Object append/snapshot/hydration;
- Markdown import/export and browser controls;
- desktop and narrow/mobile navigation/save state;
- relevant unit/e2e coverage and git provenance.

All code citations below were verified at `002333017fe2bca4ec589f8d157c1aa21a4b77da`.

## End-to-End Data-Flow Map

| Stage                 | Local-only document                                                                                                                                                                                                                                                                                                         | Realtime document                                                                                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route                 | `/` mounts `demo-document`; `/doc/[id]` normalizes the id and keys `EditorWorkspace` by it, forcing a fresh workspace/editor per document (`apps/web/app/page.tsx:1-20`; `apps/web/app/doc/[id]/page.tsx:1-28`).                                                                                                            | Same route and remount boundary.                                                                                                                                                                                                                                                                                                      |
| Identity and recents  | Title is read from `lash:title:<id>` and the metadata row is upserted in `lash:documents` (`apps/web/components/editor/EditorWorkspace.tsx:505-516`; `apps/web/lib/documentRegistry.ts:1-3,27-30,57-83,85-137`).                                                                                                            | Same browser-local metadata path; the server does not own title/recents here.                                                                                                                                                                                                                                                         |
| Creation/opening      | New creates a registry row, then pushes `/doc/<generated-id>`; opening selects an existing route (`apps/web/components/editor/EditorWorkspace.tsx:1384-1419`).                                                                                                                                                              | Same controls. Realtime status depends separately on environment/query/local override.                                                                                                                                                                                                                                                |
| Realtime decision     | Default is disabled unless a public realtime URL is configured or localhost opts in via query/localStorage (`apps/web/lib/realtimeCollaboration.ts:78-100`).                                                                                                                                                                | When enabled, `createLashRealtimeCollaboration` creates a Y.Doc/provider (`apps/web/lib/realtimeCollaboration.ts:520-534`).                                                                                                                                                                                                           |
| Editor initialization | Collaboration extension is omitted and `useEditor` receives no `content`, loader, or local snapshot (`apps/web/components/editor/EditorWorkspace.tsx:578-616`). TipTap starts empty.                                                                                                                                        | Collaboration extension receives the room Y.Doc and `content` field (`apps/web/components/editor/EditorWorkspace.tsx:589-594`).                                                                                                                                                                                                       |
| Editing               | TipTap transactions update only the in-memory editor. Outline state, chat, and suggestion resolutions have separate persistence, but no body writer exists (`apps/web/components/editor/EditorWorkspace.tsx:394-499,557-562`; `apps/web/components/editor/panels/ChatPanel.tsx:206-220`).                                   | Local Y.Doc updates are sent or queued by the provider (`apps/web/lib/realtimeCollaboration.ts:347-356,399-434`).                                                                                                                                                                                                                     |
| “Autosave”            | `AutosaveIndicator` calls `useAutosave(editor)` with no `onSave` (`apps/web/components/editor/panels/AutosaveIndicator.tsx:21-29`). The hook publishes `window.__lashLastSave`, invokes a callback only if one exists, then reports success (`apps/web/lib/autosave.ts:242-251`).                                           | The same no-op autosave indicator remains in the top bar (`apps/web/components/shell/TopBar.tsx:76-86`), while a separate realtime state reports actual queue/ack state (`apps/web/components/editor/EditorWorkspace.tsx:1463-1500`).                                                                                                 |
| Navigation/close      | Autosave cleanup cancels the pending timer and does not flush (`apps/web/lib/autosave.ts:272-280`). The history debounce is also cleared on editor cleanup (`apps/web/components/editor/EditorWorkspace.tsx:816-824`). The fresh keyed workspace opens empty.                                                               | Provider queues while disconnected and reconnects, but provider destruction clears its in-memory queue (`apps/web/lib/realtimeCollaboration.ts:290-300`). Successfully acknowledged edits are already durable.                                                                                                                        |
| Durable write         | None for body.                                                                                                                                                                                                                                                                                                              | Durable Object validates edit scope, appends update, then sends `sync-ack` and broadcasts (`packages/realtime-worker/src/room.ts:348-401,529-554`).                                                                                                                                                                                   |
| Reload hydration      | No reader exists; title/registry survive but body does not.                                                                                                                                                                                                                                                                 | Socket accept sends room-ready then snapshot/tail hydration updates (`packages/realtime-worker/src/room.ts:421-456,506-511`; `packages/realtime-worker/src/persistence.ts:24-37`).                                                                                                                                                    |
| History/recovery      | `createHistoryStore()` uses process-memory Maps, and `EditorWorkspace` creates it in a ref (`packages/history/src/index.ts:150-172`; `apps/web/components/editor/EditorWorkspace.tsx:374-379`). Entries are reset and reseeded from the current editor on mount (`apps/web/components/editor/EditorWorkspace.tsx:741-825`). | Same UI history store is session-memory only. In-session restore mutates TipTap/Yjs and can become a new durable update, but historical entries are unavailable after reload. The Worker restore endpoint exists but has no web caller (`packages/realtime-worker/src/room.ts:288-290,569-603`; repository search found no app call). |
| Import/export         | Import parses a `.md` file and replaces editor content; export serializes the current JSON and downloads `document.md` (`apps/web/components/editor/EditorWorkspace.tsx:1256-1300`).                                                                                                                                        | Same UI; imported content becomes Yjs edits if realtime is enabled.                                                                                                                                                                                                                                                                   |
| Mobile/narrow         | Document switcher remains visible at 82–104 px; toolbar scrolls and import/export trail it. Save copy is visually reduced to an 8 px dot (`apps/web/app/globals.css:3147-3300`; toolbar overflow at `apps/web/app/globals.css:756-797`).                                                                                    | Realtime state remains in document metadata/presence, but top-bar no-op autosave dot is still present.                                                                                                                                                                                                                                |

## Storage Authority Inventory

| Key / store                                  | Data                              | Authority and failure behavior                                                                                                                                                        |
| -------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lash:documents`                             | Browser-local document registry   | Parses malformed JSON to `[]`; always reinserts demo; sorts demo first and others by `updatedAt` (`apps/web/lib/documentRegistry.ts:31-83`). Body edits do not update this timestamp. |
| `lash:title:<id>`                            | Document title                    | Read/write is guarded; failures silently fall back or are ignored (`apps/web/lib/documentRegistry.ts:85-112`).                                                                        |
| `lash-outline:<id>`                          | Collapse intent                   | Browser-local outline preference, not content (`apps/web/components/editor/EditorWorkspace.tsx:557-562`).                                                                             |
| `lash:chat:<docId>`                          | Local chat threads                | Best-effort local durability; realtime mirrors threads into Yjs (`apps/web/components/editor/panels/ChatPanel.tsx:206-220`).                                                          |
| `lash:suggestion-resolutions:<docId>`        | Accept/reject records             | Best-effort localStorage and optional Y.Map mirror (`apps/web/components/editor/EditorWorkspace.tsx:246-270,438-499`).                                                                |
| `lash:realtime-enabled`, `lash:realtime-url` | Local opt-in/test runtime routing | Controls whether Yjs is an authority (`apps/web/lib/realtimeCollaboration.ts:84-100`).                                                                                                |
| `lash:actor-id`                              | Browser actor label/id            | Best-effort local identity (`apps/web/lib/realtimeCollaboration.ts:112-126`).                                                                                                         |
| `lash:invite-token:<id>` in sessionStorage   | Current invite token              | Per-tab/session authorization bridge, not document durability (`apps/web/lib/realtimeCollaboration.ts:130-148`).                                                                      |
| `createHistoryStore()` Maps                  | Entries, snapshots, heads         | Memory only; disappears on workspace remount/reload (`packages/history/src/index.ts:150-172`).                                                                                        |
| Durable Object SQLite                        | Yjs updates/snapshots             | Realtime-only append log and compaction (`packages/realtime-worker/src/room.ts:213-242,529-567`).                                                                                     |
| Local body key                               | **Absent**                        | Repository-wide localStorage search found no body/content document writer or reader.                                                                                                  |

## Confirmed Trust Failures

### P0 — False saved state plus total local body loss

`useAutosave` treats the optional `onSave` as optional and marks a flush saved after publishing a test-only window snapshot. Production passes no callback. The browser test validates `window.__lashLastSave`, not a durable read after reload (`apps/web/e2e/autosave/autosave-indicator.spec.ts:9-12,33-68`). This is a test-contract hole: it proves capture, not persistence.

### P0 — Switching or reloading destroys the only body authority

The routed page keys `EditorWorkspace` by document id, while local `useEditor` has no initial content. Switching routes destroys the in-memory editor and pending timers; returning creates an empty editor. The document-identity suite proves title isolation, stable route, switcher navigation, and outline scoping, but never asserts body survival (`apps/web/e2e/document-identity/document-identity.spec.ts:58-138`).

### P1 — History cannot recover a reload

The history store is memory-only and text-backed. It neither persists entries nor preserves complete TipTap JSON formatting/media/table structure. The 1,800 ms history timer is canceled on cleanup, so even its text version may never be appended before a quick navigation (`apps/web/components/editor/EditorWorkspace.tsx:776-825`; `packages/history/src/index.ts:97-134,150-172`).

### P1 — Recents preserve a label that can reopen an empty document

Registry and title persistence work, which is useful, but body activity never updates the record. “All documents” remains an explicitly disabled coming-soon sidebar item; the only actual return path is the compact top-bar select (`apps/web/components/shell/Sidebar.tsx:31-52,103-130`; `apps/web/components/editor/EditorWorkspace.tsx:1384-1439`). This compounds the loss: the idea remains findable by name but not by content.

### P1 — Save semantics are split and visually conflicting online

Realtime has an honest queue/ack state: it is `syncing` while queued/pending ids exist and `saved` after acknowledgement (`apps/web/lib/realtimeCollaboration.ts:478-485`). The top bar simultaneously runs the no-op local autosave indicator for every editor. The realtime presence UI therefore does not remove the misleading generic save signal.

### P2 — Escape hatch exists, but discovery and recovery are incomplete

Markdown import/export is real and browser-backed, so the hypothesis that no escape hatch exists is rejected. However:

- controls are icon-only (accessible labels and hover tooltips exist);
- import replaces the current document without confirmation;
- export is manual rather than a recovery path;
- no test exports, reloads, imports, and verifies the restored document;
- focus mode hides the toolbar and thus the escape hatch.

### P2 — Mobile is layout-hardened but not trust-tested

Current CSS keeps the switcher and 44 px controls in bounds, and the mobile e2e proves typing/share/chat without clipping (`apps/web/e2e/mobile/mobile-editor.spec.ts:14-57`). It does not test save, reload, return through recents, import/export, or recovery. The saved label becoming an 8 px dot is especially weak when save semantics are already false (`apps/web/app/globals.css:3273-3283`).

## Hypotheses: Confirmed and Eliminated

1. **Confirmed:** local-only body content is not persisted per id, while title and registry are.
2. **Eliminated:** current history is sufficient recovery. It is memory-only, cleanup drops pending recording, and its model is text-backed rather than full TipTap JSON.
3. **Eliminated:** realtime persistence covers all documents. Realtime is explicitly opt-in/configured; the default path is disabled/local.
4. **Partially eliminated:** saved/sync state is accurate. Realtime queue/ack state is accurate; generic autosave is not.
5. **Eliminated:** Markdown export/import is absent. It exists and round-trips a representative fixture, but is not a substitute for automatic recovery.
6. **Partially confirmed:** recents/mobile compound the gap. They are functional enough for navigation and layout, but do not preserve or prove the words and make save state less legible.
7. **Eliminated:** the routed editor might implicitly seed content from history or the registry. Neither data structure carries TipTap body JSON, and `useEditor` has no `content` input.
8. **Eliminated:** the Worker is the weak durability link for enabled realtime docs. Its append-before-ack and hydration path is implemented and covered by realtime tests; production deployment/session availability is a separate milestone gate.

## Compared Implementation Approaches

### Approach A — Wire the existing callback directly to one localStorage key

Implementation: pass `onSave` to `AutosaveIndicator`, write `editor.getJSON()` to `lash:body:<id>`, and pass parsed JSON as initial content.

Advantages:

- smallest diff;
- reuses the existing debounce/status machinery;
- immediately makes common reload pass.

Tradeoffs and rejection:

- one corrupt/truncated value has no fallback;
- current cleanup cancels a pending save, so fast navigation still loses work;
- quota/private-mode errors need durable error semantics;
- a careless implementation can double-write realtime documents;
- it makes the indicator more honest but does not meet the milestone’s recovery requirement.

### Approach B — Versioned local snapshot with last-good fallback and truthful status

Implementation: local-only primary + previous-good snapshot envelopes, deterministic validation, initial hydration, real save callback, page/navigation flush, recovery notice, and realtime exclusion.

Advantages:

- directly closes the stranger hard fail;
- full TipTap JSON preserves headings, lists, mentions, tables, and other supported nodes;
- previous-good fallback handles a malformed newest record;
- existing autosave/error UI can represent actual write success/failure;
- scoped entirely to browser-local documents and current routes.

Tradeoffs:

- introduces a private versioned serialization contract;
- localStorage quota remains finite, especially for data-URL images;
- simultaneous editing of one local document in two tabs remains last-writer-wins unless a later conflict layer is added;
- lifecycle flush and hydration ordering require focused regression tests.

Decision: **recommended**. It is the smallest approach that reaches “really good” trust rather than merely making the happy path appear fixed.

### Approach C — Give every local document a Y.Doc plus IndexedDB persistence

Implementation: run local documents through Yjs and a browser persistence provider, then attach the network provider when online.

Advantages:

- one CRDT-shaped body model;
- stronger cross-tab/offline foundation;
- avoids large JSON rewrites for every save.

Tradeoffs and deferral:

- new dependency and storage authority;
- migration and duplication risks with current plain-TipTap local documents;
- harder corruption/recovery UX;
- substantially larger test matrix across local/realtime transitions;
- changes local editor architecture, exceeding the rapid bounded bead.

### Approach D — Persist and replay the existing history store

Implementation: serialize history entries/snapshots and reconstruct the head on reload.

Advantages:

- aligns superficially with append-only history and future recovery.

Tradeoffs and rejection:

- current web history records text replacement operations, not complete editor JSON;
- formatting, tables, images, mentions, and node attributes would not reliably round-trip;
- the 1,800 ms debounce and cleanup cancellation still lose quick edits;
- persistence/migration of history is a larger product contract than a local snapshot.

## Recommended Product Bead

### WT-01 — Trustworthy Local Save + Last-Good Recovery

Workstream: code/design
Risk: **Medium**
Primary agent: Editor Core / Autosave Engineer
Reviewer: Product QA with data-integrity checklist
Selection confidence: High
Fallback agent: Collab & History Engineer

Risk rationale: this changes multiple client files and the user-data durability boundary, but does not change a public API, canonical editor schema, server/database schema, authorization model, or deploy/runtime architecture. The storage envelope is a private, versioned browser serialization detail. If project governance treats any persisted encoding as a schema hard guardrail, escalate it to High and require Architect review before implementation.

### Acceptance

1. A local-only document’s full TipTap JSON survives reload and browser-context restart under its normalized document id.
2. Two local documents retain distinct bodies and titles when switching through the existing selector.
3. A navigation or page close during the 500 ms debounce window flushes the latest body synchronously.
4. “All changes saved” renders only after the storage write succeeds; quota/write failure renders “Save failed.”
5. A malformed primary snapshot never destroys the previous valid snapshot. Lash loads the last-good copy and visibly says it recovered an earlier save.
6. If no valid snapshot exists, Lash opens safely, preserves corrupt raw records, shows a recovery/error notice, and leaves Markdown import/export available.
7. Realtime-enabled documents never read or write the local body keys; their Yjs/Worker sync indicator remains authoritative.
8. A body save updates document `updatedAt`, so non-demo recents reflect writing activity.
9. Normal typing still meets the existing p95 `< 8 ms` event-work gate.
10. The 375 px flow can create, write, save, reload, reopen, and see recovery state without clipping.

### Exact owned implementation paths

- New: `apps/web/lib/localDocumentPersistence.ts`
  - normalized primary/last-good keys;
  - versioned envelope;
  - parse/validate/load/save results;
  - no silent catch on writes;
  - never delete corrupt input during load.
- Modify: `apps/web/components/editor/EditorWorkspace.tsx`
  - load local snapshot for the active id;
  - hydrate local-only editor before normal autosave/history recording;
  - pass a real local save callback;
  - update registry activity after successful body save;
  - render compact recovery/error notice;
  - skip all local body persistence when realtime is enabled.
- Modify: `apps/web/lib/autosave.ts`
  - flush pending local save on component cleanup/page lifecycle without overlapping writes;
  - retain IME composition gate;
  - ensure failed callback cannot transition to saved.
- Modify: `apps/web/components/editor/panels/AutosaveIndicator.tsx`
  - accept the required persistence callback/enabled state rather than succeeding as a no-op.
- Modify: `apps/web/components/shell/TopBar.tsx`
  - receive local autosave configuration or a save-status node;
  - omit the local autosave indicator when realtime is authoritative.
- Modify: `apps/web/app/globals.css`
  - quiet, accessible recovery/error notice at desktop and 375 px.

### Exact owned test paths

- New: `packages/testing/unit/autosave/local-document-persistence.test.ts`
- New: `apps/web/e2e/document-persistence/local-document-persistence.spec.ts`
- Modify: `apps/web/e2e/autosave/autosave-indicator.spec.ts`
- Regression-only:
  - `apps/web/e2e/document-identity/document-identity.spec.ts`
  - `apps/web/e2e/online-typing/online-typing-entry-gate.spec.ts`
  - `apps/web/e2e/mobile/mobile-editor.spec.ts`
  - `apps/web/e2e/markdown/md-roundtrip-basic.spec.ts`
  - `packages/testing/unit/ime/ime-autosave.test.ts`
  - `apps/web/e2e/performance/typing-latency.spec.ts`

### Fail-first sequence

1. Add `local body survives saved confirmation and reload`:
   - create `/doc/trust-alpha`;
   - set representative heading, paragraph, checklist, link, and table content;
   - wait for `data-status="saved"`;
   - reload;
   - assert text and representative node semantics remain;
   - **current expected failure:** editor is empty despite saved state.
2. Add `document switch flushes pending body to the correct id`:
   - type in alpha;
   - switch to beta before 500 ms;
   - type in beta;
   - reopen alpha and beta;
   - assert isolation;
   - **current expected failure:** both reopened bodies are empty.
3. Add `malformed newest snapshot recovers last good`:
   - save revision A, then B;
   - corrupt only the primary record;
   - reload;
   - assert A is loaded, the recovery notice is visible, and corrupt primary raw data was not deleted.
4. Add `write failure never says saved` with a throwing Storage fixture:
   - assert scheduler reaches `error`;
   - assert last-good remains readable.
5. Add `realtime remains single-authority`:
   - enable local Wrangler realtime;
   - type and wait for `realtime-sync-state=saved`;
   - assert no `lash:body:*` keys were created;
   - reload and assert Worker-hydrated content.
6. Add 375 px reload/reopen check and screenshot.

### Browser-visible proof

Capture:

- desktop `1440x900`: a named local document after save, then the same unchanged body after reload;
- mobile `375x812`: create/write/save/reload/reopen with top bar, title, and editor in bounds;
- recovery: a corrupted primary loading the earlier valid body with a quiet “Recovered an earlier saved copy” notice;
- failure fixture: “Save failed” and never “All changes saved.”

Store screenshots under the sprint’s established proof location, for example:

- `artifacts/stranger-test/proof/wt-01-local-reload-desktop.png`
- `artifacts/stranger-test/proof/wt-01-local-reload-mobile.png`
- `artifacts/stranger-test/proof/wt-01-last-good-recovery.png`

The decisive browser assertion is not the screenshot alone: after a real page reload, editor JSON/text must equal the pre-reload snapshot, and the saved indicator must correspond to a readable stored envelope.

### Rollback

- Revert the WT-01 commit/PR.
- Do **not** delete `lash:body:*` or last-good keys during rollback; the previous build will ignore them, preserving a future recovery opportunity.
- Keep key parsing version-gated so a disabled reader can safely ignore an unknown envelope.
- If an emergency kill switch is needed, disable local snapshot hydration/writes in one app-level constant while retaining export and the raw keys.

### Stop conditions

Pause the bead if any of these occurs:

- a realtime-enabled document writes a local body snapshot;
- hydration changes valid TipTap JSON or drops a supported node/mark;
- alpha content is ever written under beta’s key during route switching;
- primary corruption overwrites or deletes the last-good snapshot;
- a failed/read-back-invalid write can still display saved;
- page lifecycle flush breaks IME composition or causes duplicate/partial CJK text;
- typing p95 exceeds 8 ms or synchronous storage work enters the per-keystroke path;
- the implementation requires a public API, canonical editor schema, server schema, or deployment change.

## Residual Risks and Follow-Ups

- LocalStorage quota may be inadequate for image-heavy documents, especially data URLs. WT-01 should surface an error and preserve last-good; IndexedDB/object storage is a later capacity bead.
- Concurrent tabs editing the same local document remain a conflict risk. Listen for storage updates only to warn about external changes; do not silently replace an actively edited body in this rapid bead.
- The default demo record is always sorted first, so the switcher is not a true recents list (`apps/web/lib/documentRegistry.ts:75-81`). Address this after body activity is trustworthy.
- Durable, reloadable structured history remains separate. WT-01 restores the latest body and one previous-good snapshot; it does not claim a production version timeline.
- Import should eventually confirm destructive replacement and offer “import as new document.”
- Realtime production availability still depends on the live runtime/secrets/two-collaborator milestone gates. This report proves the code path, not public deployment readiness.
- Mobile needs a full create/write/comment/share/reopen/export stranger pass after WT-01.

## RepoPrompt and Tool Log

1. Read the required `rp-investigate` skill and project guidance/context.
2. `bind_context(op=list)` found the Lash workspace at window 8, root `/Users/borker/dev/lash-doc`.
3. The first context-id binding was contaminated by a stale temporary RepoPrompt root. The first `context_builder` correctly refused to infer Lash behavior from the wrong workspace; its generated-plan model also returned a configured API-key 401.
4. Rebound with `bind_context(op=bind, working_dirs=/Users/borker/dev/lash-doc, window_id=8)`.
5. `get_file_tree(type=roots)` confirmed the single Lash root.
6. Reran required `context_builder(response_type=plan)` with explicit symptoms, hypotheses, local/realtime questions, and target outcome. Discovery traced the local/realtime split and selected the relevant implementation/test context. A normal Oracle follow-up was unavailable because of the configured 401; conclusions here were independently verified with RepoPrompt source and git tools.
7. Used RepoPrompt `get_file_tree`, `get_code_structure`, `file_search`, and `read_file` to trace the app, tests, history package, and realtime Worker.
8. RepoPrompt `git status` confirmed branch `codex/ux/bead-38-stranger-45-sprint`; unrelated governance/stranger-test files were already dirty. This lane modified none of them.
9. RepoPrompt `git log` confirmed HEAD lineage and that document registry/identity landed in `1b85b26`.
10. RepoPrompt `git blame` confirmed:
    - the callback-free `AutosaveIndicator` dates to May 2026 (`AutosaveIndicator.tsx:19-29`);
    - realtime collaboration was added around the pre-existing empty `useEditor` initialization (`EditorWorkspace.tsx:578-615`).
11. Shell `git rev-parse HEAD` returned `002333017fe2bca4ec589f8d157c1aa21a4b77da`.

## Evidence Strength and Assumptions

- Strong/direct: source readers/writers, hook arguments, in-memory Map implementation, provider queue/ack logic, Durable Object append/hydration, exact current tests, git provenance.
- Strong negative evidence: complete RepoPrompt localStorage search across `apps/web` and `packages` found metadata/preferences/chat/invite/realtime keys but no document-body reader/writer.
- Assumption: ordinary browser localStorage is available; private mode/quota exceptions are explicitly part of the proposed failure tests.
- Assumption: local documents are those for which `createLashRealtimeCollaboration(...).enabled` is false; this is the current product boundary.
- Not claimed: a live manual browser reproduction was not run in this read-only investigation lane. The current source path is conclusive, and the recommended bead begins with a browser test that must fail on the verified commit.
- Not claimed: deployed realtime availability. Worker code durability and public runtime readiness are separate facts.

## Source List

- `AGENTS.md` / `agents.md`
- `CONTINUITY.md`
- `MISTAKES.md`
- `artifacts/stranger-test/raw/user-objective-2026-07-18.md`
- `docs/plans/lash-next-milestone-2026-06-30.md`
- App/editor/storage/history/realtime source and tests cited inline
- RepoPrompt context-builder discovery, file/code search, git status/log/blame at the verified commit

## Final Recommendation

Start WT-01 immediately, test-first. Do not spend the next rapid product bead polishing recents, adding a dashboard, or expanding collaboration chrome while Lash can still erase a local document after announcing that it is saved. Once WT-01’s reload, fast-switch, corrupt-primary, realtime-exclusion, performance, and mobile proofs pass, follow with recents/quick-capture polish and a destructive-import/recovery pass.
