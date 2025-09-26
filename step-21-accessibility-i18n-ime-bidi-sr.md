# Step 21 — Accessibility + i18n (IME, bidi, Screen Readers)

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
Accessibility and international input:
- IME composition correctness: do not split or autosave mid-composition.
- Bidi paragraphs (AR/HE) cursor movement semantics correct.
- Grapheme-cluster aware operations (emoji, ZWJ).
- Screen-reader support: headings list, diff announcement strings, thread navigation.

CONSTRAINTS
- Deterministic locale/TZ in tests.
- Reduce-motion and high-contrast variants respected.

DELIVERABLES
- Input method guards; bidi-aware cursor utils; SR labels/ARIA.
- Tests:
  - J.2 `ime-composition`, `ime-autosave`
  - J.3 `sr-headings`, `sr-diff-announce`, `sr-thread-nav`

ACCEPTANCE
- All J.2/J.3 tests pass on CI.
```
