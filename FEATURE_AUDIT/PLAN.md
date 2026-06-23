# Lash Feature Audit & Hardening — Deep Plan

> Generated under `/goal` (ultracode). Honors `$rp-deep-plan` (deep plan) and
> `$rp-orchestrate` (workflow fan-out). Per-feature review via `/codex:rescue`.
> Canonical tracking lives in `FEATURE_AUDIT/STORIES.csv` (single source of truth).

## Objective (verbatim from goal)

1. Go over **every** feature → write a user story + expected behaviour **derived from the code**.
2. Keep a **single canonical spreadsheet** tracking each feature's status.
3. Loop → **test every user story**, document all errors.
4. Loop → **fix every logistical / UX error**.
5. Loop → **re-test every user behaviour** post-fix.
6. **Harden** the feature that routes insights to the right place.
7. Add **placeholders** to integrate with `persephone` (memory), `.hermes` (agent),
   `garden-state`/`gardenos` (todo lists) as special **"writing places."**

## Architectural reality (as found, 2026-06-22)

- Real user surface = `apps/web`: `EditorWorkspace.tsx` (60 KB monolith) + 13 panels
  (`AIPanel, AutosaveIndicator, ChatPanel, EditorToolbar, FocusModeToggle, HistoryPanel,
MarkdownIO, MentionPanel, OfflinePanel, OutlinePanel, SharePanel, TableCellPanel`) +
  shell (`AppShell, Sidebar, TopBar, RightRail, Avatar, Icon`).
- Logic packages (mostly single `src/index.ts`): `ai, authorship, collab-service, doc-chat,
history, mentions, rbac, share, storage, tables-media, observability, types`.
- `packages/editor-core` is the rich one (schema, toolbar, outline, markdown, tables, chips, image).
- `packages/realtime-worker` = Cloudflare Worker (rooms, access, persistence, URL routing).
- Tests: 93 Playwright e2e specs (27 dirs) + ~30 Vitest unit files.
- REPO_MAP.md describes `apps/api`, `apps/realtime-gateway`, `apps/ai-orchestrator`,
  `apps/admin` — **these do not exist**; the worker + web app carry the load.
- **persephone / hermes / garden are NOT referenced anywhere** → the insight-router and the
  three "writing places" are NEW work (build hardened core + placeholder adapters).

## Interpretation of "routes insights to the right place"

No existing feature is named this. Interpreted as a **Writing-Places / Insight-Router**
subsystem: takes a normalized **InsightPayload** (a selection, note, AI rationale, chat
message, or extracted todo) and routes it to a chosen **WritingPlace** (destination).

- Built-in places: current doc (insert), new doc, clipboard.
- Special external places (placeholder adapters, fail-loud when unconfigured):
  - `persephone` → memory store.
  - `hermes` → agent dispatch.
  - `garden`/`gardenos` → todo/task list.
    Hardening = typed place registry, payload validation, idempotency keys, per-place error
    isolation (NO silent fallback — CLAUDE.md rule), audit trail, pluggable adapters.

## Feature clusters (inventory unit of work)

C01 Editor shell & document lifecycle · C02 Toolbar & formatting · C03 Headings/outline/collapse ·
C04 Markdown import-export & hotkeys · C05 Tables (cells/nav/copy-paste/perf) · C06 Images & media ·
C07 Checklists · C08 Chips (internal links) · C09 Mentions (users/groups) & privacy ·
C10 Natural-date mentions · C11 Suggest mode · C12 History timeline/snapshots/restore ·
C13 Deterministic & filtered diffs · C14 Authorship/blame gutter · C15 Doc chat (anchors/filters/history) ·
C16 Share/RBAC/scopes/expiry/audit · C17 Redaction (history/chat) · C18 AI patch/guardrails/scope/citations ·
C19 Autosave & focus mode · C20 Offline edits & collaboration (Yjs) · C21 Realtime worker (rooms/access/persistence) ·
C22 Accessibility/IME/i18n/SR · C23 Observability/SLOs · C24 Storage · C25 Sidebar/nav/doc-identity/title ·
C26 Insight routing / writing places (NEW — design + harden).

## Phased execution

- **Phase 1 — Inventory & user stories** (`$rp-orchestrate` fan-out, 1 agent/cluster).
  Each agent reads the cluster's code and returns structured stories
  (title, user story, expected behaviour, file:line evidence, impl status). Assemble into
  `STORIES.csv`. Status column = `story-drafted`.
- **Phase 2 — Test every story.** Run existing unit+e2e suites; for each story, map a
  pass/fail; document every error in `ERRORS.md`. Status → `tested`, plus error refs.
- **Phase 3 — Fix logistical/UX errors.** Triage errors, fix root causes (no silent
  fallbacks). Harden the insight-router; add the three writing-place placeholders.
  Status → `fixed`.
- **Phase 4 — Re-test.** Re-run behaviours; confirm green. Status → `verified`.
- **Cross-cutting** — `/codex:rescue` review of each substantive feature/fix.

## Canonical spreadsheet columns (`STORIES.csv`)

`id, cluster, feature, user_story, expected_behaviour, evidence, impl_status,
phase, test_status, errors, fix_status, retest_status, notes`

## Status legend

impl_status: implemented | partial | stub | missing
phase: story-drafted → tested → fixed → verified
test_status: untested | pass | fail | blocked
fix_status: none | needed | in-progress | fixed
retest_status: pending | pass | fail
