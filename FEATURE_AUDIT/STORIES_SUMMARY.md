# Feature Stories — Summary

Reconciled from canonical `FEATURE_AUDIT/STORIES.csv` on 2026-06-24. **201 stories** across **26 clusters**.

`STORIES.csv` remains the single canonical feature-status spreadsheet. This summary is derived from it and must not be treated as a second source of truth.

## Implementation Status

| Status | Count |
| --- | ---: |
| implemented | 163 |
| partial | 17 |
| stub | 18 |
| missing | 3 |

## Test Status

| Status | Count |
| --- | ---: |
| pass | 150 |
| partial | 34 |
| fail | 17 |

## Fix Status

| Status | Count |
| --- | ---: |
| none | 140 |
| fixed | 37 |
| spec-corrected | 4 |
| deferred | 19 |
| partial | 1 |

## Retest Status

| Status | Count |
| --- | ---: |
| pending | 140 |
| pass | 37 |
| n/a | 23 |
| partial | 1 |

## Stories Per Cluster

| Cluster | Name | Stories |
| --- | --- | ---: |
| C01 | Editor shell & document lifecycle | 11 |
| C02 | Toolbar & text formatting | 7 |
| C03 | Headings, outline & collapse | 7 |
| C04 | Markdown import/export & hotkeys | 8 |
| C05 | Tables (cells/nav/copy-paste/perf) | 8 |
| C06 | Images & media | 9 |
| C07 | Checklists / task lists | 7 |
| C08 | Chips (internal links) | 7 |
| C09 | Mentions (users/groups) & privacy | 8 |
| C10 | Natural-date mentions | 6 |
| C11 | Suggest mode | 8 |
| C12 | History timeline / snapshots / restore | 8 |
| C13 | Deterministic & filtered diffs | 6 |
| C14 | Authorship / blame gutter | 8 |
| C15 | Doc chat (anchors/filters/history) | 8 |
| C16 | Share / RBAC / scopes / expiry / audit | 7 |
| C17 | Redaction (history/chat) | 6 |
| C18 | AI patch / guardrails / scope / citations | 7 |
| C19 | Autosave & focus mode | 10 |
| C20 | Offline edits & collaboration (Yjs) | 7 |
| C21 | Realtime worker (rooms/access/persistence) | 9 |
| C22 | Accessibility / IME / i18n / SR | 9 |
| C23 | Observability / SLOs | 4 |
| C24 | Storage | 5 |
| C25 | Sidebar / nav / doc-identity / title | 12 |
| C26 | Insight routing / writing places | 9 |

## Delight Sprint Overlay

The delight sprint did not add new product-feature rows to `STORIES.csv`; it reconciled tracker metadata and produced evidence against the existing feature clusters.

| Feedback ID | Status | Evidence |
| --- | --- | --- |
| VIS-01 | passed | `artifacts/ux-sprint/reports/vis-01-visual-proof.md` |
| CAN-01 | passed with residual UX debt | `artifacts/ux-sprint/reports/product-delight-visual-proof.md` |
| OUT-01 | passed after follow-up | `artifacts/ux-sprint/reports/out-02-document-outline-proof.md` |
| COM-01 | partial | `artifacts/ux-sprint/reports/product-delight-visual-proof.md` |
| FMT-01 | guarded | `artifacts/ux-sprint/reports/product-delight-visual-proof.md` |
| MOB-01 | passed | `artifacts/ux-sprint/reports/product-delight-visual-proof.md` |
| ROU-01 | passed | `artifacts/ux-sprint/reports/rou-01-unit.log` |
| INF-02 | passed | `artifacts/ux-sprint/reports/inf-02-cloudflare-realtime-proof.md` |
| INF-01 | concerns | `artifacts/ux-sprint/reports/inf-01-render-runtime-proof.md` |
| TRK-01 | passed | `artifacts/ux-sprint/reports/trk-01-validate.log` |

## Current Product Gaps

- COM-01: comments/chat are calmer but still need stronger document-range anchoring.
- INF-01: Render Blueprint and local dynamic runtime preflight pass, but live service creation remains a Dashboard/API apply step in this environment.
- INF-02: Cloudflare realtime Worker is deployed and publicly healthy, but production document sessions remain closed until shared invite/session secrets are wired.
- Deferred backend/storage/observability scaffolds remain tracked in `FEATURE_AUDIT/DEFERRED.md`.
