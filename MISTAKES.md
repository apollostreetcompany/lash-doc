# MISTAKES.md - Lash

## Lessons

- Do not treat in-flight image upload dimensions as authoritative after the user has already resized the placeholder. Upload completion must preserve explicit user sizing.
- Avoid broad Prettier writes on legacy Markdown in this repo; it can create unrelated formatting churn in release/planning docs.
- Do not rely on `nohup` from a one-shot Codex shell for a local server that must stay running; this environment can still clean up child processes. Use a detached `tmux` session for the Lash local server.
- Do not run `pnpm run build` or `pnpm run test:e2e` while `next start` is serving `apps/web/.next`; stop the local Lash server first, then restart it after validation.
- History recording can fragment a normal typing burst under loaded browser runs if the idle debounce is too low. A 900 ms debounce still split `Suggested wording` under a 5-worker local e2e run; keep the local history debounce comfortably above Playwright scheduler jitter, and rerun suggest-mode regression coverage when adding transaction listeners.
- Do not make CI performance gates depend on a single animation-frame or max-event outlier under shared-runner load. Enforce product SLOs with p95/dispatch/long-task assertions, and keep frame-settle or max-event checks as wider smoke bounds.
- Direct `pnpm exec playwright ...` runs serve the existing `.next` output. If a spec needs `window.__lashEditor` or other test hooks, rebuild first with `NEXT_PUBLIC_LASH_TEST_HOOKS=true pnpm --filter @lash/web build`; a normal production build disables those hooks and makes e2e fail for the wrong reason.
