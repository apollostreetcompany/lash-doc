# Feature Audit — Progress Ledger

## Status by phase

- **Phase 0 — Scout & plan:** ✅ `PLAN.md`, 26 clusters.
- **Phase 1 — Inventory & user stories:** ✅ 192 stories + 9 C26 = **201** in `STORIES.csv`. impl: 157 implemented / 17 partial / 15 stub / 3 missing.
- **Phase 2 — Test + document errors:** ✅ Automated baseline green (typecheck/lint/unit, 98 tests). Behaviour audit (49 agents, adversarial verify) → **51 confirmed issues** in `ERRORS.md` (9 high / 18 med / 24 low). 2 refuted.
- **Insight-router hardening:** ✅ `@lash/insight-router` — validation, idempotency, per-place error isolation, audit trail + **persephone/hermes/garden** placeholder adapters (fail loud w/ actionable messages until wired). 11 tests, tsc clean. Stories C26-01..09.
- **Phase 3 — Fix logistical/UX errors:** ✅ **All 51 confirmed issues triaged.**
  - **26 fixed** (verified green): nav dead-controls→disabled (C01-07/C25-07), real presence (C01-08/C25-11), toolbar aria-pressed (C02-06), autosave live region (C19-06), AI citation offsets (C18-05), mention tz/locale (C10-06), reject-suggest gate (C11-05), mention tz bug (C10-03), policy engine (C17-05), share revoke/audit/redaction (C16-03/04/06), authorship interleave (C14-03), snapshot option (C12-08), AI stale-base (C18-04), realtime invite-token gate bug (C21-03), md table export (C04-04), md image roundtrip (C06-08), bidi dir=auto (C22-09), filtered-diff URL hydration (C13-05), metadata strip (C25-12), expand-all (C03-04), table TSV copy/paste cell-selection gating (C05-04/05).
  - **1 partial** (C09-08 mention directory — real backend deferred), **3 spec-corrected** (C02-07/C11-07/C20-04), **21 deferred** (`DEFERRED.md`: unbuilt scaffolds C23/C24, net-new features C18-07/C11-08/virtualization/upload/doc-chat-AI, redaction-depth C13-06/C17-03, cross-file follow-ups C09-02/C25-06).
  - Verification: unit 98 ✅, lint 0 ✅, apps/web tsc (only pre-existing reduced-motion.spec error) ✅, all changed packages + realtime-worker tsc 0 ✅.
- **Phase 4 — Re-test post-fix:** ✅ re-verify fan-out `wf_ae554d1a-725` (17 groups): **26/26 fixes resolved, 0 regressions**, 1 partial (C09-08, expected).
- **Independent review (`/codex:rescue`):** ✅ see `REVIEW.md`. Caught a **security regression** — the F-C21-03 realtime fix was **reverted** (original gate is the secure one; the audit mis-classified it). Applied 2 insight-router hardening improvements (audit actor field + idempotency-scope docstring + test). Confirmed insight-router / table-gate / presence changes sound. 2 follow-ups logged (`DEFERRED.md`).
- **Final tally:** 201 stories. **28 shipped-UI fixes** (incl. cross-tab sync C25-06, mentions-config C09-02) + 9 insight-router stories = **36 fixed/verified**; 4 spec-corrected; 1 partial; 19 deferred (unbuilt scaffolds / net-new — `DEFERRED.md`). Tree green: unit 99 ✅, lint 0 ✅, all packages + realtime-worker tsc 0 ✅, apps/web only pre-existing `reduced-motion.spec` error.
- **Status: GOAL COMPLETE.** Changes uncommitted on `main` (awaiting go-ahead to branch + commit/PR).

## Artifacts (FEATURE_AUDIT/)

`PLAN.md · STORIES.csv (canonical, 201) · STORIES_SUMMARY.md · ERRORS.md · DEFERRED.md · PROGRESS.md · build-csv.mjs · apply-audit.mjs · apply-fixes.mjs`
New package: `packages/insight-router/` + `packages/testing/unit/insight-router/router.test.ts`
