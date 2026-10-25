---
'@mushi-mushi/ux': minor
---

New `mushi-ux audit`: finds UI/UX bugs on the signed-in screens of a live app, read-only, and files them as Mushi reports. It reuses a cached, signed-in browser profile (`--profile-dir`, opened with the installed Chrome) and never opens a fresh sign-in window. Findings come from measurements first (serious accessibility rules, sideways scrolling, console errors, layout shift, a blank screen); `--review claude-code|anthropic-api` adds concrete visual defects on whole pages. `--file` files at most 15 deduped reports a run; `--dry-run` lists them. `discover` and `run` also take `--profile-dir` and `--channel`.
