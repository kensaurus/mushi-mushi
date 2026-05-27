---
'@mushi-mushi/cli': minor
---

Add `mushi doctor` and `mushi nudge` commands.

`mushi doctor` runs pre-flight checks (CLI config sanity, endpoint reachability,
SDK install detection) and with `--server` also calls `/v1/admin/projects/:id/preflight`
to mirror the 4 dispatch-readiness checks shown in the admin console (GitHub
repo wired, codebase indexed, Anthropic key set, autofix enabled). Output is
human-readable by default; `--json` switches to machine-readable for CI scripts.
Exit code 1 on any failed check so it can gate deploys.

`mushi nudge` generates a paste-ready `Mushi.init({ proactive: { ... } })`
snippet tuned to a release phase (`--phase alpha|beta|ga`). Phase presets
balance feedback yield against prompt fatigue: `alpha` keeps every trigger on
with short cooldowns, `beta` tightens the cadence to a 24h dismissal window,
`ga` strips out beta-only triggers (page-dwell, first-session welcome) and
caps to one proactive prompt per session. Individual fields can still be
overridden via `--max`, `--cooldown`, `--dwell`, `--welcome`. `--explain`
prints a human summary of what the chosen preset does.

Both commands extracted into their own modules (`doctor.ts`, `nudge.ts`) so
the logic is unit-tested without spawning a child process.
