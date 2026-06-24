# Critique — Lash Delight Sprint Execution Plan (2026-06-24)

**Scope:** Plan quality only (`docs/plans/lash-delight-sprint-2026-06-24.md` vs its packet). Not a rewrite, not a scope change. Load-bearing claims spot-checked against the repo.

## 1. Top 3 under-specified seams

1. **`desktop-1440-outline.png` has no defined interaction.** Confirmed `visual-snap.mjs` (VIEWPORTS + the four bespoke blocks at `scripts/visual-snap.mjs:17-22,134-254`) never emits an outline frame. The plan correctly assigns the new capture to VIS-01, but never says *what* "outline state" is — the sidebar already renders the outline at desktop-1440, so an implementer must guess (collapsed headings? long scrolling doc? a focused outline panel?). Worse: triggering a distinct outline state likely needs a `data-testid`/hook in product code, which **breaks VIS-01's "no product code" fence** and its role as the first, blocking, code-free bead. Decide the interaction and where the hook lives before VIS-01 runs.
2. **ROU-01's UI integration file does not exist and may never be chosen.** The plan's own Background admits "no current UI integration point," yet the bead's headline outcome is "render availability." The "selected after inspection" file is the entire risk of the bead, deferred. If that host turns out to be `EditorWorkspace.tsx` or a panel, it **collides with Bead 2's owned files** (see §3).
3. **Bead 2 postfix screenshots have no server/build step.** Unlike VIS-01 (which includes `build` + `lash-web-start.sh`), Bead 2's validation ends with `node scripts/visual-snap.mjs … postfix` but never starts a hook-enabled server. `visual-snap` hard-waits on `window.__lashEditor` (`:127`), exposed only with `NEXT_PUBLIC_LASH_TEST_HOOKS=true`. The Playwright `webServer` runs a *production* `next start` (hooks off), so the snapshot step is not runnable as written.

## 2. Specificity balance

- **Over-specified + mistargeted:** Each feedback ID is pinned to one existing spec (CAN-01→`typing-latency`, FMT-01→`large-doc-typing`). These are perf/regression guards that pass regardless of whether any "delight" change was made — they prove *no regression*, not the feedback. The packet asked to "**add or update** proof" per ID; the plan dropped that framing and reused guards. Either re-add feature-level assertions or relabel these explicitly as guards (the plan half-does the latter for perf only).
- **Tactical choice the implementer should own:** hard-pinning `--project=chromium` for MOB-01 — a *mobile* concern — when `cb-mobile-*`/`cb-ipad` projects exist. Leave project selection to the engineer.
- **Dropped useful packet framing:** the packet's per-ID "click-through proof" intent and the user-outcome column are gone from the work items; only screenshots + guards remain as proof of the actual UX claims.

## 3. Contradictions / missing dependencies

- **INF-01 and INF-02 both own `DEPLOYMENT.md` and `Makefile`.** The plan runs them as parallel infra-lane beads "by a separate owner," but they will collide on those two files. Serialize them or section the files.
- **ROU-01 ↔ Bead 2 latent file collision** (see §1.2) — parallel lanes assume disjoint files; the undecided UI host can break that assumption.
- **TRK-01 validation does not validate.** The node one-liner only *prints* `story_rows N`; it never asserts equality with `STORIES_SUMMARY.md`, so the "consistency gate" is manual. It also counts via `split('\n')`, which **over-counts if any free-text cell (`user_story`, `expected_behaviour`) contains a newline** — plausible here. Use a real CSV parse and assert.
- **Runnable-as-written check:** VIS-01 ✓; INF-02 ✓ (`verify-realtime-runtime`, `realtime-dry-run` both exist); INF-01 ✓ only because the bead creates `verify-render` (confirmed absent today); Bead 2 ✗ (§1.3); TRK-01 ✗ (above). Note 5× `pnpm run test:e2e` may rebuild each invocation — slow but not wrong.
- **Ordering is otherwise sound:** VIS-01→Bead 2 (baseline-before-change) is correct; Bead 6 last is correct, though the diagram should also draw Bead 2→Bead 6.

## 4. Credential-gated HALT framing — sound

The three confirmed mismatches are handled correctly (create `mobile-editor.spec.ts`, add outline capture, net-new `render.yaml`+`verify-render`), matching the repo. The INF-01/INF-02 **HALT** conditions are framed safely: explicit "never fabricate," a credential-free local deliverable (`next start` + hit `/doc/<id>`; `verify-realtime-runtime` + `realtime-dry-run`), and a clean separation of *design* (unblocked) from *remote receipt* (gated). No fabrication path. No change needed beyond resolving the DEPLOYMENT.md/Makefile co-ownership above.

## 5. Over-planning — trim candidates

- Credential gates are stated **three times** (per-bead stop conditions + Global stop conditions + Open questions). Collapse to one canonical list referenced by ID.
- The "frank product-readiness gap" three-axis diagram + bottom line is good orientation but heavy for six beads; the `Background` seam map pins ~40 exact line numbers that will rot. Keep the seam *names*, drop most line numbers (or mark them as "as of 358be3a").
- The Validation-summary table duplicates each bead's validation block — keep one.

## Questions that would change implementation order

1. **Does any "send to writing place" UI surface exist?** If no, ROU-01 degrades to lib-tests-only (its stop condition allows this) and the packet's headline outcome is unmet — and a new host may pull it into Bead 2's files. Answer first; it decides whether the lanes are truly parallel.
2. **Can `NEXT_PUBLIC_LASH_TEST_HOOKS` be enabled for the postfix server, and can it share port 3000 with `test:e2e`?** Decides whether Bead 2's screenshots are capturable at all.
3. **What interaction defines the outline frame?** Decides whether VIS-01 must touch product code — i.e. whether it can truly run first and code-free.
4. **Will creds be confirmed this sprint?** If not (current assumption), INF-01/INF-02 reduce to doc+manifest+local-preflight and need no parallel-lane urgency — they can land anytime, lowering coordination cost.
