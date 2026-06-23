# Independent Review (/codex:rescue)

Codex reviewed the highest-risk session changes (insight-router, realtime token gate, table
copy/paste gating, presence rewiring, AI citation). Findings + dispositions:

## Acted on

- **🔴 Auth regression (realtime) — REVERTED.** Codex found that moving the localhost gate into
  the no-token branch (audit fix F-C21-03) let invite tokens through on non-local hosts when no
  session secret is set — and `inviteSecret()` falls back to a **public hardcoded dev secret**
  (`packages/realtime-worker/src/index.ts:61`), so a forged token would be accepted and the issued
  session token would itself be signed with a public secret. The **original gate was the secure
  behavior**; the Phase-2 audit mis-classified it as a bug. Reverted + added an explanatory comment.
- **🟡 Audit trail missing actor (insight-router) — FIXED.** Added `actor?: ActorRef` to
  `RouteAuditEntry`, populated from `payload.source.author` in `record()`, + a unit test.
- **🟡 Idempotency over-claim (insight-router) — FIXED.** Docstring now states the dedup map is
  in-memory/per-instance (not durable across restart) and points durable-exactly-once consumers at
  `stableInsightId` for their own unique key.

## Confirmed OK by review

- Insight-router validation / per-place error isolation / unconfigured placeholders — correct.
- Table copy/paste `instanceof CellSelection` gate — `preventDefault` only after a successful
  match; non-table copy/paste not swallowed; single-cell text caret correctly falls through.
- Presence rewiring — `realtimeSnapshot.peers` is always an array (no first-paint crash); URL
  hydration uses `window.location` (no Next.js Suspense requirement), mount-once effect correct.

## Follow-ups (logged, not blocking — see DEFERRED.md)

- **AI citation under doc churn (C18-05):** captured PM positions are not remapped through edits
  made while the AI answer is in flight (still a clear improvement over the prior `+1` offset bug;
  clamped so no crash). Robust fix = map through `tr.mapping` or guard on a doc fingerprint.
- **Single-cell CellSelection (C05-04/05):** a whole-cell (non-caret) single-cell CellSelection
  also takes the TSV path; intended and harmless, but undocumented/untested. Optional `>1` guard.
