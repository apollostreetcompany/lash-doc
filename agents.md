<!-- BEGIN LASH EXECUTION GOVERNANCE -->

# AGENTS.md - Lash

## 1. Mission (North Star)

Lash is a calm, trustworthy collaborative document editor for ordinary writing
work. The numbered goals are:

1. Make creating, finding, writing, and formatting a document feel immediate.
2. Make sharing, co-editing, commenting, suggesting, saving, and recovery
   understandable without setup knowledge or moderator coaching.
3. Preserve document content, access boundaries, deterministic history, and
   schema validity under every human, programmatic, and AI edit.
4. Reach and retain the blind-stranger 4.5/5 product-quality gate defined in
   [`docs/plans/lash-stranger-test-45-criteria.md`](docs/plans/lash-stranger-test-45-criteria.md).
5. Keep `main` deployable and keep product claims no stronger than the evidence.

The normative user-visible product contract is preserved in
[`AGENTS-archive-v1.md`](AGENTS-archive-v1.md). This file governs how agents
execute that contract. On this case-insensitive checkout, `AGENTS.md` and
`agents.md` resolve to the same inode, so they cannot hold separate contents.
[`CONTINUITY.md`](CONTINUITY.md) records current truth and decisions; dated
implementation-status text in the product contract must not override newer
ledger evidence. The pre-Bead-38 combined governance/product copy is preserved
in [`AGENTS-archive-v1.md`](AGENTS-archive-v1.md).

Riddle is outside Lash implementation unless the project owner explicitly
authorizes an integration bead.

## 2. Core Architecture

```text
Browser
└── apps/web (Next.js + React)
    ├── TipTap/ProseMirror editor and document routes
    ├── document-side outline, history, chat, share, presence, and AI panels
    └── local document metadata and local-only persistence paths
        │
        ├── packages/editor-core, history, authorship, doc-chat
        ├── packages/share, rbac, mentions, tables-media, ai
        └── packages/types, storage, observability, insight-router
                │
                └── packages/realtime-worker
                    └── Cloudflare Durable Object per document
                        ├── Yjs WebSocket sync and awareness
                        └── SQLite update log, snapshots, and append-only restore
```

The editor and realtime paths share Yjs operations; human and AI changes must
preserve the schema and history invariants in `AGENTS-archive-v1.md`. Render configuration
provides a dynamic Next.js runtime shape, while Cloudflare Pages remains the
known public static test surface. Do not claim production collaborative daily
driving until a live dynamic URL, production secrets, and a deployed
two-collaborator smoke are evidenced in the ledger.

Repository ownership by surface:

- `apps/web`: browser product, routes, interaction, and Playwright journeys.
- `packages/editor-core`: schema, commands, outline, markdown, tables, and media.
- `packages/realtime-worker`: access boundary, Durable Object room, sync, and
  persistence.
- `packages/testing`: deterministic unit, property, and contract coverage.
- `artifacts/`: durable screenshots, recordings, traces, and outcome receipts.
- `docs/plans/`: falsifiable product and execution contracts.
- `handoff/`: machine-readable bead evidence and release handoff state.

## 3. Tech Stack

| Layer               | Choice                 | Specifics                                                     |
| ------------------- | ---------------------- | ------------------------------------------------------------- |
| Runtime             | Node.js                | Node 22 in CI and Render                                      |
| Language            | TypeScript             | TypeScript 5.4.5                                              |
| Package manager     | pnpm                   | pnpm 8.10.0 with frozen lockfile in CI                        |
| Web                 | Next.js + React        | Next.js 14.2.5; React 18.3.1                                  |
| Editor              | TipTap / ProseMirror   | TipTap 2.4.x; schema-safe operations                          |
| Collaboration       | Yjs                    | Yjs 13.6.x over room-scoped WebSockets                        |
| Realtime runtime    | Cloudflare Workers     | Durable Objects, SQLite storage, Wrangler 4.97.x              |
| Dynamic web runtime | Render                 | `next start` bound to `0.0.0.0:$PORT`                         |
| Unit/property tests | Vitest                 | Vitest 1.6.x and deterministic fixtures                       |
| Browser tests       | Playwright             | Playwright 1.55.x; Chromium, Firefox, WebKit, mobile projects |
| Quality gates       | ESLint, TypeScript, CI | Strict `build-and-test` required on protected `main`          |

Manifest and lockfile versions are authoritative when this table becomes stale.
Use Context7 for current library/API documentation before generic web search.

## 4. Agent and Sub-Agent Profiles

- **Product/Stranger-Test Lead:** owns blind protocols, source-faithful task
  cards, scoring, evidence integrity, and outcome recommendations.
- **Frontend Product Engineer:** owns `apps/web` interaction, visual calm,
  responsive behavior, accessibility, and browser proof.
- **Editor Core Engineer:** owns schema, commands, markdown, outline, tables,
  media, selection behavior, and edit-pipeline invariants.
- **Collab & History Engineer:** owns Yjs convergence, persistence, awareness,
  history, restore, anchors, and multi-client tests.
- **Share & Security Engineer:** owns invite/session grants, RBAC, privacy,
  redaction, and negative access tests.
- **Performance/QA Analyst:** owns latency instrumentation, property tests,
  cross-browser coverage, stranger-run receipts, and regression triage.
- **DevOps Engineer:** owns Render, Cloudflare, secrets, runtime binding, health
  checks, deployment evidence, and rollback.
- **Architect:** approves contract, schema, security, and runtime design before
  high-risk implementation.
- **Independent Reviewer/Analyst:** checks completeness, quality, consistency,
  test sufficiency, security posture, and product-outcome evidence.

### Hybrid Agent Selection Policy (Mandatory)

Default behavior:

- Use contextual/dynamic agent selection for low-risk and single-domain beads.

Hard guardrails (must override dynamic choice):

- If a bead changes schema/migrations, auth/policy/security logic, public API
  contracts, or deployment/runtime, the required path is Architect review,
  domain Engineer implementation, then Analyst review.
- If a bead includes a Figma URL/node or visual-parity requirement, the required
  implementer is a Frontend Engineer with Figma tool access.
- If a bead touches Render, Cloudflare, secrets, ports, infra configuration, or
  another deploy target, the required implementer is a DevOps Engineer or
  equivalent deploy specialist.

Selection protocol per bead:

1. Choose the primary agent from the concrete scope and acceptance proof.
2. Record chosen agent, selection reason, confidence (`low`, `medium`, or
   `high`), and fallback agent in the bead summary and evidence.
3. If confidence is low or the bead spans multiple domains, split the bead or
   escalate to the Architect before implementation.

Dynamic selection cannot bypass the hard guardrails.

## 5. Branching & Commits

- GitHub remote: `https://github.com/apollostreetcompany/lash-doc.git`.
- Default branch: protected `main`; never commit directly or force-push to it.
- Branch naming: `codex/<type>/bead-N-description`, where type is normally
  `feat`, `fix`, `ux`, `test`, `docs`, or `chore`.
- Commit naming: `<type>(bead-N): description`.
- Commit body must include `Why:` and a concise evidence summary.
- Add `Co-authored-by:` when a contributing agent identity is available.
- One bead is one atomic logical commit; stage relevant files only and inspect
  `git diff --staged` before commit.
- Push every completed bead immediately. Use protected pull requests, required
  `build-and-test`, squash merge only, `git pull --rebase` before merge, and
  delete merged branches.
- Do not weaken, skip, or mark tests pending to obtain a green branch without
  explicit approval.

## 6. Continuity Ledger

`CONTINUITY.md` is the append-only decision and state ledger. Read it at the
start of every turn and update it as decisions or state transitions occur, not
only at closeout. Preserve this exact heading structure:

```text
# CONTINUITY.md - Lash
## Goal (incl. success criteria)
## Constraints/Assumptions
## Key Decisions
## State
### Done
### Now
### Next
## Open Questions
## Working Set
```

- Append numbered key decisions; never silently delete or rewrite history.
- Mark evidence gaps `UNCONFIRMED`.
- **Beads** are atomic work units with acceptance evidence and a commit.
  **Ledger entries** are durable decisions/state; they are not substitutes for
  bead proof.
- `handoff/beads.jsonl` is the machine-valid bead receipt ledger and must match
  `handoff/beads.schema.json`.
- `HANDOFF.md` carries the compact human handoff and must be current before
  compaction or ownership transfer.
- `MISTAKES.md` records repeated mistakes and anything the project owner labels
  with the word “oops”; do not store secrets.
- Every implementation/review reply starts with a Ledger Snapshot containing
  current bead, done count, test state, and blockers. Post the required bead
  completion or failure summary after each bead.

## 7. Workflow

### Bead Entry Gate (Mandatory)

Implementation does not start until all are explicit:

1. Bead scope, user outcome, and falsifiable acceptance tests/proofs.
2. Primary and fallback agents selected under the Hybrid Agent Selection Policy.
3. Required tools and evidence paths declared, including RepoPrompt and any
   Figma, browser, device, deployment, or current-docs tool.
4. Risk class declared:
   - `Low`: single domain with no contract, security, schema, or deploy impact.
   - `Medium`: multi-file or multi-domain without a hard-guardrail trigger.
   - `High`: any schema, security/policy, public API, deployment, or runtime
     trigger.
5. Owned paths, out-of-scope paths, rollback, and a single ledger writer named.
6. Baseline tests or current proof run; code beads have a fail-first test unless
   the project owner explicitly approves a non-code exception.

### Execution Loop

1. Read `AGENTS.md`, `CONTINUITY.md`, `MISTAKES.md`, and the relevant product
   contract in `AGENTS-archive-v1.md`.
2. Bind RepoPrompt to the exact worktree and inspect current status, code map,
   owners, tests, and overlapping edits. Stop if repo or scope does not match.
3. Check port collisions before starting services. Keep `Makefile` or `scripts/`
   current with one-command run and verification paths.
4. For code, use TDD: establish the relevant baseline, write the expected
   input/output test, confirm it fails for the intended reason, implement
   minimally, and rerun the targeted suite. Never use `skip` or `xfail` without
   approval; use deterministic fixtures.
5. For product UI, capture the smallest useful human-visible before/after
   boundary and accessibility/interaction notes.
6. Review completeness, quality, consistency, tests, security, and whether the
   change improves experienced product behavior rather than only scaffolding.
7. Update `CONTINUITY.md` before advancing to the next bead; then validate,
   commit, push, and append the bead receipt.

Validation matrix:

| Workstream        | Required validation                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Code              | lint/format, typecheck, targeted tests, and risk-class integration scope                              |
| Docs/process      | Markdown check if configured, internal-link/path check, and policy consistency across canonical files |
| Design/UI         | design source, screenshot/recording receipt, interaction notes, and accessibility notes               |
| Research/analysis | source inventory, labeled assumptions, falsifiable recommendation, and tradeoffs                      |
| Ops/deploy        | preflight, lockfile/manifests, `0.0.0.0:$PORT`, health/smoke checks, and documented rollback          |

Risk/test scope:

- Low: changed-module checks and targeted tests.
- Medium: changed-module checks plus relevant integration/contract tests.
- High: full required suite, security/contract checks, and independent reviewer
  sign-off before merge.

For blind-stranger work, automated tests and documentation are scaffolding
evidence only. A 4.5/5 product claim requires the complete outcome predicate in
`docs/plans/lash-stranger-test-45-criteria.md`.

### Bead Exit Gate (Mandatory)

A bead is complete only when:

1. Required tests and proofs pass for its risk class.
2. Reviewer checklist covers completeness, quality, consistency, test
   sufficiency, security, and the intended user outcome.
3. Product/UI beads have a durable visual or interaction receipt.
4. `CONTINUITY.md`, `HANDOFF.md` when relevant, and `handoff/beads.jsonl` are
   updated by their designated writer.
5. The chat bead summary is posted with changes, commands/results, concise
   outcome, and `Approved`, `Concerns`, or `Failed`.
6. The atomic commit is pushed and protected CI is green before merge.

## 8. Orchestration

Use the vetted skill library before inventing an ad hoc workflow.
`release-feedback-reactor` governs source-faithful feedback, stable IDs, proof
obligations, outcome receipts, and review gates. RepoPrompt is the default for
workspace mapping, file context, git review context, and code ownership.

### Spawn Contract (Mandatory)

Every spawned-agent prompt includes:

1. Owned files/paths and the single-writer rule for shared ledgers.
2. In-scope and out-of-scope work.
3. Stable feedback/bead IDs and durable raw source artifacts.
4. Source evidence with file/line or artifact references.
5. Required tools, skills, models when mandated, and safety constraints.
6. Risk class and selection rationale.
7. Acceptance tests/proofs, human-visible boundary proof, and expected receipt
   paths.
8. Stop conditions, rollback, and review gate.
9. Expected report fields: changes made; files touched; commands and results;
   assumptions/risks; findings; follow-up recommendations.

Agents may spawn independent specialists when paths and outputs do not overlap.
Parallel implementers must not edit the same file. Only the designated writer
updates a shared ledger; other agents return proposed rows.

### Escalation Rules

Architect sign-off is required before implementation when:

1. Public API shape changes.
2. Data schema or migrations change.
3. Auth, permission, privacy, or security semantics change.
4. Deployment architecture, secrets, ports, persistence, or runtime behavior
   changes.
5. A product decision would invalidate a normative `AGENTS-archive-v1.md` acceptance
   contract or the stranger-test protocol.

Ask the project owner before destructive data actions, irreversible public
changes, architecture pivots, or intentional acceptance-contract reductions.
Minor review concerns may be recorded and continued; quality failures must be
retried; critical failures pause the bead. Tool/model timeouts and partial
reviews remain partial evidence and may not be represented as completed review.

<!-- END LASH EXECUTION GOVERNANCE -->

<!-- BEGIN BLIND-STRANGER 4.5/5 QUALITY GATE -->

## Blind-Stranger 4.5/5 Outcome Gate

`STR-GATE-45` is the product-level qualification gate for normal collaborative
document work. Its normative run contract is
[`docs/plans/lash-stranger-test-45-criteria.md`](docs/plans/lash-stranger-test-45-criteria.md).

- The archived product contract defines capabilities, invariants, and technical
  SLOs.
- The stranger-test contract defines participants, zero-coaching journeys,
  evidence, scoring, hard failures, and the exact 4.5/5 pass predicate.
- Automated and visual tests prove mechanics; they do not prove a blind-stranger
  outcome.
- A qualifying build may retain small non-blocking polish defects, but never
  loss, broken collaboration, dead primary controls, access leaks, misleading
  save/sync state, or a private setup dependency.

Only a fixed release candidate with complete blind-run receipts satisfying
every conjunct in `STR-GATE-45` may be described as meeting the 4.5/5 gate.

<!-- END BLIND-STRANGER 4.5/5 QUALITY GATE -->
