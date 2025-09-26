# Step 01 — Monorepo Scaffolding

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
Generate monorepo: pnpm workspaces or turbo; apps/web, packages/{editor-core,ui,types,testing}. 
Configure eslint, prettier, tsconfig, vitest, playwright. Include CI workflow skeleton (typecheck, unit, e2e).
Add a minimal Next.js page at `/` with a placeholder editor div and title bar.

CONSTRAINTS
- Do not implement editor features yet.
- Provide full file contents for new files.

DELIVERABLES
- Unified diffs for all added/modified files.
- Scripts in root package.json to run lint/test/e2e.
- A passing placeholder e2e test that opens the homepage.

ACCEPTANCE
- CI config present and runnable locally.
- `pnpm i && pnpm build && pnpm test` succeeds on placeholders.
```
