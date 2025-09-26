# Step 02 — Editor Schema v1 + Toolbar

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
Implement TipTap schema and toolbar:
- Nodes/marks: paragraph, heading{level:1..3}, bullet_list/ordered_list/list_item, checklist_item{checked}, code (inline), link.
- Toolbar with buttons/hotkeys for bold/italic/underline, H1/2/3, bullets/ordered, checklist toggle, link, inline code.
- Basic selection handling and command wiring.

CONSTRAINTS
- Preserve schema validity and mark exclusivity (e.g., code vs bold).
- Keyboard shortcuts must work on Mac/Windows.
- Keep styles minimal; focus on function.

DELIVERABLES
- Code diffs for packages/editor-core (schema + commands), apps/web (toolbar UI), packages/ui (buttons).
- Unit tests for schema constraints; e2e tests:
  - A.2 `md-h2-shorthand` (hotkey behavior for headings, bold/italic)
  - B.6 `checklist-toggle`, `checklist-nesting` (basic checklist ops)

ACCEPTANCE
- Headings, lists, checklists, code, link all round-trip in the in-memory doc.
- Tests for A.2 and B.6 pass.
```
