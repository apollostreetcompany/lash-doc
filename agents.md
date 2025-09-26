# agents.md

## Purpose

Define the **agent architecture** and **acceptance specs** for a collaborative word editor that supports:

- Document Chat with diff‑aware threads + filters
- History timeline with **diff logs** and **restore**
- **Authorship** (line‑by‑line attribution)
- **@mentions** (users, groups, natural dates)
- **Doc links → chips** with previews/backlinks
- **Natural outlining** (collapsible H1/H2/H3)
- **Simple Markdown** formatting (import/export + hotkeys)
- **Images, Checklists, Tables** (tables include **status** & **dropdown** cells)
- **Focus Mode**
- **Shareable Links** with scoped permissions
- **Titling**, **Autosave**
- **AI editor integration** that proposes **patchable diffs** (not blobs)

This doc is both an architectural overview and a **test‑driven contract**. It specifies **what “done” means** in user‑visible behavior, performance, and reliability.

---

## Non‑Goals

- Page layout/print‑perfect WYSIWYG (headers/footers/section breaks)
- Complex drawing/canvas features
- Arbitrary plugin execution inside the document sandbox
- Native DOCX editing; we target robust **import/export** gateways instead

---

## High‑Level Architecture

```
[Web App (Next.js/React)]
   ├── Editor Core (TipTap/ProseMirror or Lexical)
   │     ├─ Schema: paragraphs, headings, list, checklist, code, link, mention, chip, image, table(cell: text|status|select)
   │     └─ Plugins: outline, markdown, chips, table UX, authorship decorations, focus mode
   ├── Doc Chat Panel (threaded; selection-anchored; diff-aware)
   └── Share/Permissions UI

[Collaboration & History Service]
   ├── CRDT room (Yjs) + Presence
   ├── Append-only update log + periodic snapshots
   ├── Diff & attribution service (deterministic)
   └── Restore/version API

[AI Layer]
   ├── AI Edit Agent (selection-scoped, patch JSON out)
   ├── Retrieval for Doc Chat (section-aware citations)
   └── Guardrails (schema-safe patch validator)

[Storage]
   ├── Postgres (docs, metadata, history index, authorship, mentions, backlinks)
   ├── Object store (images, large snapshots)
   └── Search/FTS (doc titles, mentions, backlinks)
```

**Determinism principle:** all edits (human or AI) are normalized to **the same operation pipeline**; history, authorship, and diff rendering do not special‑case AI.

---

## Agents Overview

Each agent is an automated collaborator in the monorepo. Agents produce **typed patches + tests**. They are governed by **contracts, invariants, and SLOs** defined below.

### 1) **Editor Core Agent**
- **Mandate:** Implement/maintain schema, plugins (outline, markdown, chips, table UX), hotkeys, decorations.
- **Inputs:** Feature specs; schema definitions.
- **Outputs:** Type‑checked patches + unit tests + Playwright e2e flows.

### 2) **Collab & History Agent**
- **Mandate:** CRDT integration (Yjs), persistence (update log + snapshots), diff computation, restore endpoints.
- **Outputs:** Deterministic diff lib, convergence tests, performance budgets.

### 3) **Authorship Agent**
- **Mandate:** Maintain interval‑tree attribution per text node; map through edits; expose blame gutter + hover.
- **Outputs:** Attribution map library + tests for insert/delete/merge edge cases.

### 4) **Mentions & Chips Agent**
- **Mandate:** @mentions (users, groups, dates), doc link preview chips, backlink graph, parsing of natural dates.
- **Outputs:** Mention provider, chip renderer, RBAC‑aware resolvers.

### 5) **AI Edit Agent**
- **Mandate:** Generate **schema‑safe patches** for selected text; produce rationale + citations when needed; never output raw HTML/text blobs.
- **Outputs:** Patch JSON (`EditPatch`), structured rationale, unit replay tests.

### 6) **Doc Chat Agent**
- **Mandate:** Selection‑anchored threads; can reference history slices; filtered views (by author/AI/time/range).
- **Outputs:** Thread model + retrieval; e2e tests ensuring anchors remain stable.

### 7) **Share & RBAC Agent**
- **Mandate:** Shareable links (view/comment/suggest/edit), org/team roles, expirations, audit trail.
- **Outputs:** Policy checks; negative tests (policy violations).

### 8) **Autosave & Offline Agent**
- **Mandate:** Autosave, offline queue, conflict‑free merges, clear status indicators.
- **Outputs:** Offline simulation tests; battery/network throttling e2e.

### 9) **Tables & Media Agent**
- **Mandate:** Table with text/status/select cells; keyboard nav; CSV copy/paste; image upload/transform; checklist UX.
- **Outputs:** Cross‑browser interaction tests; large table perf tests.

### 10) **QA & Property‑Based Testing Agent**
- **Mandate:** Randomized multi‑client edit sequences; IME & bidi text; zero‑width chars; emoji; big documents.
- **Outputs:** Property‑based tests for convergence and invariant preservation.

---

## Global Invariants (must always hold)

1. **Schema validity:** No operation may produce an invalid document per schema.
2. **Convergence:** Given any sequence of interleaved edits, all clients converge to the same state after all updates apply.
3. **Attribution mapping:** Authorship intervals remain correct under inserts/deletes/joins/splits.
4. **Anchors & decorations:** Selections, comments, and chips maintain stable anchors across edits (or degrade predictably to nearest valid position).
5. **Deterministic diffs:** Given version A and B, the diff algorithm returns the same result across environments (CI, dev, prod).
6. **Access control:** A client cannot observe content beyond its permission scope (including mentions, chips, previews, and history slices).
7. **AI containment:** AI edits are delivered **only** as `EditPatch` operations that pass the validator; they are labeled and filterable.

---

## Performance SLOs (target; measured in CI and canary)

- **Cold open (<= 100 KB doc, 5 images):** first interactive < **1.5 s** on median laptop, < **2.5 s** p95.
- **Typing latency:** main‑thread budget **< 8 ms** per keystroke p95.
- **Outline collapse/expand:** **< 50 ms** p95 on 10k‑word doc.
- **History diff render:** **< 300 ms** p95 for adjacent versions; **< 1 s** p95 for distant versions (with snapshot assist).
- **Table nav (100×20 cells):** cell move/commit **< 50 ms** p95.
- **Autosave flush:** visible within **< 500 ms** p95 after idle.
- **Presence update fan‑out:** **< 200 ms** p95 round trip in single region.

---

## Security & Privacy Acceptance

- Share links are signed, scope‑limited, and can expire; server validates on **every** read.
- Doc Chat and history respect scope: a “viewer” cannot see redacted diffs or private threads.
- Mentions resolver returns only entities visible to the caller.
- All edit operations are **append‑only** with actor, ts, ip (hashed), ua; admin export available.
- PII in telemetry is minimized and gated behind consent flags.

---

## Accessibility Acceptance

- All toolbar actions reachable via keyboard; focus order logical.
- ARIA roles and names for menus, chips, and table controls.
- Screen‑reader friendly: headings exposed as landmarks; comments/threads navigable; diff insertions/deletions described.
- High‑contrast and reduced‑motion modes; visible focus states.

---

## Internationalization Acceptance

- IME compositions (JP/CJK) never break or duplicate characters; composition events do not trigger premature autosaves.
- Bidi paragraphs maintain cursor visuals and movement semantics.
- Grapheme‑cluster aware operations (emoji, ZWJ); cursor/backspace operate at cluster level.

---

## Patch JSON (canonical AI + programmatic edit format)

```json
{
  "patchId": "uuid",
  "docId": "uuid",
  "baseVersion": "sha256-of-last-applied",
  "author": { "type": "ai", "id": "gpt-5p", "label": "AI Editor" },
  "createdAt": "2025-09-24T12:34:56Z",
  "operations": [
    { "op": "replace_text", "from": 158, "to": 190, "text": "Concise revised sentence." },
    { "op": "set_attr", "nodeId": "n_12ab", "attrs": { "level": 2 } },
    { "op": "insert_node", "pos": 412, "node": { "type": "table", "attrs": {...}, "content": [...] } }
  ],
  "rationale": "Tighten wording; promote subsection to H2; add status table for clarity.",
  "citations": [
    { "type": "doc", "rangeFrom": 120, "rangeTo": 210 },
    { "type": "url", "href": "https://intra/policy-123" }
  ]
}
```

**Validator rules**
- Applies cleanly atop `baseVersion` (or rebased).
- Maintains schema invariants; preserves non‑targeted node attributes.
- Limits **selection scope** by default (no doc‑wide mutation unless explicitly requested).

---

## Acceptance Specs (Behavior‑Driven)

### A) Rich Text, Markdown & Outline

**A.1 Headings & Collapse**
- **Given** a document with H1/H2/H3 sections  
  **When** the user toggles collapse on an H2  
  **Then** all descendant blocks under that H2 visually collapse, the caret moves to the next visible block, and the outline panel updates counts.  
  **And** collapsed state persists across reloads for that user.  
  **Test IDs:** `outline-collapse-basic`, `outline-persist`, `outline-caret-move`

**A.2 Markdown Hotkeys**
- **Given** an empty paragraph  
  **When** the user types `##␣` then text,  
  **Then** the paragraph converts to H2, preserving inline styles typed afterward.  
  **Test IDs:** `md-h2-shorthand`, `md-bold-italic-hotkeys`

**A.3 Markdown Import/Export**
- **Given** a `.md` file with headings, lists, images, fenced code, tables (pipe syntax)  
  **When** imported  
  **Then** the structure maps to schema nodes; table pipe syntax becomes a table with text cells.  
  **And** exporting to Markdown round‑trips without structural loss (images exported as references).  
  **Test IDs:** `md-roundtrip-basic`, `md-table-import`

**A.4 Focus Mode**
- **When** Focus Mode is toggled  
  **Then** side chrome, comment panel, and toolbars hide; typing latency stays within SLO; screen reader still sees editor and title.  
  **Test IDs:** `focus-mode-ui`, `focus-mode-a11y`

---

### B) Tables, Checklists, Images

**B.1 Table Cell Types**
- **Given** a 3×3 table with columns: Text | Status | Select(single)  
  **When** editing Status,  
  **Then** the cell cycles through configured states (e.g., Todo/In‑Progress/Done) with keyboard (`Enter` opens, arrows navigate, `Enter` commits).  
  **Test IDs:** `table-status-cycle-kb`, `table-select-open-close`

**B.2 Keyboard Navigation**
- **When** user presses `Tab` at last cell in a row  
  **Then** caret moves to first cell of next row; pressing `Shift+Tab` moves backward; `Enter` inserts newline in text cells without leaving cell.  
  **Test IDs:** `table-tab-nav`, `table-enter-newline`

**B.3 Copy/Paste Interop**
- **Given** a selection spanning 3×3 cells  
  **When** pasted into a spreadsheet or CSV  
  **Then** tab‑delimited text transfers; when pasting CSV into a selected table range, cells fill accordingly.  
  **Test IDs:** `table-copy-out`, `table-paste-in`

**B.4 Large Table Perf**
- **Given** a 100×20 table  
  **Then** scroll/selection remains responsive within SLOs (virtualized rendering).  
  **Test IDs:** `table-perf-100x20`

**B.5 Images**
- **When** user pastes an image from clipboard or drags a file  
  **Then** an upload placeholder appears; failed upload shows retry; image node stores width/alt and supports keyboard resizing with handles.  
  **Test IDs:** `image-clipboard`, `image-dnd`, `image-resize`, `image-retry`

**B.6 Checklists**
- **When** toggling a checklist item  
  **Then** only that item toggles; nested items retain their own state; `Shift+Tab` outdents item.  
  **Test IDs:** `checklist-toggle`, `checklist-nesting`

---

### C) Links, Chips, Mentions

**C.1 Doc Links → Chips**
- **Given** a pasted URL that points to an internal document  
  **When** paste completes  
  **Then** it becomes a **chip** with title + icon + last editor; hover preview loads; clicking navigates in same tab; `Cmd/Ctrl+K` allows reverting to plain link.  
  **Test IDs:** `chip-autoconvert`, `chip-hover`, `chip-revert`

**C.2 @Mentions (users, groups)**
- **When** typing `@` followed by letters  
  **Then** suggestions show users and groups the caller can see; selecting inserts an inline mention node; clicking opens profile card; keyboard navigation supported.  
  **Test IDs:** `mention-suggest`, `mention-insert`, `mention-privacy`

**C.3 Natural Dates**
- **When** typing `@next Friday 3pm`  
  **Then** a date chip appears storing ISO time in the user’s timezone, displays natural language, and shows a hover with the absolute date/time; locale obeys user settings.  
  **Test IDs:** `mention-date-parse`, `mention-date-locale`

**C.4 Privacy**
- **Given** a group mention the user cannot access  
  **Then** it never appears in suggestions; existing hidden mentions render as anonymized tokens (no leakage).  
  **Test IDs:** `mention-rbac-hide`, `mention-anonymized`

---

### D) History, Diff, Restore

**D.1 Suggest/Track Changes Mode**
- **When** Suggesting is enabled  
  **Then** insertions show as underlined green, deletions as red strikethrough; hovering shows author, ts, and action; Accept/Reject applies a patch and logs to history.  
  **Test IDs:** `suggest-visuals`, `suggest-accept`, `suggest-reject`

**D.2 Version Timeline**
- **Given** a doc with > 50 edits  
  **When** opening History  
  **Then** versions appear grouped by session/time; selecting two shows **structural + inline diff**; clicking **Restore** creates a new head version (no destructive rewrite).  
  **Test IDs:** `history-open`, `history-diff`, `history-restore`

**D.3 Filtered Diffs**
- **When** filtering by author “AI Editor” and time “last 7 days”  
  **Then** diff view highlights only matching changes; counts update; copy link preserves filters.  
  **Test IDs:** `diff-filter-author`, `diff-filter-time`, `diff-share-link`

**D.4 Determinism**
- **Given** versions A and B  
  **Then** diff output (JSON and rendering spans) is identical across environments.  
  **Test IDs:** `diff-deterministic`

---

### E) Authorship (“Blame”)

**E.1 Line Gutter**
- **When** toggled  
  **Then** a gutter shows the **dominant author** per visual line; hovering reveals a breakdown by ranges; clicking filters history to those edits.  
  **Test IDs:** `blame-gutter`, `blame-hover`, `blame-filter`

**E.2 Mapping Under Edits**
- **Given** interleaved inserts/deletes  
  **Then** attribution intervals remain correct; property‑based tests generate random sequences to verify.  
  **Test IDs:** `blame-interval-map`, `blame-property`

---

### F) Doc Chat (Diff‑Aware)

**F.1 Anchored Threads**
- **When** selecting text and creating a thread  
  **Then** the thread anchors to that range; subsequent edits adjust the anchor; if the exact range is deleted, the thread pins to the nearest surviving token and marks as “orphaned” if context lost.  
  **Test IDs:** `chat-anchor-map`, `chat-orphan`

**F.2 History‑Scoped View**
- **When** opening a thread created on version V  
  **Then** user can view the **state of the text at V** inline; switching to “current” shows today’s text; diffs are visible within the thread.  
  **Test IDs:** `chat-history-context`, `chat-current-context`

**F.3 Filters**
- **When** filtering by author/AI/time/node type  
  **Then** only matching threads render; counts update.  
  **Test IDs:** `chat-filter-author`, `chat-filter-ai`

---

### G) Share Links & Permissions

**G.1 Scopes**
- **Given** a share link with **Comment** scope  
  **Then** user can comment and suggest but cannot accept changes or edit directly.  
  **Test IDs:** `share-comment-scope`, `share-suggest-scope`, `share-edit-scope`

**G.2 Expiry & Audit**
- **When** link expires  
  **Then** access is denied; audit log records attempted access with reason “expired”.  
  **Test IDs:** `share-expiry`, `share-audit`

**G.3 Redaction**
- **When** a viewer opens History  
  **Then** content they cannot access is redacted in diffs and chat transcripts; counts remain accurate.  
  **Test IDs:** `history-redact`, `chat-redact`

---

### H) Autosave, Offline, Presence

**H.1 Autosave**
- **When** user stops typing  
  **Then** changes flush within 500 ms; “All changes saved” indicator updates; last saved time visible on hover.  
  **Test IDs:** `autosave-indicator`, `autosave-latency`

**H.2 Offline Edits**
- **Given** a network drop  
  **When** user continues editing  
  **Then** a local queue accumulates; upon reconnect, changes merge without data loss; conflicts resolve via CRDT; presence updates resume.  
  **Test IDs:** `offline-queue`, `offline-merge`, `presence-resume`

**H.3 Multi‑Client Consistency**
- **Given** two clients editing the same paragraph  
  **Then** after quiescence both converge; selections don’t jump unexpectedly; blame intervals match.  
  **Test IDs:** `multi-client-converge`, `selection-stability`

---

### I) AI Editor

**I.1 Patch, Not Paste**
- **When** user selects text and clicks “Improve Writing”  
  **Then** AI returns an `EditPatch`; validator passes; the change is labeled **AI Editor** with rationale; user may Accept/Reject.  
  **Test IDs:** `ai-patch-apply`, `ai-labeling`, `ai-rationale`

**I.2 Guardrails**
- **If** AI proposes structure‑breaking ops  
  **Then** validator blocks with a visible reason; no mutation applied; a safe fallback suggestion appears.  
  **Test IDs:** `ai-invalid-reject`, `ai-fallback`

**I.3 Selection Scope**
- **By default** AI only edits within the selection; doc‑wide edits require explicit user intent (modal confirmation).  
  **Test IDs:** `ai-scope-selection`, `ai-scope-global-confirm`

**I.4 Citations in Chat**
- **When** AI answers in Doc Chat  
  **Then** it cites exact ranges or versions; clicking a citation jumps to that doc slice.  
  **Test IDs:** `ai-chat-citation`, `ai-citation-jump`

---

### J) Cross‑Browser, Input Methods, Accessibility

**J.1 Browsers**
- Chrome, Safari, Firefox, Edge latest two versions; Windows/macOS; iPad Safari.  
  **Test IDs:** `cb-chrome`, `cb-safari`, `cb-firefox`, `cb-edge`, `cb-ipad`

**J.2 IME**
- **Given** Japanese IME composition  
  **Then** no duplicate character insertion; caret stays within composing range; autosave waits until compositionend.  
  **Test IDs:** `ime-composition`, `ime-autosave`

**J.3 Screen Readers**
- NVDA, VoiceOver, JAWS: headings list, comment navigation, diff announcement strings.  
  **Test IDs:** `sr-headings`, `sr-diff-announce`, `sr-thread-nav`

---

## Test Harness & Tooling

- **Unit tests:** Vitest/Jest; schema validation; diff determinism.
- **Property‑based:** `fast-check` random edit sequences across 2–4 simulated clients → assert convergence, attribution correctness.
- **E2E:** Playwright; network throttling; offline simulation; IME emulation; clipboard tests.
- **Fixtures:**  
  - “Legal Contract” (heavy headings, lists)  
  - “Multilingual” (AR/HE bidi + CJK + emoji)  
  - “Large Table” (100×20)  
  - “Image‑heavy” (10 images)  
  - “Changelog” (hundreds of small edits)
- **Golden files:** Diff JSON snapshots for determinism checks.
- **Performance gates:** CI runs perf smoke tests; regressions >15% fail PR.

---

## Observability

- **Tracing:** user action → operation application → broadcast → render commit (trace id).  
- **Metrics:** typing latency, diff render time, snapshot load, Yjs update size, compaction time.  
- **Logs:** policy denials, AI validator errors, share link access.

---

## Rollout & Quality Gates

- **Phase 0 Gate:** Rich text + outline + markdown + images + tables + checklists + autosave + focus mode + basic chips ✅
- **Phase 1 Gate:** Live collab + history + deterministic diffs + restore + authorship ✅
- **Phase 2 Gate:** Mentions (users/groups/dates) + share links + RBAC + chat ✅
- **Phase 3 Gate:** AI patch flow, guardrails, citations, filters ✅
- **Ship Criteria:** All SLOs green on canary; a11y pass; cross‑browser matrix pass; data export/import sanity pass.

---

## Prompts & Contracts (for LLM‑driven agents)

### AI Edit Agent — Prompt Skeleton
- **System:** “You are an AI editor operating on a structured document. You must output a JSON `EditPatch` conforming to the schema. Never output raw text. Preserve meaning unless asked to transform. Maintain schema validity. Operate only within the provided selection unless `allowGlobal=true`.”
- **Inputs:** 
  - `selectionText`, `beforeContext`, `afterContext` (bounded)
  - `styleGuide` (tone, length, banned words)
  - `baseVersion`, `docSchemaSummary`
- **Output:** Validated `EditPatch` + `rationale` + optional `citations`.

### QA Agent — Property‑Based Plan
- Generate N random sequences of ops (insert/delete/split/merge/format) across M clients, seed‑controlled.  
- After quiescence, assert: doc equality, attribution equality, selection stability within tolerance, diff determinism between random historical pairs.

---

## Keyboard Map (must work on Mac/Windows)

- **Bold/Italic/Underline:** `Cmd/Ctrl+B`, `Cmd/Ctrl+I`, `Cmd/Ctrl+U`
- **Headings:** `Cmd/Ctrl+Alt+1/2/3`
- **Checklist toggle:** `Cmd/Ctrl+Shift+X`
- **Link:** `Cmd/Ctrl+K`
- **Code inline:** `` Cmd/Ctrl+E ``
- **Focus mode:** `Cmd/Ctrl+Shift+F`
- **Table nav:** `Tab`/`Shift+Tab`, `Enter` newline within cell

---

## Data Model Sketch (selected)

- **Node types:** `doc`, `paragraph`, `heading{level}`, `bullet_list`, `ordered_list`, `list_item`, `checklist_item{checked}`, `image{src,alt,width}`, `table`, `table_row`, `table_cell{cellType,options}`, `mention{kind: user|group|date, refId, display, iso?}`, `chip{kind: doc, refId}`
- **History entry:** `{ id, docId, actorId, ts, ops[], intent?: 'suggest'|'edit'|'ai' }`
- **Authorship map:** per text node, interval tree of `{start,end,authorId}`

---

## Failure Playbook (selected)

- **Diff timeouts:** fall back to snapshot‑assisted diff; show “coarse diff” banner.
- **Snapshot corruption:** auto‑roll back to prior snapshot; alert; block writes to the corrupted branch.
- **AI validator fail:** show precise reasons; log sample; do not partially apply.

---

## Product Tenets (Carmack/Karpathy/Dorsey)

- **Carmack:** Determinism over cleverness. Single logical writer per doc; instrument everything; cap memory; compaction as a first‑class feature.
- **Karpathy:** AI is just another collaborator. Small‑context edits; cite sources; never bypass the schema; measurable quality lifts.
- **Dorsey:** Calm core. Writing first; minimal chrome; “Show me what changed since last time” is sacred.

---

# Appendix: Concrete Test Matrix (abbrev.)

| Area | Scenario | ID |
|---|---|---|
| Outline | Collapse/expand + persistence | `outline-persist` |
| Markdown | `## ` converts to H2 | `md-h2-shorthand` |
| Tables | Status cell keyboard flow | `table-status-cycle-kb` |
| Chips | Internal link → chip + hover | `chip-autoconvert` |
| Mentions | Date chip parses TZ | `mention-date-parse` |
| Diff | Deterministic across envs | `diff-deterministic` |
| Authorship | Interval updates under deletes | `blame-interval-map` |
| Chat | Anchor survives edits | `chat-anchor-map` |
| Share | Comment scope limits | `share-comment-scope` |
| Autosave | Flush <500 ms | `autosave-latency` |
| Offline | Merge on reconnect | `offline-merge` |
| AI | Patch validated + labeled | `ai-patch-apply` |
| IME | JP composition stable | `ime-composition` |
| A11y | Diff announced via SR | `sr-diff-announce` |

---

## How to Use This File

- Treat every **Scenario** and **Test ID** as an acceptance gate.  
- Agents must submit PRs that:
  1) Modify code,  
  2) Add/adjust tests covering the behavior,  
  3) Keep SLOs green, and  
  4) Preserve global invariants.

When in doubt, **prefer determinism, schema safety, and user trust.**
