# Step 19 — AI Edit Agent (Patch, Not Paste)

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
Add AI Editor patch flow:
- Define `EditPatch` JSON schema in packages/types with zod.
- Write validator to ensure schema safety, selection-scope default, and attribute preservation.
- Add "Improve Writing" action in apps/web: capture selection → call mock AI provider → receive `EditPatch` → apply via same operation pipeline as human edits → label author as AI Editor with rationale; show Accept/Reject if Suggest mode on.

CONSTRAINTS
- No raw text/HTML from AI; only patches.
- Negative tests for invalid patches (structure-breaking ops, cross-selection edits).
- History log includes `{ intent: 'ai' }`.

DELIVERABLES
- Code diffs and full new files.
- Unit tests for validator and patch application.
- e2e tests for I.1, I.2, I.3.

ACCEPTANCE
- I.1, I.2, I.3 passing. History entries show AI Editor changes filterable in diff view.
```
