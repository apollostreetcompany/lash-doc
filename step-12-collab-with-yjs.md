# Step 12 — Collaboration with Yjs

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
Add live collaboration:
- Yjs integration with Hocuspocus or Durable Objects adapter.
- Presence (cursor color/name), offline queue, reconnect merge.
- Minimal security: per-doc room token validation (mocked in tests).

CONSTRAINTS
- Convergence under interleaved edits (2–4 clients).
- Predictable cursor mapping to avoid jumps.

DELIVERABLES
- Collab adapter, presence service, offline queue.
- Tests:
  - H.2 `offline-queue`, `offline-merge`, `presence-resume`
  - H.3 `multi-client-converge`, `selection-stability`

ACCEPTANCE
- All tests pass with seeded, reproducible edit sequences.
```
