# Lash Blind-Stranger Fresh-Eyes Audit — 2026-07-18

## Outcome

The current default local product is **not eligible for a 4.5/5 stranger result**. It has three hard trust failures:

1. A document reports **“All changes saved · just now”** and loses its full body on reload.
2. An owner can copy an active edit invite, but a clean invitee sees **“Access granted: edit”** on an untitled, blank, **“Local only”**, **“Solo”** document.
3. Mobile Focus Mode replaces the writing surface with an empty viewport and leaves its exit control off-canvas.

The editing core itself is promising. Creating a document was quick, human-speed typing was responsive, `## ` became an H2, the outline updated, and a selected range produced a visibly anchored comment thread. Those successes cannot offset data-loss and collaboration-truth failures.

This was a zero-coaching product walkthrough, not an inference from existing tests.

## Frozen Audit Contract

- Goal: identify the smallest high-value product changes that move ordinary collaborative writing toward a blind-stranger 4.5/5 experience.
- Baseline: `002333017fe2bca4ec589f8d157c1aa21a4b77da`
- Branch: `codex/ux/bead-38-stranger-45-sprint`
- Worktree: `/Users/borker/dev/lash-doc`
- Raw objective: `artifacts/stranger-test/raw/user-objective-2026-07-18.md`
- Runtime: local production Next.js build at `http://127.0.0.1:3000`
- Viewports: desktop `1440x900`; mobile `375x812`
- Browser: Playwright Chromium 1.55.1, isolated contexts with empty local storage
- Out of scope: code/config changes, deployment, live-service mutation
- Evidence: `artifacts/stranger-test/baseline/`

## Environment and Commands

Environment:

- macOS 26.2 (25C56)
- Node `v22.18.0`
- pnpm `8.10.0`
- Playwright `1.55.1`
- No `NEXT_PUBLIC_LASH_REALTIME_URL` or `LASH_REALTIME*` variable was present in the audit shell.

Preflight and runtime:

```text
git status --short --branch
git rev-parse HEAD
lsof -nP -iTCP -sTCP:LISTEN
ps -axo pid,ppid,etime,command | rg 'next (dev|start)|wrangler|lash-web|playwright'
make serve
```

Results:

- Port `3000` and Wrangler’s usual port `8787` were free.
- No Next or Wrangler service was running.
- `make serve` completed typecheck and a production Next build successfully.
- The app became healthy at `http://127.0.0.1:3000` in tmux session `lash-doc-web`.
- The worktree already contained primary-agent changes to `CONTINUITY.md` and the raw objective before this lane began; they were not touched.

Walkthroughs used fresh Playwright browser contexts and normal visible controls. Data-testid selectors were used only to make repeated interaction deterministic after the first visual inspection. Screenshots were manually inspected at original resolution.

## No-Coaching Assumptions

- A stranger receives only the URL. They are not told that the blank dot is an editor, that “Local only” invalidates the prominent Share affordance, or that realtime requires an opt-in URL/Worker.
- The stranger reasonably trusts “All changes saved.”
- “Share,” “Create invite,” “active,” and “Access granted: edit” imply that another person will receive the current document.
- Icons may rely on familiar conventions, but a visible menu button should reveal navigation and an active tab should reveal its named section.
- Mobile validation is viewport-level. A software keyboard was not emulated, so keyboard occlusion remains unknown.

## Task Outcomes and Friction

| Task                  | Outcome              | Timing / friction                                                                                                                                                                 | Evidence                                                                       |
| --------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Enter app             | Partial pass         | Desktop reached network idle in 580 ms; mobile in 538 ms. Empty body has no prompt, only a tiny dot.                                                                              | `desktop-overview-settled.png`, `mobile-overview-settled.png`                  |
| Create document       | Pass                 | New route appeared about 117 ms after activating `+`.                                                                                                                             | `desktop-writing-before-reload.png`, `mobile-writing-after-create.png`         |
| Title and write       | Pass before reload   | Title and human-speed body typing worked. Mobile text wrapped cleanly.                                                                                                            | `desktop-writing-before-reload.png`, `mobile-writing-after-create.png`         |
| Format content        | Pass                 | `## ` became an H2, outline count became one, and Bold applied to the selected range.                                                                                             | `desktop-formatting-success.png`                                               |
| Reload and recover    | **Hard fail**        | After the UI reported saved, reload retained the title but removed the entire body and reset history to zero.                                                                     | `desktop-reload-body-lost.png`                                                 |
| Navigate / reopen     | Partial fail         | The title registry/select exists, but saved document bodies cannot be trusted. Desktop’s visible menu button only dims the app. Most nav destinations are disabled “coming soon.” | `desktop-sidebar-coming-soon.png`                                              |
| Create comment        | Pass with friction   | Selecting text enabled New thread; activation immediately created an anchored thread and marker. The first meaningful comment is entered afterward as a reply.                    | `desktop-comment-compose.png`                                                  |
| Share / invite        | **Hard fail**        | Owner gets “Copied invite link” and an active edit collaborator. A clean invitee gets edit access but no title or body.                                                           | `desktop-invite-created-local-only.png`, `desktop-invitee-link-no-content.png` |
| Collaboration honesty | Fail                 | The owner and invitee both show “Local only” and “Solo,” but Share remains fully actionable and grants access language.                                                           | `desktop-share-local-only.png`, `desktop-invitee-link-no-content.png`          |
| Focus Mode            | **Mobile hard fail** | Tapping Focus produces a blank viewport; the exit control exists in the DOM but is outside the viewport and cannot be clicked.                                                    | `mobile-focus-mode.png`                                                        |
| Mobile writing        | Partial pass         | Create/title/write is usable after the entrance settles. Metadata is cramped and formatting controls require horizontal discovery.                                                | `mobile-overview-settled.png`, `mobile-writing-after-create.png`               |

## Stable Feedback Matrix

### STR-FLOW-01 — “Saved” local document body is erased on reload

- Severity: **P0**
- Classification: data loss / recovery / trust
- Reproduction:
  1. Open `/` in a clean browser profile.
  2. Create a document with `+`.
  3. Enter a title and several body paragraphs.
  4. Wait for **“All changes saved · just now.”**
  5. Reload the same `/doc/<id>` URL.
- Observed: title remains; body becomes empty; history changes from one visible version before reload to zero after reload; status still says **“All changes saved · just now.”**
- Product impact: a stranger can lose their work on the first session while the product explicitly reassures them it is safe.
- Evidence: `desktop-writing-before-reload.png`, `desktop-reload-body-lost.png`
- Proof obligation for a fix: local body, title, and last-good revision survive reload and a new browser launch; corrupt saved JSON preserves a recoverable last-good snapshot; the saved indicator cannot turn green before the body is durable.

### STR-FLOW-02 — Edit invite opens a blank, unrelated-looking document

- Severity: **P0**
- Classification: collaboration / misleading state / trust
- Reproduction:
  1. Create `Shared launch brief`.
  2. Write `Maya owns the launch checklist and the Friday review.`
  3. Activate Share.
  4. Invite `maya@example.com` with `edit`, expiry `never`.
  5. Open the copied URL in a clean browser context.
- Owner wording: **“Copied invite link”**, `maya@example.com`, `edit`, `active`.
- Invitee wording: **“Access granted: edit”**, **“Untitled document”**, **“Local only”**, **“Solo”**.
- Observed: invitee body is blank and contenteditable; no owner title or text is present.
- Product impact: the primary collaborative promise fails while both sides receive success language.
- Evidence: `desktop-share-local-only.png`, `desktop-invite-created-local-only.png`, `desktop-invitee-link-no-content.png`
- Proof obligation for a fix: either disable invite creation with a precise “realtime unavailable” explanation on local-only documents, or ensure a clean second browser hydrates the same title/body and converges before any success wording is shown.

### STR-FLOW-03 — Mobile Focus Mode blanks the app and strands its exit

- Severity: **P1**
- Classification: mobile interaction / layout
- Reproduction:
  1. Open at `375x812`.
  2. Wait for the entrance animation to settle.
  3. Tap the square-corners Focus control.
- Observed: the document and all useful chrome disappear, leaving an empty light-gray viewport and a small orange sliver at the top left. The `Exit focus mode` control is outside the viewport; Playwright repeatedly reported “element is outside of the viewport.”
- Product impact: an optional calm-writing feature becomes a session trap on phone.
- Evidence: `mobile-writing-after-create.png`, `mobile-focus-mode.png`
- Proof obligation for a fix: focused editor and title remain visible at `375x812`; a 44px exit control remains on-screen and keyboard reachable; entering and exiting preserves selection and scroll.

### STR-FLOW-04 — Share “tab” opens a long mixed rail instead of Share

- Severity: **P1**
- Classification: information architecture / layout
- Reproduction:
  1. Activate the top Share control on mobile or desktop.
  2. Observe the active Share tab.
  3. Try to reach email, role, expiry, and Create invite.
- Observed:
  - Mobile Share is marked active, but the drawer begins with Doc Chat, History, and AI; Share starts near the bottom of the first viewport.
  - The mobile rail is 1,447 px tall inside a 759 px body.
  - On desktop, reaching invite fields scrolls the whole page, removing the document canvas from view and leaving a mostly empty screen beside the rail.
- Product impact: the action the stranger requested is not the surface they receive; collaboration pulls them away from document context.
- Evidence: `mobile-share-drawer.png`, `desktop-share-local-only.png`, `desktop-invite-created-local-only.png`
- Proof obligation for a fix: tabs render one section at a time (or scroll the named section to the top); rail scroll is independent of the document canvas; topbar and document stay spatially stable.

### STR-VIS-01 — Empty editor gives no invitation to write

- Severity: **P1**
- Classification: first-run UX / discoverability
- Reproduction: open a clean document and wait for the UI to settle.
- Observed: the large white paper contains a title, metadata, and a tiny low-contrast dot where body input begins. There is no “Start writing,” sample line, caret invitation, or quiet empty-state guidance.
- Product impact: the most important action in the product requires guessing the clickable region, while Chat/History/AI/Share occupy substantial visual weight.
- Evidence: `desktop-overview-settled.png`, `mobile-overview-settled.png`
- Proof obligation for a fix: an empty paragraph exposes a calm placeholder, clicking the paper focuses it, and typing replaces the placeholder without layout shift.

### STR-FLOW-05 — Desktop menu button only dims the product

- Severity: **P1**
- Classification: navigation / dead control
- Reproduction:
  1. At `1440x900`, activate the visible hamburger beside the Lash mark.
  2. Observe the sidebar.
- Observed: a gray backdrop covers the viewport, but the 64 px icon rail does not expand and no menu appears. The actual sidebar expand control is below the initial fold because shell height follows the long rail. Home, Inbox, Starred, Shared with me, All documents, and Settings are disabled with “coming soon” titles.
- Product impact: a familiar primary-navigation control appears broken; reopening or locating work feels unfinished.
- Evidence: `desktop-sidebar-coming-soon.png`
- Proof obligation for a fix: hide the mobile-only control on desktop or make it reveal a usable drawer; keep the real expand control in the viewport; disabled destinations should not masquerade as primary navigation.

### STR-FLOW-06 — Very rapid typing can reorder a paragraph’s first character

- Severity: **P2**
- Classification: input correctness / performance
- Reproduction:
  1. Type `Alpha`, press Enter.
  2. Type `Risks and recovery` with 0–20 ms key spacing.
- Observed: `isks and recoveryR`. At 50–100 ms spacing the phrase remained correct.
- Product impact: automation-speed or burst input can corrupt text. This was not reproduced at ordinary 50+ ms humanized spacing, so the user-facing frequency is unconfirmed.
- Evidence: `desktop-writing-before-reload.png` also shows `isks: ... recovery.R`.
- Proof obligation for a fix: a deterministic fast-input test preserves character order across paragraph creation without weakening typing-latency gates.

### STR-VIS-02 — Mobile entrance sweeps the collaboration rail across the editor

- Severity: **P2**
- Classification: motion / first impression
- Reproduction: capture the first mobile frame after network idle, then compare after 1.2 seconds.
- Observed: the mixed collaboration rail temporarily covers nearly the whole viewport before translating off-screen. The settled state is usable.
- Product impact: first paint reads as “chat/admin panel” before it becomes a writing app.
- Evidence: `mobile-overview-fresh.png`, `mobile-overview-settled.png`
- Proof obligation for a fix: a closed mobile rail begins closed; any entrance motion affects only intentional chrome and respects reduced motion.

## Top Five Rapid Product Improvements

| Rank | Feedback    | Stranger-perceived value                                                  | Cost                                            | Recommended change                                                                                                                                                              |
| ---- | ----------- | ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | STR-FLOW-01 | Very high: prevents first-session data loss and restores trust in “saved” | Medium                                          | Implement per-document local body persistence, last-good recovery, and an honest pending/saved/error state.                                                                     |
| 2    | STR-FLOW-03 | High: removes a phone session trap                                        | Low–medium                                      | Make Focus Mode a viewport-safe editor state with a persistent 44px exit.                                                                                                       |
| 3    | STR-FLOW-02 | Very high: prevents false collaboration success                           | Low for honest gating; high for real deployment | Immediately gate Share on local-only docs with explicit next action, then complete deployed two-browser hydration/convergence.                                                  |
| 4    | STR-VIS-01  | High on every first run                                                   | Low                                             | Add a calm body placeholder and paper-wide focus target.                                                                                                                        |
| 5    | STR-FLOW-04 | High for ordinary comment/share work                                      | Medium                                          | Make the rail viewport-contained and truly tabbed; keep document context stationary. Include STR-FLOW-05 shell-height/menu repair in the same shell bead if ownership overlaps. |

## Recommended First Product Bead

**Local Body Persistence + Honest Save Recovery (STR-FLOW-01 / NM-05).**

Acceptance:

1. A new local document’s ProseMirror JSON persists by document ID.
2. Title and body survive reload and a fresh browser launch.
3. The UI cannot show **“All changes saved”** until the durable write succeeds.
4. A malformed latest record falls back to a last-good snapshot with a visible recovery notice.
5. Realtime-enabled documents do not receive an ambiguous second local write path.
6. Fail-first browser proof reproduces the current loss, then passes at desktop and mobile.
7. Before/after screenshots use the same written document and reload boundary as this audit.

Why first: it is the highest-value medium-cost repair, it unlocks honest solo daily writing immediately, and it prevents later collaboration/UI polish from sitting on top of a data-loss foundation.

## Runtime Truth

| Surface                    | Status during this audit                                | What a stranger actually gets                                                                                          |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Next web app               | **Local-only, running**                                 | Production build on `127.0.0.1:3000`; ordinary editor UI available.                                                    |
| Local title/registry       | **Local-only, working**                                 | Document IDs and titles persist in browser storage.                                                                    |
| Local body/history         | **Local-only, not durable**                             | Body and visible history disappear on reload despite saved wording.                                                    |
| Realtime collaboration     | **Wrangler-backed but unavailable in this default run** | No Worker was started or configured; UI says Local only/Solo.                                                          |
| Local invite UI            | **Misleading bridge behavior**                          | Signed-looking link and access scope work locally, but a clean invitee receives no shared document state.              |
| Cloudflare Pages site      | **Previously live-deployed; not this audit target**     | `https://lash-9xx.pages.dev/` is recorded in project continuity, but was not used as proof for this commit.            |
| Cloudflare realtime Worker | **Previously live-deployed; not connected here**        | Project records a healthy Worker, but production document sessions remain intentionally closed without shared secrets. |
| Dynamic Render web runtime | **Unavailable / unconfirmed**                           | Blueprint/preflight exists; live service creation is still recorded as pending.                                        |
| Sidebar destinations       | **Stub/unavailable**                                    | Most primary-looking destinations are disabled “coming soon.”                                                          |

No claim of live collaborative success is supported by this audit. The correct deployed proof remains a two-clean-context invite/edit/comment/reload/convergence smoke on the live dynamic URL.

## Evidence Index

- `desktop-overview-fresh.png` — first network-idle frame
- `desktop-overview-settled.png` — authoritative settled desktop overview
- `mobile-overview-fresh.png` — transient rail-crossing first frame
- `mobile-overview-settled.png` — authoritative settled mobile overview
- `desktop-writing-before-reload.png` — written body and one visible version before reload
- `desktop-reload-body-lost.png` — same route/title, empty body and zero versions after reload
- `desktop-formatting-success.png` — H2 shorthand, outline, and Bold behavior
- `desktop-comment-compose.png` — anchored thread marker and current-target UI
- `desktop-share-local-only.png` — owner document with Share active while Local only
- `desktop-invite-created-local-only.png` — copied active invite and document canvas scrolled away
- `desktop-invitee-link-no-content.png` — clean edit invitee with blank untitled document
- `mobile-writing-after-create.png` — successful narrow-screen title/body entry
- `mobile-focus-mode.png` — empty trapped Focus Mode viewport
- `mobile-share-drawer.png` — Share active while mixed rail starts at Doc Chat
- `desktop-sidebar-coming-soon.png` — desktop hamburger gray-backdrop dead state

## Residual Unknowns

- Desktop Focus Mode was not re-walked after the mobile blocker was captured.
- A real mobile software keyboard, iOS Safari, IME, and tablet were not exercised.
- The deployed Pages build and deployed Worker were not treated as equivalent to the inspected local commit.
- No live dynamic web service or production secret was available for a real two-person session.
- Comment reply, resolve/reopen, suggestion accept/reject, invite expiry/revocation across browsers, offline reconnect, import/export downloads, and large-document responsiveness were not exhaustively dogfooded.
- STR-FLOW-06 is a deterministic stress observation, not proof of common human-speed corruption.

## Review Gate

Gate: **red**

Reason: STR-FLOW-01 and STR-FLOW-02 violate data integrity and collaboration truth, and STR-FLOW-03 is a mobile interaction trap. A 4.5/5 claim must remain closed until those receipts pass in the actual product.
