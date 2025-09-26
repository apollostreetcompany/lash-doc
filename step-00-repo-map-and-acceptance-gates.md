# Step 00 — Repo Map + Acceptance Gates

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
Create two docs at the repo root:
1) REPO_MAP.md — high-level map of apps/packages, their responsibilities, and hot paths.
2) ACCEPTANCE_GATES.md — enumerate all acceptance targets from agents.md (A.1…J.3, G.x, etc.), and map each target to a specific test file path you will create (empty stubs now) under:
   - packages/testing/unit/**/*
   - apps/web/e2e/**/*
Also scaffold empty test files for every Test ID listed in agents.md with a TODO in each.

CONSTRAINTS
- No product code changes; documentation and empty test stubs only.
- Keep a single canonical list of Test IDs; do not rename any.

DELIVERABLES
- Diffs for REPO_MAP.md and ACCEPTANCE_GATES.md.
- Empty test files for every Test ID (with `test.todo` or placeholder describe blocks).
- Update package.json scripts to run full unit/e2e suites (even if all are TODO).

ACCEPTANCE
- All Test IDs from agents.md exist as files.
- `pnpm test` enumerates all stubs without runtime failures.
```
