# Lash

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

The full writing, collaboration, privacy, accessibility and performance contract lives in
[AGENTS-archive-v1.md](AGENTS-archive-v1.md). Use its acceptance examples to decide
what a writer should experience. Use observations from the current build to describe
what works today. Riddle integration needs a separate product decision.

## Work from the writer’s journey

Start at the ordinary browser entry. Create a document, leave and find it again,
write and format, invite a second person, exchange edits and feedback, interrupt
the connection, reopen, and inspect the export. Choose the first broken outcome.
Record the expected result and reproduce the defect. Make a focused change and
repeat that journey. For browser changes, check keyboard interaction and the phone
layout. A local fixture, two live browser sessions, a deployed trial and a blind
participant run each answer different questions. Name which one you ran.

## Where to change things

| Surface                                                | Owner and boundary                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `apps/web`                                             | Next.js routes, writing UI, local drafts, account entry and Playwright journeys       |
| `packages/editor-core`                                 | TipTap schema, commands, rich text, outline and Markdown                              |
| `packages/realtime-worker`                             | Cloudflare Worker and one Durable Object per room, authority, Yjs and durable updates |
| `packages/history`, `packages/doc-chat`, `packages/ai` | Document history, anchored review and validated AI edits                              |
| `packages/testing`                                     | Unit, property and integration tests                                                  |
| [DEPLOYMENT.md](DEPLOYMENT.md)                         | Runtime configuration, staging checks and rollback                                    |

Keep access checks on the server. Verify the caller before reading or changing
shared data. Preserve schema, content, history and access across human and AI edits.
Show whether work is local, shared, pending, saved or recovering based on what
the storage or room has acknowledged. Treat the manifest and lockfile as the
version reference.

## Run and verify

Use Node 22 and the pnpm version in `package.json`. Install with
`pnpm install --frozen-lockfile`. Start the writing app with
`pnpm --filter @lash/web dev`; use `make realtime-dev` for a local Worker.
Account and collaboration setup is in [DEPLOYMENT.md](DEPLOYMENT.md).
Run `pnpm run lint`, `pnpm run typecheck` and the relevant Vitest and
Playwright journeys. Record the release build and browser used for performance
measurements. Compare the same interaction, workload and units to the original
budgets. Keep an observed regression open until its repair is measured.

Give each implementation one owner. Parallelize independent paths and coordinate
edits to the editor workspace. For changes to access, persistence, schema, public
interfaces or deployment, review the design before implementation and have an
independent reviewer check the result before integration. A useful review names
what could fail for a writer and tests it.

## Ship and hand off

Use a topic branch and a protected squash PR to `main`. Integrate current main,
review the staged diff and require the `build-and-test` check. Keep test credentials,
private discussion, downloaded competitor media and machine-local reports off the
public remote. Preserve unrelated work. One change should describe one usable outcome.

Track the active outcome and consequential decisions in [CONTINUITY.md](CONTINUITY.md).
Append a short evidence row to [handoff/beads.jsonl](handoff/beads.jsonl) for a
delivered bead. Keep [HANDOFF.md](HANDOFF.md) current at transfer. Link to the
test, PR or artifact once. Fresh screenshots are appropriate when the interface
changes. Preserve historic records and resumable user data.

Serialize local Next builds, dev servers and browser runs sharing the same
`apps/web/.next` output. Check the port and stop only servers you own. Local
builds check available disk space before writing. Keep dependencies, compiler
outputs and ordinary test results outside Git. Inspect the candidate Git ref for
tracked generated output before adding a full worktree.

Use the [blind qualification protocol](docs/plans/lash-stranger-test-45-criteria.md)
for a 4.5/5 claim. For a competitor simulation, freeze the same tasks on both sides,
state what was observable, and keep timings from edited footage out of the score.
