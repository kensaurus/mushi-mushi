---
"@mushi-mushi/ux": minor
"@mushi-mushi/mcp": minor
"@mushi-mushi/cli": patch
"@mushi-mushi/core": patch
---

The UX tools now spend fewer tokens and show what each run cost (Plan 025, ADR 0072).

`@mushi-mushi/ux`: `mushi-ux scorecard` sends a perceptual hash of each page's settled screenshot. When a page's text and look are unchanged from a run in the last 30 days, the server reuses that page's score instead of making a model call, with today's speed and accessibility measurements applied. The UX loop's final review makes no call when a kept version looks the same as the original, and reuses its verdict for an identical pair of screenshots (cached in `.mushi/ux/judge-cache/`). `mushi ux run --sync` now sends the review's token counts, so the console can show the run's cost. `MUSHI_UX_SKILLS_REPO` overrides the default skills repo.

`@mushi-mushi/mcp`: four new read-only tools. `get_timeline` returns the app release by release: bugs fixed, screens improved, scorecard average and AI cost per release. `get_surface_history` returns one screen's pinned screenshots, scores and kept changes. `get_ux_run` reads one UX run. `start_ux_run` returns the console link and the local command to start a run; it never starts a cloud run itself. Examples in the tool descriptions no longer name the maintainer's own apps, and `MUSHI_PUBLIC_ORIGIN` sets the public site origin (default unchanged).

`@mushi-mushi/core`: favicon lookup no longer carries a per-app table. It uses the app's icon, repo and SDK origin, skips an SDK origin served under a path of a shared host, and takes `shared_hosts` from the caller.

`@mushi-mushi/cli`: `MUSHI_PUBLIC_ORIGIN` sets the public site origin used for the hosted console and the MCP sign-in link (default unchanged).
