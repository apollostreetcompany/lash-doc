# Step 15 — Suggest Mode + Filtered Diffs

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
Implement Suggest (Track Changes) mode:
- Visuals: insertions (green underline), deletions (red strike).
- Accept/Reject applies patch, logs to history.
- Diff filters: by author (including AI) and time window; shareable URL preserves filters.

CONSTRAINTS
- Suggest mode must generate the same ops as direct edits (flagged intent='suggest').
- Deterministic diff JSON for filtered views.

DELIVERABLES
- Suggestion layer + Accept/Reject + filter UI.
- Tests:
  - D.1 `suggest-visuals`, `suggest-accept`, `suggest-reject`
  - D.3 `diff-filter-author`, `diff-filter-time`, `diff-share-link`

ACCEPTANCE
- All tests pass; filtered links reopen to the same view.
```
