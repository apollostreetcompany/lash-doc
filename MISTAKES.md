# MISTAKES.md - Lash

## Lessons

- Do not treat in-flight image upload dimensions as authoritative after the user has already resized the placeholder. Upload completion must preserve explicit user sizing.
- Avoid broad Prettier writes on legacy Markdown in this repo; it can create unrelated formatting churn in release/planning docs.
- Do not rely on `nohup` from a one-shot Codex shell for a local server that must stay running; this environment can still clean up child processes. Use a detached `tmux` session for the Lash local server.
