# Deferred — unbuilt subsystems (NOT UX/logistical defects)

These confirmed findings are **roadmapped scaffolds**, honestly self-labeled in code as
`SCAFFOLD — implement in M5/F5` (etc.). "Fixing" them means building entire backends
(Postgres, S3, OTLP/Prometheus, virtualization, real upload/model endpoints) — far beyond
"fix every logistical/UX error," and several are impossible here (no DB/creds/infra).
They are recorded so the user can prioritize them as separate feature work, and are
**excluded from the Phase-3 fix loop**.

## Backend infra (build entire subsystem)

- **F-C23-01..04** Observability: distributed tracing, metrics recorder, structured logging, SLO budgets — all throwing stubs, no consumers. Needs OTLP/prom-client backend.
- **F-C24-01..05** Storage: Postgres doc store, append-only history (CAS), S3 object store + signed URLs, full-text search index, canonical-hash policy — all throwing stubs. Needs DB/S3.

## Net-new editor features (non-trivial build)

- **F-C18-07** AI-range labeling mark/decoration (`buildAiExtensions` returns `[]`). Decoration plugin + apply-on-patch. (Wiring already exists per audit — candidate for a later focused build.)
- **F-C11-08** Inline suggestion marks (inserted/deleted) — `buildSuggestExtensions` unimplemented.
- **F-C05-08 / F-C06-09** Large-table virtualization (`createTableVirtualizer`) + transform/upload pipeline.
- **F-C06-03** Real async image upload pipeline (currently a mock uploader). Needs an asset endpoint.
- **F-C15-05 / F-C15-08** Doc-chat real AI replies + Postgres ThreadStore adapter.

## Spec-only corrections (story text fixed in STORIES.csv, no code change)

- **F-C02-07** Hotkeys ARE wired (`LashKeyboardShortcuts`); Mod+K → `onRequestLink`. Story over-claimed a gap.
- **F-C20-04** collab-service convergence story is scaffold; real path is the Yjs WS provider (F-C20-05).

## Review follow-ups (from /codex:rescue — see REVIEW.md)

- **AI citation under doc churn (C18-05)** — remap captured PM positions through edits made while the
  AI answer is in flight (map via `tr.mapping` or guard on a doc fingerprint). Current fix already
  removes the prior `+1` offset bug and clamps to doc size.
- **Single-cell CellSelection TSV (C05-04/05)** — optional `selectedCells.length > 1` guard + a test
  to pin whether a whole-cell single selection should use the TSV path.

> Everything else from `ERRORS.md` (the shipped-UI logistical/UX/a11y/bug defects) is in scope for Phase 3.
