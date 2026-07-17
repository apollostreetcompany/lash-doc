# Lash Blind-Stranger 4.5/5 Product Quality Gate

Contract ID: `STR-GATE-45`

Frozen: 2026-07-18

Baseline: `002333017fe2bca4ec589f8d157c1aa21a4b77da`

Qualification branch: `codex/ux/bead-38-stranger-45-sprint`

## 1. Purpose and Authority

This is the falsifiable outcome contract behind “Lash is a 4.5/5 experience for
normal collaborative document tasks.” It aims for really good, not theoretical
perfection. Isolated non-blocking visual or wording polish may remain; ordinary
writing, sharing, co-editing, review, recovery, and content escape may not be
broken, misleading, or dependent on private setup knowledge.

| Source ID    | Durable source                                                                                   | Obligation                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `STR-RAW-01` | [`user-objective-2026-07-18.md`](../../artifacts/stranger-test/raw/user-objective-2026-07-18.md) | Blind strangers, 4.5/5, normal collaborative work, product iterations  |
| `STR-RAW-02` | [`AGENTS-archive-v1.md`](../../AGENTS-archive-v1.md)                                             | Product capabilities, invariants, SLOs, security, accessibility        |
| `STR-RAW-03` | [`CONTINUITY.md`](../../CONTINUITY.md)                                                           | Current product/deployment truth and blockers                          |
| `STR-RAW-04` | [`lash-next-milestone-2026-06-30.md`](lash-next-milestone-2026-06-30.md)                         | Live collaboration, persistence, mobile, and escape-hatch expectations |

There are no supersessions in this version. Any revision must preserve these
IDs, name every changed criterion and authorizer, and use fresh participants.

### Product Outcome Versus Test Scaffolding

| Evidence                    | Proves                                   | Does not prove                             |
| --------------------------- | ---------------------------------------- | ------------------------------------------ |
| Unit/property/contract test | Deterministic mechanics                  | Stranger discoverability or trust          |
| Playwright test             | A scripted browser path                  | Zero-coaching success                      |
| Trace                       | Latency for the captured workload        | Smoothness on uncaptured devices           |
| Screenshot/recording        | Visible state and behavior               | Durability without matching state receipts |
| Plan or rubric              | A proof obligation                       | Product quality                            |
| Valid qualification run     | Blind behavior on one fixed public build | A later changed build                      |

Documentation and automated tests enable this gate. They cannot pass it.

## 2. Participant Profile and Exclusions

The minimum cohort is five independent pairs: ten unique participants.

Every participant must:

- be 18 or older and consent to recording and redacted evidence retention;
- use Google Docs, Word, Notion, Quip, Pages, or a similar collaborative editor
  at least weekly;
- have created, shared, or commented on a document in the prior 90 days;
- have no prior Lash, repository, test-script, or task-card exposure.

The cohort must include at least three primary-editor backgrounds, at least two
mobile-first document users, at least one keyboard-first user, and at least
three pairs on separate physical devices. No more than three participants may
be software engineers, product designers, or professional QA testers.

Exclude Lash contributors, employees, contractors, close project
collaborators, prior demo/formative participants, anyone who read the protocol
or implementation plans, moderators/recruiters/scorers, and synthetic agents.
Automation may collect evidence but does not count as a participant.

## 3. Fixed Build and Zero-Coaching Protocol

Before the first pair, freeze and record:

- public HTTPS URL, full web commit SHA, and realtime deployment version;
- task-card revision and scoring-workbook SHA-256;
- production configuration relevant to share/session/realtime, omitting secrets;
- test time, region, device, OS, browser/version, viewport, and network class.

All pairs use the same product code, backend behavior, flags, copy, task cards,
weights, and thresholds. Any product or configuration change starts a new
release candidate; scores from different candidates cannot be combined.

Entry conditions:

- clean browser profiles and the ordinary public URL;
- no local server, seeded local storage, test flag, pre-opened control, route
  recipe, console, DevTools action, or hidden configuration;
- pair members send invitations through their ordinary email/chat channel;
- invisible instrumentation may observe but never click, fill, focus, or reveal.

The moderator reads only:

> We are testing the product, not you. Work as you normally would. You may talk
> to your partner and use anything the product itself exposes. Please say what
> you expect and notice. I cannot tell you where a control is or what it is
> called.

Task cards describe outcomes, never UI labels, icons, shortcuts, panels, or
click sequences. If asked for help, the moderator says only:

> Please do what you would normally try next.

Record the question, time, and next action. Partner communication is allowed;
private Lash expertise is not.

A run may be replaced only for consent withdrawal, participant emergency,
unrelated device failure, instrumentation interference, or moderator protocol
violation. Preserve the invalidation receipt where consent permits. A Lash
crash/outage, failed invite, data loss, recovery failure, latency, or confusion
is product evidence and may not be removed.

## 4. Standard Fixture

Use pair IDs `P01` through `P05`. Participants create all product state.

```text
Title: Project kickoff — P01
Heading 1: Launch plan
Intro: We will publish the beta on Tuesday.
Bullets: Draft announcement; Confirm support coverage; Review launch metrics
Checklist: Approve launch copy [complete]; Invite pilot team [incomplete]
Link: Reference brief → https://example.com/
```

Verification strings:

```text
Owner line: Owner will confirm the launch date.
Collaborator line: Reviewer will confirm support coverage.
Comment target: publish the beta
Comment: Could this sound less final?
Suggestion: replace "publish the beta" with "share the beta"
Reply: Good call.
Offline note: Capture feedback after the pilot.
```

## 5. Core Task Journeys

| Journey ID | Task                                               | Actor        | Target | Weight | Critical |
| ---------- | -------------------------------------------------- | ------------ | -----: | -----: | -------- |
| `STR-J01`  | Arrive, create, title, leave, and reopen           | Owner        |  2 min |    10% | yes      |
| `STR-J02`  | Draft and format the fixture                       | Owner        |  5 min |    15% | yes      |
| `STR-J03`  | Invite a collaborator who joins as editor          | Pair         |  4 min |    15% | yes      |
| `STR-J04`  | Co-edit simultaneously and understand live state   | Pair         |  4 min |    20% | yes      |
| `STR-J05`  | Comment, suggest, reply, decide, and resolve       | Pair         |  6 min |    15% | yes      |
| `STR-J06`  | Continue through disconnect, reconnect, and reload | Pair         |  5 min |    15% | yes      |
| `STR-J07`  | Continue on a narrow screen                        | Collaborator |  4 min |     5% | no       |
| `STR-J08`  | Export, inspect, and re-import                     | Owner        |  5 min |     5% | no       |

Weights sum to 100%. Time includes reading the task card.

### `STR-J01` — Create and Return

Task card:

> Starting from the public Lash link, create a document called “Project kickoff
> — P01,” write one sentence, leave the document, and return to it.

Pass observations: a uniquely addressed document exists; title and sentence
survive leaving/returning; visible navigation or a normal browser affordance is
enough; no route/ID knowledge is required.

Evidence: recording, start/end events, redacted URL, title/body snapshots before
leaving and after return, participant rating.

### `STR-J02` — Write and Format

Task card:

> Turn the supplied text into a short launch plan. Use a main heading, intro,
> three bullets, a two-item checklist with the first complete, and a link called
> “Reference brief.” Make “Tuesday” bold.

Pass observations: semantic fixture matches; formatting affects only intended
content; typing/caret/selection/undo stay responsive; save state is clear.

Evidence: recording, semantic snapshot, Event Timing/Long Task trace, save
timestamps, participant rating.

### `STR-J03` — Share and Join

Owner task card:

> Make it possible for your partner to join this document and edit its body.
> Send them what they need as you normally would.

Collaborator task card:

> Open what your partner sends and add “Joined by reviewer” at the end.

Pass observations: owner can choose edit access; collaborator enters the
correct document from a clean profile; scope is clear; no moderator transfer or
private setup is needed; owner sees the new text.

Evidence: both recordings, invite/delivery timestamps, redacted link,
scope/grant receipt, both-client snapshots, both ratings.

### `STR-J04` — Simultaneous Editing

Task card:

> At the same time, add your assigned line under the intro. Confirm together
> that both lines are present and that you can tell the other person is here.

Pass observations: both clients show both lines without overwrite, material
duplication, or place-losing cursor jump; presence/sync reflect reality;
normalized snapshots converge; `STR-M04` passes.

Evidence: synchronized recordings, operation/awareness timestamps, snapshots,
presence/sync screenshot, both ratings.

### `STR-J05` — Review Loop

Collaborator task card:

> On “publish the beta,” leave “Could this sound less final?” and propose
> replacing those words with “share the beta.”

Owner task card:

> Find the feedback, reply “Good call,” accept the wording, and close the
> discussion when satisfied.

Pass observations: feedback anchors to the intended occurrence; navigation from
discussion to text is clear; reply/accept/resolve create the expected state on
both clients; unrelated text is unchanged.

Evidence: recordings, anchor receipt, before/after snapshot, thread/suggestion
states, both ratings.

### `STR-J06` — Recover and Reload

The moderator triggers a scheduled 15-second network interruption after both
participants acknowledge the card, without control guidance.

Task card:

> Keep working if the connection changes. Add “Offline note: Capture feedback
> after the pilot.” When the product says the work is safe, reload on both
> devices and confirm the final text and discussion remain.

Pass observations: offline/reconnecting/saved labels are truthful; the sentence
is neither lost nor duplicated; clients converge within `STR-M05`; both reloads
retain title, body, accepted suggestion, comments/reply, and resolved state.

Evidence: recordings, network/status timestamps, screenshots, snapshots before
outage/after reconnect/after both reloads, both ratings.

### `STR-J07` — Narrow Screen

Use a real phone or a clean touch-enabled 390 × 844 CSS-pixel viewport.

Task card:

> Open the shared document, add a sentence, find the discussion, and return to
> the text.

Pass observations: title/editor/navigation/review surfaces and software
keyboard do not block or clip the task; touch/focus work; owner sees the text.

Evidence: narrow-screen recording/screenshot, device/viewport receipt,
cross-client snapshot, accessibility notes, rating.

### `STR-J08` — Escape Hatch

Task card:

> Download the document in Lash’s supported Markdown format. Check your words,
> then import the file into a new document and compare the structure.

Pass observations: export is discoverable/readable; title/body, heading, bold,
bullets, checklist state, and link survive; review-data omissions are explicit
before export; import creates valid structure without changing the source.

Evidence: recording, exported file, semantic source/export/import comparison,
omission notice where applicable, rating.

## 6. One-to-Five Anchors

After each journey, eligible participants answer, “How easy and trustworthy was
this task in Lash?” The observer independently assigns the same integer anchor
from the recording/state receipts before discussion.

| Score | Falsifiable anchor                                                                                                                                      |
| ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | Could not complete, completed the wrong outcome, or hit loss, corruption, exposure, or unrecoverable state.                                             |
|     2 | Outcome required hidden knowledge, moderator rescue, restart, repeated workaround, or severe uncertainty.                                               |
|     3 | Completed unassisted but with material confusion/backtracking/misleading feedback/repeated errors, or over 2× target time.                              |
|     4 | Completed unassisted within target with correct state and confidence; only one or two non-blocking frictions.                                           |
|     5 | Completed correctly on the first natural path, comfortably within target, with clear state and no meaningful friction; confidence or delight expressed. |

Moderator UI guidance caps a journey at 2. More than twice target caps it at 3.
A hard fail scores 1 and fails the candidate. Observers never raise participant
ratings. Do not round intermediate values.

## 7. Hard Fails

Any confirmed row fails the candidate regardless of its mean.

| ID         | Condition                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `STR-HF01` | User content, accepted decision, or comment is lost, materially corrupted/duplicated, or restored to the wrong document.      |
| `STR-HF02` | A participant reads/mutates beyond granted document/scope, or another pair’s private content appears.                         |
| `STR-HF03` | Create, reopen, write, share, join, co-edit, review, reconnect, or reload cannot complete through the public product.         |
| `STR-HF04` | Saved, synced, resolved, accepted, denied, or read-only UI contradicts durable/realtime/access state.                         |
| `STR-HF05` | Crash, dead primary control, trap, blank/error state blocks a critical journey >2 minutes without in-product recovery.        |
| `STR-HF06` | A critical journey requires moderator UI guidance, test hook, DevTools, route recipe, local server, or manual secrets/config. |
| `STR-HF07` | Narrow-screen clipping/overlap/focus/target failure prevents editing, review, or return to text.                              |
| `STR-HF08` | Advertised export/import loses ordinary fixture text without warning, corrupts source, or yields unreadable recovery.         |

Missing access/security proof is not a pass.

## 8. Timing, Latency, and Trust

| Measure ID | Pass threshold                                                                                   | Receipt                         |
| ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| `STR-M01`  | Cold open median <1.5 s and p95 <2.5 s                                                           | navigation/interaction trace    |
| `STR-M02`  | Input event-work p95 <8 ms; no task-blocking long task >200 ms                                   | Event Timing/Long Tasks         |
| `STR-M03`  | Saved transition p95 <500 ms; never precedes durable receipt                                     | UI/persistence timestamps       |
| `STR-M04`  | Same-region remote edit/awareness p95 <200 ms; field-visible p95 <=1,000 ms and max <=2,000 ms   | sender/room/receiver timestamps |
| `STR-M05`  | After network restoration, both clients converge and return to truthful saved/synced within 10 s | network/status/snapshot log     |
| `STR-M06`  | >=90% of all attempts within target; every critical attempt within 2× target                     | task events                     |

Record raw monotonic timestamps, sample count, calculation method, median, p95,
max, device/network, and exclusions. Missing samples fail. CI metrics cannot
replace cohort receipts; the automated SLO suite must also pass on the same SHA.

| Trust ID  | Proof obligation                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `STR-T01` | Normalized title/body checksums match on both clients before and after both reloads for all pairs.                        |
| `STR-T02` | Intended anchor, reply, accepted text, and resolved state match on both clients after reload.                             |
| `STR-T03` | Edit scope can edit; tested narrower scope cannot mutate body; document/pair state never crosses.                         |
| `STR-T04` | Source/export/import comparison contains all fixture elements or an explicit pre-export omission for adjunct review data. |
| `STR-T05` | Every saved/synced/offline/reconnecting/read-only label matches persistence, socket, and grant receipts.                  |

## 9. Feedback Dimensions and Questions

Every dimension requires behavior plus direct participant language.

| Dimension ID | Dimension             | Journey proof                                          | Questions |
| ------------ | --------------------- | ------------------------------------------------------ | --------- |
| `STR-D01`    | Learnability/flow     | J01, J03, J05, J08 times, first path, backtracks, help | Q01–Q02   |
| `STR-D02`    | Writing smoothness    | J02, J04, J07 latency/errors/undo                      | Q03       |
| `STR-D03`    | Collaboration clarity | J03–J05 join/fan-out/convergence/scope                 | Q04–Q05   |
| `STR-D04`    | Trust/recovery        | J06, J08 checksums/reconnect/export                    | Q06–Q07   |
| `STR-D05`    | Performance           | M01–M05                                                | Q08       |
| `STR-D06`    | Calmness/delight      | all ratings/dead clicks/frictions                      | Q09–Q10   |

Ask verbatim, without defending Lash:

| ID        | Question                                                         |
| --------- | ---------------------------------------------------------------- |
| `STR-Q01` | What did you expect to do first, and did Lash match?             |
| `STR-Q02` | Where, if anywhere, did you have to hunt or guess?               |
| `STR-Q03` | Did anything interrupt writing or formatting?                    |
| `STR-Q04` | How did you know your partner was here and seeing your work?     |
| `STR-Q05` | Was any share, comment, suggestion, or decision state ambiguous? |
| `STR-Q06` | When were you certain or uncertain that your work was safe?      |
| `STR-Q07` | If Lash disappeared tomorrow, could you recover your words? Why? |
| `STR-Q08` | Did Lash feel slow or visually behind an action? Where?          |
| `STR-Q09` | What felt unexpectedly good or satisfying?                       |
| `STR-Q10` | Would you choose Lash for a real shared document this week? Why? |

Tag verbatim answers with journey, timestamp, dimension, severity, and whether
the accompanying statement is observation or inference.

## 10. Score Calculation

For pair `p` and journey `j`:

- `P(p,j)` = mean of eligible participant ratings (owner-only uses owner; pair
  journeys use both).
- `O(p,j)` = observer integer anchor supported by receipts.
- `A(p,j) = min(P(p,j), O(p,j))`.
- `J(j) = mean_p A(p,j)` across all five pairs.

```text
S = 0.10*J(J01) + 0.15*J(J02) + 0.15*J(J03) + 0.20*J(J04)
  + 0.15*J(J05) + 0.15*J(J06) + 0.05*J(J07) + 0.05*J(J08)
```

Use unrounded inputs; report `S` to two decimals. Also report raw participant
and observer values, journey mean/median/range/completion, and a bootstrap 95%
confidence interval for disclosure, not as a substitute gate.

## 11. Exact 4.5/5 Pass Predicate

A frozen candidate passes `STR-GATE-45` if and only if all are true:

1. Five fresh eligible pairs complete the unchanged protocol with reviewable
   evidence.
2. No `STR-HF01`–`STR-HF08` event occurs.
3. All 30 critical attempts for `STR-J01`–`STR-J06` complete unassisted, and at
   least 36 of all 40 pair-journey attempts complete unassisted within target.
4. Weighted score `S >= 4.50`.
5. Every `J(j) >= 4.00`; each `J(STR-J03)`–`J(STR-J06) >= 4.40`.
6. `STR-M01`–`STR-M06` and the companion automated gates pass on the same SHA.
7. `STR-T01`–`STR-T05` pass for every pair without missing/contradictory proof.
8. At least eight of ten participants rate willingness in `STR-Q10` as 4 or 5,
   and none rates it below 3.
9. Independent review finds no unresolved P0, P1, or P2. P3 may remain only
   when non-blocking and the affected journey retains its floor.
10. The final report separates observed outcomes, automated scaffolding,
    inferences, and residual P3 polish.

This is a conjunction. A high mean cannot offset a hard fail, missing receipt,
critical journey failure, or failed SLO.

| Severity | Definition                                                           | Treatment               |
| -------- | -------------------------------------------------------------------- | ----------------------- |
| P0       | loss, privacy/security exposure, cross-document corruption           | hard fail               |
| P1       | critical task block, crash/dead end, false saved/scope state         | hard fail               |
| P2       | repeated material friction/ambiguity threatening completion or trust | fix before pass         |
| P3       | isolated non-blocking visual, motion, wording, or extra-step polish  | may remain if disclosed |

Minor alignment or non-misleading copy preference can be P3. Hidden controls,
unclear save state, slow remote updates, clipped mobile actions, and required
workarounds are not polish.

## 12. Sample Size and Retest Discipline

- Formative runs guide iterations but never count toward qualification.
- Recruit before inspecting scores and include every consecutive eligible
  participant; do not replace low scores or product failures.
- Freeze build, protocol, weights, targets, anchors, and thresholds before P01.
- After any product/config change, start a new candidate. Prior participants may
  probe a regression, but final qualification requires five new pairs.
- Preserve every permitted invalidation receipt and recruit the next eligible
  pair.
- Run automated mechanics/SLO gates before P01 and after P05 on the same SHA.
- An independent Product/QA reviewer audits eligibility, exclusions, raw
  scoring, hard-fail classification, and receipt completeness before announcing
  a score.
- Changing an anchor, journey, severity, or hard-fail rule after results
  requires a new protocol version and fresh cohort.

## 13. Evidence and Outcome Receipts

`{sha}` means the full deployed commit; `{pair_id}` is `P01`–`P05`.

```text
artifacts/stranger-test/runs/{sha}/
├── release-manifest.json
├── protocol.sha256
├── cohort.csv
├── scoring-raw.csv
├── score-summary.json
├── metrics-summary.json
├── issues.jsonl
├── final-report.md
└── pairs/{pair_id}/
    ├── manifest.json
    ├── owner-recording.*
    ├── collaborator-recording.*
    ├── task-events.jsonl
    ├── participant-ratings.json
    ├── observer-ratings.json
    ├── qualitative-transcript.md
    ├── performance-trace.json
    ├── network-events.jsonl
    ├── access-receipts.json
    ├── state-snapshots.json
    ├── exported-document.md
    └── screenshots/
```

Manifests record contract/task hashes, deployed versions, pseudonymized
eligibility, device/browser/network/region, journey events/help/backtracks,
raw metrics, state hashes, immutable ratings, issue IDs/severity/source,
consent/redaction, and reviewer. Redact PII and invitation tokens without
removing behavior needed to audit scoring.

The final report includes the candidate/cohort, verdict for every Section 11
conjunct, raw score calculation, journey/dimension findings with timestamps,
latency/trust tables, hard-fail/severity ledger including zero-count rows,
consented quotations, residual P3 tradeoffs, automated companion results, and
independent reviewer verdict.

Any missing required artifact, sample, or receipt yields `incomplete`, not pass.
