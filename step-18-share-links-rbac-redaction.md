# Step 18 — Share Links + RBAC + Redaction

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
Shareable links and permissions:
- Signed links with scopes: view/comment/suggest/edit; optional expiry.
- Org/team RBAC enforcement.
- History/chat redaction for viewers without access; audit logs.

CONSTRAINTS
- Validate token on every request (no client-side trust).
- Watermark optional for view-only (mock in tests).

DELIVERABLES
- Share controller, RBAC checks, Postgres migrations (shares, audits).
- Tests:
  - G.1 `share-comment-scope`, `share-suggest-scope`, `share-edit-scope`
  - G.2 `share-expiry`, `share-audit`
  - G.3 `history-redact`, `chat-redact`

ACCEPTANCE
- All G.* tests pass; no redaction leaks in rendered DOM or APIs.
```
