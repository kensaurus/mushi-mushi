---
"@mushi-mushi/cli": minor
---

New `mushi journeys`: where people get stuck in your app, from the Journey optimizer. It prints the journey score, visit stats, the most common paths and each finding with its pages and a suggested fix. `--prompts` adds a ready prompt per finding for your coding agent, `--kind dead_end` (or any other kind) filters the findings, `--days 7|30|90` sets the window and `--json` prints the whole map. `mushi journeys scan [--url https://…]` starts a scan of the live site, so the map also knows the site's links. `mushi journeys record --hours 24 [--sample 0.1]` opens a visit recording window for apps whose SDK uses `trackSessions: 'on-demand'`, and `mushi journeys record --stop` ends it.
