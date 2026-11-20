# Lash v1 Release Notes

## Writing and review

Open the [public Documents page](https://lash-9xx.pages.dev/documents/) to
write, find drafts and read earlier versions in this browser. Named sharing
runs in workspaces configured for accounts and collaboration.

- If a save to your account is interrupted, keep writing in the device draft.
  **Check account copy** verifies the existing save. When Lash confirms it,
  you can choose which copy to open. You can also make a separate device
  draft with the current formatted text. Discussion and versions stay with
  the original.
- Choose **Read version** in local History to read an entire earlier draft.
  It preserves supported headings, lists and emphasis. Close it to return to
  the current text. Reading a version does not restore or change the document.
- The page, title and toolbar are readable as soon as the editor renders. On
  phones, closing History returns focus to its button. Widening the window
  releases the drawer so you can keep writing.
- Drag across table cells or extend a range with the keyboard to see which
  cells are selected. Status and select menus stay reachable at the edge of a
  wide table.
- Open **History** beside the document status. A new local draft keeps its
  first saved version when you immediately leave and reopen it. An older
  version stays selected while you review it, even as new versions arrive.
  Long version lists scroll inside the panel so the selected change stays in view.
- Search covers every title in a large library, including older titles stored
  only in the document list. **Show more documents** lets you browse further
  by keyboard.
- A verified save and a failure to update the Documents list now have separate
  messages. You can retry the list update while continuing to write.
- Comments, suggestions, invitations and AI feedback belong to the document
  and draft that requested them. Reopening a panel starts a fresh interaction.

## Collaborative writing candidate

Lash can take a local draft into a shared document. The owner can invite a named
editor, co-edit the title and body, review anchored feedback and suggestions,
restore an earlier version, and revoke the invitation.

- **Write and return.** The Documents page lists recent drafts on this device
  and supports title search. Markdown transfer preserves supported rich
  structure and bounded embedded images. Local history preserves formatting
  when restoring a version.
  You can type straight into a new bullet and paste at the visible text caret
  after returning from a suggestion.
- **Recover a local draft.** History records ordinary edits after the browser
  confirms the draft was saved. If the saved draft and a verified History
  version disagree, you can keep writing and preview the other version's text.
- **Invite a reviewer.** Owners can choose **Can comment** for a verified account.
  The reviewer can select a passage, discuss it and suggest wording. The document
  title and body stay read-only for that reviewer. **Show** highlights the
  quoted passage in the document. Editors can accept or reject the suggestion.
  Revoking access also closes an open reviewer session.
- **Read a shared table.** Public readers see the status and select values the
  author chose, including custom labels.
- **Review a change.** Replies and suggestion decisions survive reopening the
  document. Shared History lets both editors compare versions. Owners can
  restore an earlier body as a new version.
- **Comment on a passage.** Highlight the words and choose **Comment** beside
  them. Post the note in the document, or choose **Open email draft** to send
  the quoted passage and your note to someone you choose in your mail app.
- **Keep feedback on the original words.** When an editor pastes an identical
  phrase beside a quoted passage in the same paragraph, the comment and suggestion
  follow the original passage. For a review affected by a duplicate paste in
  an older build, use **Show** to check the target before accepting.
- **Revise a selection.** On browsers with a ready on-device language model,
  writers can review the proposed wording in context, edit it, and apply it
  to the selected passage. The interface reports when the model is unavailable.
- **Run locally.** `make dev-collab` starts a two-account workspace with a local
  inbox. See the [setup and walkthrough](README.md).

The candidate has been exercised on a compiled local web server with two
independently authenticated browsers. Public rollout and the human 4.5/5
qualification are separate release milestones.

## 2026-05-16 v1

Lash v1 covers the local collaborative-editor acceptance stack in `agents.md`. Riddle remains optional and deferred; this release does not add Lash-Riddle integration code.

## Product Scope

- Rich editor basics: outline collapse/persistence, Markdown import/export and hotkeys, images, checklists, tables, focus mode, autosave, and internal doc-link chips.
- History and change review: append-only history log, deterministic replay/diff, restore, filtered diffs, local suggest-mode accept/reject, and line-level authorship/blame.
- Local collaboration-shaped surfaces: selection-anchored Doc Chat, history/current context switching, orphan handling, author/AI filters, local offline queue replay, reconnect merge, and presence resume. This v1 release does not include cross-browser online typing, websocket rooms, or durable realtime document storage.
- Sharing and references: local signed share links, comment/suggest/edit capability decisions, expiry/audit events, redaction placeholders, RBAC-filtered users/groups, anonymized hidden mentions, and deterministic natural-date chips.
- Quality and accessibility: large-table 100x20 performance gate, named outline navigation, screen-reader diff announcements, keyboard-navigable chat threads, browser compatibility gates, local convergence/selection-stability tests, and IME-safe autosave.
- AI editor: deterministic local `EditPatch` validation, scoped/global patch rules, safe fallback suggestions, rationale, accept/reject, append-only AI-authored history entries, labels, and citations.

## Final Validation

- `pnpm run lint` - pass.
- `pnpm run typecheck` - pass.
- `pnpm run test:unit` - pass, 73 passed.
- `pnpm run test:e2e` - pass, 75 passed.
- `pnpm run build` - pass.
- `make serve` / `make status` - pass, local app available at `http://127.0.0.1:3000`.
- Main CI `build-and-test` - pass on audited release-audit commit `c6ee96e796602834d6795e84d404bf962486ad40`.
- Mechanical acceptance audit - 86 `agents.md` Test IDs, 98 unit/e2e files, no missing IDs.
- Skip/todo audit - no acceptance `test.todo`, `test.skip`, `describe.skip`, `TODO acceptance`, or `.only(` matches in unit/e2e files.

## Release Readiness

- Repository: `https://github.com/apollostreetcompany/lash-doc`.
- Default branch: `main`.
- Product release merge: PR #1, merged at `2026-05-16T06:25:59Z`.
- Final release-audit merge: PR #2, merged at `2026-05-16T06:42:19Z`.
- Audited release-audit commit: `c6ee96e796602834d6795e84d404bf962486ad40`.
- CI workflow: `build-and-test` runs install, skip/todo guard, lint, typecheck, unit tests, Playwright browser install, e2e tests, and build.
- Branch protection: configured on `main` with strict required `build-and-test`, admin enforcement, and no force-push/delete.
- Deployment target: none configured. See `DEPLOYMENT.md` for local run/deploy assumptions.

## Notes

- The implementation is intentionally local-first for v1: history, share/RBAC, Doc Chat, mentions, offline/presence, and AI patch flow are product-valid local contracts with tests, not production multi-tenant services yet. Bead 26 adds the red two-client browser tests that define the online typing gap for the next track.
- Future Riddle work should integrate through stable Lash operation/history contracts after Riddle has its own product shape and Zed integration.
