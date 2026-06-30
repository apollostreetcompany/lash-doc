# Lash Next Milestone Plan - Collaborative Daily Driving

Date: 2026-06-30

Baseline: `main` at `818d3b0` after COM-01 merge closeout.

Objective: move Lash from the current Quip-like/local-plus-realtime prototype toward:

- 80-90% real collaborative daily driving.
- 99% daily personal idea writing.

This is not a rewrite. The existing TipTap/Yjs editor, Cloudflare Durable Object realtime room, document-side outline, durable chat/suggestions, invite UX, and insight-router package remain the foundation.

## Current Truth

- `main` is green after PR #36.
- `FEATURE_AUDIT/STORIES.csv` remains canonical with 201 stories.
- Quip visual evidence and Lash before/after screenshots live under `artifacts/ux-sprint/`.
- Cloudflare realtime Worker is deployed and publicly healthy, but production document sessions are intentionally closed until shared secrets and the dynamic web runtime are wired.
- Render dynamic web support exists as `render.yaml` plus `make verify-render`, but the live Render service still needs Dashboard/API apply.
- COM-01 made chat/comment threads feel document-attached, but duplicate identical text can still map to the first matching occurrence until anchors are stored as true editor positions.
- Local document titles and registry persist, but local document body persistence/reload confidence is still not good enough for daily idea writing.

## Milestone Gates

### 80% Collaborative Daily Driving

The product can be used by two real collaborators on a deployed URL for a real writing session without local setup.

Required proof:

- Live dynamic web URL serves `/doc/[id]`.
- Web runtime and Cloudflare realtime Worker share compatible session/invite secrets.
- Two real browser contexts can create or open the same document, invite, edit concurrently, comment, reconnect, reload, and see converged content.
- Failure states are visible and recoverable: reconnect, read-only scope, expired invite, revoked invite, and denied mutation.
- No per-keystroke typing SLO regression in normal and large documents.

### 90% Collaborative Daily Driving

The product can withstand repeated daily team use with clear trust boundaries.

Additional proof:

- Durable server-side invite issuance/revocation/audit exists, not only browser-local rows.
- Real collaborator identity/profile labels are stable enough for comments, presence, history, and blame.
- Comment/suggest/edit permissions are enforced server-side at the mutation layer where possible, not only with browser affordances.
- Comment anchors survive duplicate text, edits around the range, and reloads.
- A short dogfood script passes for at least three consecutive sessions: invite, co-edit, comment, suggest, accept/reject, reload, export/recover.

### 99% Daily Idea Writing

A solo writer can trust Lash as the default place for notes and ideas.

Required proof:

- Local document body persists and reloads reliably across tabs and browser restarts.
- Recent documents, quick capture, and blank-state flows make returning to an idea obvious.
- Autosave/recovery/export behavior is visible and boringly reliable.
- Mobile and tablet can capture, edit, comment, and reopen without layout clipping.
- Markdown export/import and recovery checks cover the common "get my words out" path.

## Proposed Beads

### NM-01 - Live Dynamic Web Runtime

Workstream: deploy

Risk: high

Primary owner: DevOps Engineer

Acceptance:

- Apply `render.yaml` through Render Dashboard/API or equivalent approved runtime.
- Configure production start command: `next start -H 0.0.0.0 -p $PORT`.
- Verify `/`, `/doc/render-smoke`, and one arbitrary `/doc/<id>` route on the live URL.
- Record health check, rollback path, env assumptions, and smoke URL in `DEPLOYMENT.md` and `HANDOFF.md`.

Validation:

- `make verify-render`
- Live smoke against the deployed URL.
- PR CI `build-and-test`.

### NM-02 - Production Realtime Secret Wiring

Workstream: deploy

Risk: high

Primary owner: DevOps Engineer

Acceptance:

- Set `LASH_REALTIME_SESSION_SECRET` and `LASH_REALTIME_INVITE_SECRET` for the Cloudflare Worker.
- Configure the dynamic web runtime with the matching realtime URL and invite/session assumptions.
- Confirm unauthenticated session minting remains denied on public hosts.
- Confirm a valid invite can mint a scoped realtime session for the intended document.

Validation:

- `make verify-realtime-runtime`
- Worker health and denied-session checks against the deployed Worker.
- Live invite-token exchange check from the web runtime.

### NM-03 - Deployed Two-Collaborator Smoke

Workstream: code/deploy

Risk: high

Primary owner: QA/Collab Engineer

Acceptance:

- Playwright or equivalent live smoke covers two browser contexts on the deployed URL.
- Owner creates/opens a document, issues invite, second actor joins, both edit, both comment, one reloads, content converges, sync state returns saved.
- View/comment scopes hydrate without edit mutation.
- Expired or invalid invite shows a clear denial state.

Validation:

- New live-smoke command documented in `Makefile` or `scripts/`.
- Local equivalent still passes against Wrangler.
- PR CI remains green.

### NM-04 - Position-Native Comment Anchors

Workstream: code

Risk: medium

Primary owner: Doc Chat Agent

Acceptance:

- Chat anchors store and map true ProseMirror/Yjs positions or an equivalent deterministic anchor record.
- Duplicate identical text maps to the intended occurrence, not the first textual match.
- Edits before, inside, and after the anchor keep the marker, current-target row, and Show action correct.
- Deleted ranges degrade to the current explicit orphan state.

Validation:

- Fail-first e2e for duplicate identical text.
- Existing COM-01 e2e/a11y still pass.
- Unit tests for anchor mapping edge cases if a helper is extracted.

### NM-05 - Local Document Body Persistence and Recovery

Workstream: code

Risk: medium

Primary owner: Editor Core / Autosave Agent

Acceptance:

- Local-only documents persist body content per document id across reloads and browser restarts.
- Malformed local state fails safe with a recovery path and does not destroy the last good snapshot.
- Autosave indicator clearly reflects pending/saved/error state for local document body saves.
- Existing realtime documents keep using Yjs persistence without double-writing ambiguous local copies.

Validation:

- Fail-first reload e2e for local document body.
- Autosave and document-identity tests remain green.
- Manual recovery fixture or unit coverage for malformed saved state.

### NM-06 - Daily Idea Writing Flow

Workstream: design/code

Risk: medium

Primary owner: Frontend/Product Engineer

Acceptance:

- First run lands in a usable writing surface, not a dashboard-like explanation.
- Recent documents and quick capture make it obvious where today's idea went.
- Empty states stay quiet, useful, and non-marketing.
- The interface preserves the Quip-like calm established by OUT-01 and COM-01.

Validation:

- Screenshot comparison against existing Quip reference set.
- New e2e for create, write, reload, return via recents, and quick capture.
- Mobile viewport proof for the same flow.

### NM-07 - Export, Import, and Escape Hatch

Workstream: code

Risk: medium

Primary owner: Editor Core Agent

Acceptance:

- Markdown export preserves headings, lists, checklists, links, images references, tables where supported, and comments/suggestions as clear adjunct metadata or documented omissions.
- Markdown import handles the existing accepted subset without corrupting structure.
- A writer can always get their words out without relying on the realtime service.

Validation:

- Round-trip unit tests for representative docs.
- Browser e2e for export action and downloaded content sanity.
- Tracker rows for markdown/import/export updated as needed.

### NM-08 - Mobile Daily Writing Hardening

Workstream: design/ui

Risk: medium

Primary owner: Frontend Engineer

Acceptance:

- Phone and tablet flows cover create, write, comment, share/invite, reopen, and export/recovery surfaces.
- No topbar, drawer, rail, comment marker, or toolbar clipping at 375px and tablet widths.
- Touch targets remain at least 44px where applicable.

Validation:

- Focused mobile/tablet e2e.
- Screenshot set under `artifacts/ux-sprint/lash/next-milestone/`.
- Accessibility notes in the proof report.

### NM-09 - Dogfood and Release Readiness Pass

Workstream: research/analysis

Risk: low

Primary owner: QA/Product

Acceptance:

- A scripted 30-minute solo writing session and a two-person collaboration session are documented.
- All blocker, papercut, and trust issues are filed into the canonical tracker or a new sprint packet.
- Final recommendation states whether Lash is ready for daily idea writing, internal collaborative daily driving, or neither.

Validation:

- `FEATURE_AUDIT/STORIES.csv` and `STORIES_SUMMARY.md` updated.
- `CONTINUITY.md`, `HANDOFF.md`, and `handoff/beads.jsonl` updated.
- PR CI green.

## Suggested Execution Order

1. NM-01 and NM-02 first. Collaboration cannot honestly reach 80% without live runtime and secrets.
2. NM-03 immediately after NM-01/NM-02, because deployed two-user smoke will expose the real blockers.
3. NM-04 and NM-05 can run in parallel after NM-03 baseline evidence exists.
4. NM-06 through NM-08 improve solo daily writing and mobile trust.
5. NM-09 closes the milestone with evidence and a go/no-go assessment.

## Next Agent Startup Checklist

1. Read `AGENTS.md`, `CONTINUITY.md`, `HANDOFF.md`, `MISTAKES.md`, and this file.
2. Bind RepoPrompt to `/Users/borker/dev/lash-doc` and inspect the current file tree.
3. Start from `main` and create a new worktree, recommended:
   - Worktree: `/Users/borker/dev/lash-doc-next-milestone`
   - Branch: `codex/milestone/collab-daily-driving`
4. Confirm remote `main` still has green `build-and-test`.
5. Use `release-feedback-reactor` for feedback packets, and use UI skills for NM-06/NM-08.
6. For every UI bead, capture before/after screenshots and compare against the existing Quip reference artifacts.
7. Keep `FEATURE_AUDIT/STORIES.csv` canonical; update `STORIES_SUMMARY.md` only as a derived summary.
8. Keep `/tmp/lash-ux-sprint.md` current if continuing the existing sprint receipt.
9. Commit and PR each bead or tightly coupled bead pair; do not commit directly to `main`.

## Known Blockers and Caveats

- Render live service creation may still require Dashboard/API access not available in the CLI.
- Cloudflare realtime production sessions remain closed until secrets are set.
- Server-side policy distinction between comment/suggest/edit over opaque Yjs updates is not solved by browser UI alone.
- Observability/storage backend scaffolds in `FEATURE_AUDIT/DEFERRED.md` remain separate larger subsystems.
- Riddle remains out of scope.
