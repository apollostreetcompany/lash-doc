# Step 06 — Tables MVP

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
Implement table node with cell types:
- table/table_row/table_cell{cellType: text|status|select, options?:string[]}
- Keyboard navigation: Tab/Shift+Tab across cells; Enter inserts newline in text cells.
- CSV/TSV copy-paste interop: copy selection as TSV; paste CSV/TSV into selected range.

CONSTRAINTS
- Schema validation on cell types.
- Preserve selection when pasting mismatched ranges (truncate/clip predictably).

DELIVERABLES
- Table schema + node views + keymap.
- Tests:
  - B.1 `table-status-cycle-kb`, `table-select-open-close`
  - B.2 `table-tab-nav`, `table-enter-newline`
  - B.3 `table-copy-out`, `table-paste-in`

ACCEPTANCE
- All B.1–B.3 tests pass.
```
