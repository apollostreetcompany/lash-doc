# REPO_MAP

Lash is organized as a PNPM workspace with discrete apps and shared packages. The hierarchy below captures the responsibilities and collaboration hot paths that follow the architecture in `agents.md`.

## Apps (user and service surfaces)
- `apps/web` — Next.js front-end that hosts the editor shell, doc chat, history timeline, share dialogs, and AI interactions. Integrates TipTap/ProseMirror plugins supplied by `packages/editor-core` and talks to collaboration APIs.
- `apps/api` — HTTP/GraphQL edge for document metadata, permissions, history restore, mention lookups, and AI orchestrations. Enforces RBAC and deterministic diff responses.
- `apps/realtime-gateway` — WebSocket/Yjs provider that brokers CRDT updates, presence, and autosave queues. Streams append-only operations into storage snapshots.
- `apps/ai-orchestrator` — Worker service that invokes the AI Edit agent, validates patches, and pushes rationale/citation payloads back through the history log.
- `apps/admin` — Operational console for audit exports, share-link management, and observability dashboards.

## Core Packages (shared across apps)
- `packages/editor-core` — TipTap schema, plugins (outline, markdown, chips, tables, focus mode), keyboard maps, and editor-facing helpers. Guarantees schema validity and selection anchoring.
- `packages/collab-service` — Yjs document bindings, conflict resolution utilities, offline queue replay, and multi-client convergence instrumentation.
- `packages/history` — Append-only log writer, snapshot compaction, deterministic diff engine, and restore APIs.
- `packages/authorship` — Interval tree attribution library, gutter rendering helpers, and blame hover breakdown utilities.
- `packages/mentions` — Mention providers (users/groups/dates), natural language date parsing, chip metadata loaders, and privacy filters.
- `packages/share` — RBAC policy enforcement, share-link signing/expiry, redaction logic for history/chat views, and audit logging hooks.
- `packages/ai` — AI patch validator, selection scope guardrails, rationale/citation formatting, and replayable fixtures for the AI Edit agent.
- `packages/doc-chat` — Thread anchoring utilities, diff-aware context rendering, filters, and history snapshots used by the doc chat panel.
- `packages/tables-media` — Table cell schemas (text/status/select), large-table virtualization helpers, checklist behaviors, and image upload/transform pipelines.
- `packages/testing` — Test harness utilities shared by Vitest, Playwright, property-based runners, and performance smoke tests. Hosts the acceptance gate stubs under `packages/testing/unit` and provides fixtures for e2e.

## Support Packages & Tooling
- `packages/observability` — Metrics, tracing, and logging clients aligned with the performance SLOs.
- `packages/storage` — Postgres schema bindings, object-store adapters, and search index hydration.
- `packages/infra-scripts` — CI workflows, pnpm workspace helpers, and code generation scripts (e.g., schema snapshots, AI prompt scaffolds).

## Hot Paths & Data Flows
1. **Keystroke → Persist:** `apps/web` editor events go through `packages/editor-core`, generate CRDT ops via `packages/collab-service`, stream through `apps/realtime-gateway`, and persist via `packages/history` + `packages/storage`. Authorship attribution from `packages/authorship` tags the ranges before commit.
2. **Outline/Markdown Rendering:** Outline toggles and markdown hotkeys are handled in `packages/editor-core`, with UI surfaces in `apps/web` and persisted collapse state via `apps/api`.
3. **Doc Chat Anchoring:** Chat threads created in `apps/web` call into `packages/doc-chat`, which relies on `packages/history` snapshots and `packages/collab-service` anchors to remain stable across edits.
4. **AI Patch Lifecycle:** User selections from `apps/web` are dispatched to `apps/ai-orchestrator`. The AI agent uses `packages/ai` validators, writes accepted patches through `packages/history`, and labels changes for filtering in `apps/web` and doc chat.
5. **Share & RBAC Checks:** Share dialogs in `apps/web` delegate to `packages/share` via `apps/api`, ensuring redacted history/chat views and audit logging while serving doc content from `packages/history` and `packages/storage`.
6. **Mentions & Chips:** `apps/web` invokes `packages/mentions` to resolve suggestions and chip previews; RBAC filters apply before responses leave `apps/api`.
7. **Tables & Media:** Table interactions flow through `packages/tables-media` for schema enforcement and keyboard handling; heavy tables rely on virtualization helpers to stay within performance budgets.

## Testing Strategy Overview
- **Unit/Property Tests:** Live under `packages/testing/unit`, executed with Vitest; focus on deterministic diffing, authorship intervals, AI validators, IME handling, and multi-client convergence.
- **E2E Tests:** Live under `apps/web/e2e`, executed with Playwright to validate full-stack flows (outline toggles, markdown import/export, share permissions, AI patch UI, accessibility behaviors).
- **Performance & Cross-Browser:** Playwright suites tagged per browser and perf smoke tests, aligned with the SLOs defined in `agents.md`.
- **Fixtures:** Golden documents and history snapshots (to be added in later steps) are shared via `packages/testing` for reproducibility across runners.
