# Step 22 — Observability + SLOs + CI + Cross‑Browser

> These prompts are **standalone**. Paste the GLOBAL CONVENTIONS preamble, then the step-specific TASK block below into your LLM session.

---

## GLOBAL CONVENTIONS (copy this block first)
```
**GLOBAL CONVENTIONS — Paste at top of every run**

**SYSTEM / RULES**
- You are contributing to a monorepo with strict acceptance tests defined in `agents.md` at the repo root.
- Output **only** a set of *unified diffs* and new/modified file contents. For any new files, include the **complete file body**.
- Every code change **must** include tests (unit and/or e2e) that cover the new behavior.
- Keep changes **scoped to this step**. Do not modify unrelated areas.
- Maintain **schema validity**, **determinism**, **convergence**, **RBAC**, **security**, **accessibility**, and **i18n** invariants from `agents.md`.
- All edits (human or AI) must go through the **same operation pipeline**.
- Selections, decorations, and attribution **must map** correctly after each change.
- After code, append a “**SELF‑CHECK**” section listing which acceptance tests now pass and why.
- If a requirement cannot be completed, produce a minimal vertical slice + TODO tests; **do not hallucinate**.
- Prefer **TypeScript** (strict) for app/back‑end, **Next.js/React** for web, **ProseMirror/TipTap** for editor, **Yjs** for CRDT, **Postgres** for persistence, **Playwright** for e2e, **Vitest/Jest** for unit, **zod** for types.
```

---

## STEP PROMPT (copy this block after the preamble)

```
TASK
Observability and performance governance:
- OpenTelemetry tracing from user action → op apply → broadcast → render commit.
- Metrics: typing latency, diff render time, snapshot load time, Yjs update size, compaction duration.
- CI perf smoke tests with budgets; fail PR on >15% regressions.
- Cross-browser matrix for latest Chrome, Safari, Firefox, Edge + iPad Safari.

CONSTRAINTS
- Low overhead in production; sampling configurable.
- Cross-browser E2E should share fixtures; only adjust drivers.

DELIVERABLES
- Telemetry wiring; Grafana/Tempo/Loki configs (mocked in tests).
- CI workflow updates; perf tests; browser matrix.
- Tests:
  - Performance budgets enforced for typing/diff/snapshot.
  - J.1 `cb-chrome`, `cb-safari`, `cb-firefox`, `cb-edge`, `cb-ipad` smoke pass.

ACCEPTANCE
- CI blocks on budget regressions; cross-browser smoke suite consistently green.
```
