# @mushi-mushi/cli

Source: https://kensaur.us/mushi-mushi/docs/sdks/cli

---
title: '@mushi-mushi/cli'
description: Reference for @mushi-mushi/cli — log in, connect a project, run doctor, list reports, dispatch agent fixes and merge their pull requests from the terminal.
---

# `@mushi-mushi/cli`

Project setup, report triage, agentic fix dispatch, QA coverage, skill pipelines, and
headless merge — all from the terminal.

```bash
npm install -g @mushi-mushi/cli

mushi login
mushi connect --project-id <uuid> --endpoint <url> --wait
mushi doctor --qa-stories
mushi reports list --status new
mushi fix <reportId> --agent cursor_cloud --wait
mushi fixes merge <fixId>          # squash-merge the PR + mark report Fixed
```

  **Two key types:** SDK ingest keys (`report:write`) are minted on **Setup → Verify** or
  **Projects → Generate API key**. Admin / MCP keys (`mcp:read` or `mcp:write`) are also
  minted on Projects — use `mcp:write` for fix dispatch, merge, and most CLI admin commands.
  **Settings → API Keys (BYOK)** is for your own LLM/Firecrawl keys, not Mushi credentials.

---

## Console ↔ CLI setup loop

See the full walkthrough: [CLI ↔ console loop](/quickstart/cli-console-loop).

| Step | Console | CLI |
| --- | --- | --- |
| Create project | Setup → Steps or Projects → New project | Wizard opens `?setup=cli` |
| Copy Project ID | Success panel UUID chip | `mushi init --project-id ` |
| Mint ingest key | Setup → Verify → Generate API key | Paste at prompt or `MUSHI_API_KEY=…` |
| Wire repo | SDK install configurator | `mushi init` or `mushi connect --wait` |

Console URL resolution: `MUSHI_CONSOLE_URL` → saved config → localhost `:6464` probe → hosted default.

---

## Setup & health

| Command | Purpose |
| ------- | ------- |
| `mushi init` | Wizard: prerequisite step, framework detect, install SDK, write `.env.local`, whoami verify, optional test report |
| `mushi connect` | Non-interactive: config + env (default) + Cursor MCP (default) + optional `--wait` heartbeat |
| `mushi login` | Save credentials to the CLI config file: `~/.config/mushi/config.json`, or `%APPDATA%\mushi\config.json` on Windows ([full order](#config-file); legacy `~/.mushirc` auto-migrates) |
| `mushi setup` | Wire Cursor/Claude MCP from saved config — **not** SDK install (run `login` first) |
| `mushi whoami` | Verify API key and show project info |
| `mushi ping` | Backend connectivity probe |
| `mushi config` | View or update CLI config |
| `mushi upgrade` | Bump installed `@mushi-mushi/*` packages to latest stable |
| `mushi migrate` | Suggest migration guides based on `package.json` |
| `mushi project create` | Create project, mint key, write config |
| `mushi doctor` | Local + optional server preflight checks |
| `mushi nudge` | Print a phase-tuned `Mushi.init()` snippet (`alpha` / `beta` / `ga`) |
| `mushi reset  --confirm` | Archive project and wipe test data (irreversible) |
| `mushi completion <bash\|zsh\|fish>` | Print a tab-completion script generated from the live command tree |

### `mushi doctor`

```bash
mushi doctor                  # config, endpoint, SDK install, ingest and dispatch readiness
mushi doctor --no-server      # skip the 4 dispatch checks (GitHub, codebase, Anthropic, autofix)
mushi doctor --no-ingest      # skip the SDK heartbeat / first-report checks
mushi doctor --host-app       # + host wiring: env vars, MCP config, hash-router capture
mushi doctor --qa-stories     # + QA story setup warnings (needs a signed-in CLI)
mushi doctor --full           # run every check category in one pass
mushi doctor --json           # machine-readable; exits 1 if any check fails
```

`--host-app` (also included in `--full`) scans your source for hash-routed SPAs
— `HashRouter`, `createHashRouter`, `location.hash`, `hashchange` — and, when it
finds them, advises adding `/#/`-prefixed `discoverInventory.routeTemplates` to
your `Mushi.init()` so parametric hash routes group in the Inventory instead of
inflating it one row per slug. It's advisory only (never fails the run) and
stays silent when no hash routing is present. See
[Hash-routed SPAs](/sdks/web#hash-routed-spas-eg-react-router-hashrouter-backbone-legacy-apps).

### `mushi nudge`

Generate a ready-to-paste `Mushi.init()` snippet tuned for your release phase
(proactive triggers, cooldowns, feature-request card, beta-mode UI).

```bash
mushi nudge --phase beta              # default phase
mushi nudge --phase alpha --explain   # + human-readable summary of the preset
mushi nudge --phase ga --max 2 --cooldown 24 --dwell 5 --welcome 10
```

| Flag | Meaning |
|------|---------|
| `--phase <alpha\|beta\|ga>` | Release phase preset (default `beta`) |
| `--explain` | Print a human-readable summary of what the preset does |
| `--max ` | Override `maxProactivePerSession` (≥ 1) |
| `--cooldown ` | Override `dismissCooldownHours` (≥ 0) |
| `--dwell ` | Override page-dwell threshold (`0` disables) |
| `--welcome ` | Override first-session welcome delay (`0` disables) |

---

## Reports & lessons

```bash
mushi reports list [--status new] [--severity critical]
mushi reports show <id>
mushi reports triage <id> --status acknowledged --severity high
mushi reports resolve <id>
mushi reports reopen <id>
mushi reports dismiss <id>
mushi reports reply <id> "Thanks — we're on it"
mushi reports search "checkout button"
mushi reports file --title "…" --description "…" [--severity high] [--component checkout]

mushi lessons list
mushi lessons show <id>
mushi sync-lessons              # pull promoted rules → .mushi/lessons.json
```

### Sentry issues already open

The Sentry webhook only sees new issues. `mushi sentry import` brings in the
ones already open, so they get the same diagnosis. Running it twice is safe: an
issue already imported links to its report.

```bash
mushi sentry import                                  # newest unresolved issues
mushi sentry import WEB-1A2 WEB-1A3                  # by id or short id (up to 10)
mushi sentry import --query "level:error" --since-days 7
mushi sentry import --query "level:error" --cursor <next>   # next page, printed after each import
```

It needs the Sentry org slug, project slug and an auth token with `event:read`
and `project:read` (console: **Integrations → Sentry**).

### File a report yourself

For a bug you found yourself, or a backlog item you want an agent to fix,
`mushi reports file` adds a report to the app's queue. It goes through the same
triage as a user report, so it gets a diagnosis and can be sent to `mushi fix`.

```bash
mushi reports file --title "Checkout adds tax twice" \
  --description "Cart with 2 items shows the tax line twice on /checkout. Done when the total matches the cart."
mushi reports file --title "Bump sharp to 0.34" --description "..." --severity low --component build --project <uuid>
```

`--severity` (critical, high, medium, low) and `--component` are hints that
triage may refine. It needs a key with the `mcp:write` scope; each app takes at
most 30 filed reports an hour. The MCP tool is `file_report`.

### Reporter updates held for review

When reporter updates are in review mode, each status message waits in the
outbox until you send it. Sending and discarding reach a real person, so both
need `--yes`.

```bash
mushi outbox list
mushi outbox edit <messageId> "Fixed in 1.4, thanks for the report"
mushi outbox release <messageId> --yes
mushi outbox release <messageId> --text "Fixed in 1.4" --yes
mushi outbox discard <messageId> --yes
```

---

## Agentic fixes

### `mushi fix `

Dispatch an agentic fix for a classified report.

```bash
# Default agent (from project settings)
mushi fix 00000000-0000-0000-0000-000000000123

# Cursor Cloud Agent — wait for PR
mushi fix <reportId> --agent cursor_cloud --wait

# A project with a frontend and a backend repo: send the fix to the backend
mushi fix <reportId> --repo acme/app-backend

# CI: fail the pipeline if the fix errors
mushi fix $REPORT_ID --agent cursor_cloud --wait && echo "Fix PR opened"
```

| Flag | Description |
| ---- | ----------- |
| `--agent ` | `claude_code` (default), `cursor_cloud`, `codex`, `mcp` |
| `--model ` | Model override for `cursor_cloud` (e.g. `composer-latest`) |
| `--no-auto-pr` | Skip automatic PR creation for `cursor_cloud` |
| `--wait` | Poll until terminal state; exits non-zero on failure |
| `--repo <repoId\|owner/name>` | Linked repo to open the fix PR against, for a project with several repos. Defaults to the primary repo. A name is looked up among the project's linked repos |

### `mushi fixes`

Headless fix lifecycle — pairs with `mushi fix --wait`.

```bash
# Stream dispatch SSE events (no browser)
mushi fixes tail --report-id <reportId>

# Pull latest GitHub Actions status (same as console "Refresh CI status")
mushi fixes refresh-ci <fixId>
mushi fixes refresh-ci <fixId> --json

# Squash-merge the draft PR and mark the report Fixed
mushi fixes merge <fixId>
mushi fixes merge <fixId> --method squash   # default
mushi fixes merge <fixId> --method merge
mushi fixes merge <fixId> --json

# The verified-merge gates for the PR's current head (ADR 0035)
mushi fixes verify <fixId>
mushi fixes verify <fixId> --rerun   # re-check now, then show
mushi fixes verify <fixId> --json
```

**Merge prerequisites:** the fix attempt must be `completed` with an open PR (`pr_url`
+ `pr_number`). Draft PRs are auto-readied via GitHub GraphQL before merge (same as the
console). Requires GitHub App or PAT connected and an API key with `mcp:write`.

When merge succeeds, the report moves to **Fixed**, the reporter gets notified, and
`fix.applied` webhooks fire — identical to merging on GitHub or via the admin console.

### `mushi work`

Fix reports with a coding agent on your own machine instead of a cloud agent.
The agent (the Cursor CLI, `cursor-agent`, signed in to any Cursor account)
only edits a worktree of your repo; `mushi work` commits, pushes and opens the
draft pull request with **your** local credentials. So you can spend a Cursor
account's allowance without that account's GitHub ever touching your repo.

```bash
# Show which reports it would take (worst first, none with a run or PR already live)
mushi work --repo-dir ~/code/my-app --dry-run

# Fix up to 3 reports, one at a time
mushi work --repo-dir ~/code/my-app --max 3

# One report, a chosen model
mushi work --repo-dir ~/code/my-app --report <reportId> --model gpt-5
```

For each report it:

1. Reads Mushi's fix packet and what earlier attempts did (their Opus review
   findings), as data the agent must not take as instructions.
2. Creates a worktree from `origin/` on
   `bugfix/MUSHI--local-cursor` and runs `cursor-agent -p` in it
   (30 minutes at most), after installing the worktree's dependencies from
   its lockfile (pnpm, npm or yarn) so the agent can run the tests and your
   commit hooks work. The agent's environment has no credentials, and
   version control inside it cannot reach the remote.
3. With changes: commits, pushes, opens a draft PR with `Mushi report: `,
   registers the fix attempt (like the MCP tool `submit_fix_result`) and
   queues the Opus review, so the PR follows the same review and release
   train as a cloud agent's. Without changes: records the agent's
   `Mushi verdict:` on the attempt.

A report whose local run ended without a pull request in the last 7 days
(a timeout, no change, or a verdict) is skipped; pass `--report ` to run
it anyway. The agent has 30 minutes, so a report that names several pages is
fixed one page at a time: split broad reports into one page or cause each.

When Opus says "fix first" on one of these pull requests, run
`mushi work --followups`. Mushi checks the round (the reviewed commit is still
the PR's head, at most 2 rounds per PR), sends only the findings that pass its
safety screen, and the agent fixes them in a worktree of the PR's branch.
`mushi work` commits and pushes to that branch, and Opus reviews the new
commit. Cloud-agent pull requests get the same follow-up from Mushi itself.

```bash
# Which pull requests are waiting for a follow-up
mushi work --repo-dir ~/code/my-app --followups --dry-run

# Run them
mushi work --repo-dir ~/code/my-app --followups --model grok-4.7-xhigh
```

| Flag | Description |
| --- | --- |
| `--repo-dir ` | A clone of the app repo; only worktrees are created in it |
| `--max ` | Reports per run (default 3, at most 10) |
| `--report ` | Work on this report only |
| `--followups` | Fix the Opus "fix first" findings on pull requests `mushi work` opened, and push to them |
| `--model ` | Model for the agent (`cursor-agent --list-models`) |
| `--keep` | Keep the worktree afterwards |
| `--dry-run` | Show the plan; change nothing |

Needs `cursor-agent` and `gh` signed in, and an API key with `mcp:write`.

### `mushi worker`

`mushi work --daemon` runs `mushi work` for you, all the time, as a local
worker the console can see and steer (Pipeline → Workers). One process serves
every lane on the machine. A lane is one app and one clone of its repo.

Every minute it sends a heartbeat. The answer holds each lane's settings, set
in the console: its model, mode, how many reports at once, paused, drain and a
stop date, plus the machine's guards (agents at once, a free-memory floor, a
GitHub API floor). The daemon then works by each lane's mode:

| Mode | What the lane does |
| --- | --- |
| `fix` | Runs review follow-ups first, then claims reports: the lane's queue first, then the worst open reports |
| `followups` | Review follow-ups only |
| `conflicts` | Merges the base branch into a merge-queue PR of the clone's repository at the commit Mushi saw; the agent may change only the conflicted files; refused on a leftover marker or any other change; commits with your hooks and pushes the merge, fast-forward only |
| `audit` | A model (read-only) proposes bugs for one screen with the line, the code there and a check; the machine runs the check itself and files only what reproduces; a second model may only veto |
| `skill` | Only the rounds of skill runs started with this lane on Spend credits |

Whatever its mode (except `followups`), a lane first takes a **first-time user test**
someone started with Run now in the console: it runs `mushi-ux fresh-eyes` on this
machine and the console follows it live. The heartbeat tells the lane within a minute.

While a lane holds a report, no cloud agent is sent to it. Every outcome goes back to
Mushi; a failure of the machine (a clone permission, the network, a hook that
timed out under load) is kept apart from a failure of the code and never
counts against the report.

```bash
# One lane: print what it would write, then write it after you say yes
mushi worker install --lane my-app --project <projectId> --repo-dir ~/code/my-app --dry-run
mushi worker install --lane my-app --project <projectId> --repo-dir ~/code/my-app

# Import lanes.conf from the lane-v4 scripts (name profile clone projectId model mode)
mushi worker install --lanes-conf ~/mushi-credits-handoff/lanes.conf --clone-root ~/.cache/mushi-work

# A worker key made in the console instead of with your CLI login
mushi worker install --lanes-conf lanes.conf --key-stdin --yes < worker.key

# This machine's lanes and service, then every worker the console sees
mushi worker status

# Run it in the foreground (the service runs exactly this)
mushi work --daemon

# Revoke this machine's key and stop the service
mushi worker revoke
```

`install` writes the lanes to `~/.config/mushi/worker.json` (the clone paths
stay on your machine), stores a worker key in the OS keychain (or
`~/.config/mushi/worker.key`, mode 0600, where there is none), and writes the
service: a systemd user unit (`mushi-worker.service`) on Linux and WSL2, a
scheduled task that starts at logon on Windows. From `lanes.conf`, `queue` and
`fix` become `fix`, `followups`, `conflicts`, `audit` and `skill` stay as they
are, `off` becomes a paused lane, and the profile column is dropped: one worker
key serves every app. The heartbeat names each lane's repository (`owner/name`
from its `origin` remote) so a conflicts lane takes only that repository's
PRs; the clone's path never leaves the machine.

The worker key has the scope `worker:run`: it can take reports for its lanes,
record their fixes and file reports, and nothing else. It cannot merge, change
settings or read keys. `install` makes one with your CLI login (which needs
`mcp:write` on every lane's app), or takes one from stdin. The daemon refuses
your CLI key. The agent gets neither key.

`mushi worker status` starts with what stops your workers from fixing bugs, the
same list as the console's Workers tab, worst first: a run stuck in a repo's
commit or pre-push hook (with its stage and last log lines), an offline
machine, a Cursor account check that failed or timed out, lanes waiting for an
agent space (one coding agent at a time; each machine allows a set number),
`gh` signed out, idle credits. Each comes with what to do. It exits with code 2
while one of them needs you now. The worker sends the stage and log lines with
its heartbeat; keys, tokens and paths are removed and e-mail addresses masked
before anything leaves the machine.

| Command | Flags |
| --- | --- |
| `mushi work --daemon` | `--worker-config ` (default `~/.config/mushi/worker.json`) |
| `mushi worker install` | `--lanes-conf `, `--clone-root `, or one lane: `--lane`, `--project`, `--repo-dir`, `--model`; `--stop-at ` (every lane's stop date on first registration), `--cursor-account ` (spend only that Cursor account), `--endpoint`, `--key-stdin`, `--no-service`, `--yes`, `--dry-run` |
| `mushi worker status` | `--project `, `--json` |
| `mushi worker revoke` | `--yes` |

Operator guide (service, logs, moving existing lanes): [Local workers](https://github.com/kensaurus/mushi-mushi/blob/master/docs/operators/local-workers.md).

### `mushi verify`

The `mushi-verify` workflow that proves an agent's fix with a test that fails
without it, filled in with your project's runner labels and test command. Full
guide: [Verified merge](/admin/verified-merge).

```bash
mushi verify workflow                                           # print it
mushi verify workflow --out .github/workflows/mushi-verify.yml  # write it
mushi verify workflow --project <projectId> --json
```

### `mushi runner`

Where your tests run and why a fix waits to land. Full guide: [CI runners](/operating/ci-runners).

```bash
mushi runner status [--days 7] [--refresh] [--all] [--json]   # machines, runners, wait times, test machine vs code failures
mushi runner compare [--days 30] [--all] [--json]             # what CI costs and how fast it runs: GitHub-hosted vs your machines (estimated)
mushi runner bill [--month 2026-10] [--owner login] [--push] [--json]  # what GitHub actually charged, read with your own gh login; --push shows it in the console
mushi runner placement show|preview|request|revert          # where each repo's CI runs; change one runner variable with approval (ADR 0037)
mushi runner fix --repo <owner/repo> --workflow <path> --kind <kind>  # draft PR with one CI cost fix (ADR 0047)
mushi runner fix-status [jobId]                              # the fix, its PR, and after the merge the measured saving
mushi runner key                                  # a runner key (can only report runner health), saved, never printed
mushi runner heartbeat [--once] [--dry-run]       # send this machine's memory, swap, load and runner services
mushi runner hooks install --dir <runner folder>  # per-job memory peak and out-of-memory kills
mushi runner add --repo owner/name --dry-run      # set this machine up as a runner, safe defaults
mushi runner audit [--repo owner/name | --all]    # list self-hosted runners and flag the odd ones
```

---

## QA coverage & TDD

```bash
# Live crawl → inventory proposal
mushi stories map --url https://your-app.com --wait
mushi stories map --url https://app.com --provider browserbase --cursor-refine

# TDD test generation
mushi tdd gen <storyId> --mode review
mushi tdd pending
mushi tdd approve <qaStoryId>
mushi tdd improve                    # PDCA on failing tests
mushi tdd run <qaStoryId>

# QA story ops
mushi qa stories
mushi qa runs <storyId>
mushi qa run <storyId>
mushi audit                        # full-stack project health audit
```

### UX pass over every screen

`mushi ux` runs [`@mushi-mushi/ux`](https://www.npmjs.com/package/@mushi-mushi/ux) on your machine. It maps every page, tab and dialog of your running app, then hands one screen at a time to the coding agent you choose, in a separate git worktree. An edit is kept only if accessibility, layout and console measurements don't get worse. Exploring the app never sends a write request.

```bash
mushi ux ui                                              # studio: pick agent, model and skill; start; watch every attempt
mushi ux models --agent cursor                           # the models your account can use
mushi ux skills                                          # skill names from kensaurus/skills
mushi ux discover --url http://localhost:5173            # list the screens; edits nothing
mushi ux login --url http://localhost:5173               # sign in once, by hand, for signed-in screens
mushi ux run --dev "pnpm dev --port {port}" --agent claude-code
mushi ux run --dev "pnpm dev --port {port}" --agent cursor --model <id> --skill enhance-mobile-native-feel --base origin/main
mushi ux run --dev "pnpm dev --port {port}" --agent cursor-cloud --model grok-4.7   # edits run in Cursor Cloud
mushi ux open <runId>                                    # dashboard for a past run
```

The run ends with a branch, `mushi-ux/`, for you to review and open as a draft PR. Nothing is merged.

With `--steps` (on by default in `mushi ux ui`), the agent first plans each screen as 2–5 small, separate improvements without editing, then makes one per attempt; each step is measured and kept or rolled back on its own, so one bad step never costs the rest.

A run that stops for any reason (Stop, a closed terminal, a killed process) can be resumed with **Resume** in `mushi ux ui`, or with `mushi ux run --resume `: it carries on from the first unfinished screen with the settings it started with.

A run first checks, in about a minute, that the agent can read a file, and tells you what to fix if it cannot (`--no-preflight` skips it). On Windows, start the Cursor agent from PowerShell or cmd: the Cursor CLI also runs your Claude Code hooks, which can fail under Git Bash. Pass `--ignore ` (repeatable) for elements that are not your app's UI, such as a dev badge; dev overlays, build stamps and the Mushi widget are skipped already.

To run it on your repo's GitHub Actions instead, add the [`mushi-ux.yml` workflow](https://github.com/kensaurus/mushi-mushi/blob/master/docs/templates/mushi-ux.yml) and use **Run in the cloud** on the console's [UX runs](/admin/ux-runs) page. It uses `cursor-cloud` and opens one draft PR.

### Gate findings

`mushi audit findings` lists each finding from the recent gate runs with its
file and line. `mushi audit explain` says why one fired, what it prevents and
how to fix it. `--gate` takes any gate name: one this CLI version does not list
is still sent to the server, with a warning.

```bash
mushi audit findings
mushi audit findings --gate code_health --severity error
mushi audit findings --all                      # include allowlisted findings
mushi audit explain <findingId>
```

### Code health

Oversized files and bundle size that your CI posts to `POST /v1/ingest/metrics`.

```bash
mushi code-health show [--days 30]
mushi code-health stats
```

---

## Your repo

These read the GitHub repo connected to the project. Mushi reads it through
the GitHub connection and does not clone it.

```bash
mushi repo digest > digest.txt                  # one token-budgeted text for an LLM; summary goes to stderr
mushi repo digest --report <reportId>           # start from the files in that report's stack trace and fixes
mushi repo digest --path src/auth --budget 40000 --out digest.txt

mushi repo diagram show                         # the architecture diagram as an outline
mushi repo diagram generate [--force]           # draw it for the latest commit
mushi repo diagram publish --yes                # make it a public page (owners and admins)
mushi repo diagram unpublish --yes
```

`publish` shows where the page will go before it publishes. It sends the hash
of exactly what the preview showed, so a diagram that changed in between is
refused. A private repo can only be published from the console.

### Clean up branches and pull requests

```bash
mushi repo cleanup show [--stale-days 14]       # branches and fix PRs Mushi opened that can go, with why and the commit
mushi repo cleanup request delete-branches --repo owner/app [--keys branch:a,branch:b]
mushi repo cleanup request close-prs --repo owner/app [--keys pr:12]
mushi repo cleanup request auto-delete --repo owner/app   # turn on GitHub's "Automatically delete head branches"
mushi repo cleanup restore <itemId>…            # bring back a branch Mushi deleted, at the commit it kept
```

Only branches and pull requests Mushi itself opened are listed: a branch whose
pull request merged or closed and that still points at that pull request's last
commit, or an open fix PR that a newer fix replaced, that the Opus review held,
or that got no new commit for 14 days. The CLI only asks. A team owner or admin
approves the exact list in the console (Repo → Clean up) within an hour, and
Mushi checks every item again before it deletes or closes anything.

---

## Releases

Release notes that credit the people who reported each fix and tell them it
shipped.

```bash
mushi releases draft 1.4.0 [--since 2026-09-01]  # notes from the fixes merged in the window; nothing is sent
mushi releases list [--status draft]
mushi releases show <releaseId>
mushi releases edit <releaseId> --body-file notes.md
mushi releases publish <releaseId> --yes         # resolves the fixed reports and messages each credited reporter
mushi releases delete <releaseId> --yes          # drafts only
mushi releases stats
```

---

## Spend limits

```bash
mushi budgets show                              # monthly AI budget, auto-fix caps, plan spend cap, auto-fix on/off
mushi budgets autofix off                       # fixes you start yourself always run
mushi billing cap 100                           # the plan's hard monthly cap
```

The monthly AI budget and the auto-fix caps are changed in the console
(**Settings → General → Spend limits**), because that setting takes a signed-in
session, not an API key.

---

## App recipe

```bash
mushi recipe init                    # write a starter mushi.recipe.json from what the repo shows
mushi recipe check                   # validate it and its token files; run Mushi's deviance rules and print the 0–100 score
mushi recipe check --max-score 30    # also fail when the score is above 30
mushi recipe check --push            # send the recipe and the scan from your existing CI job; fails above the project's limit when that gate is on
mushi recipe show                    # each part of the recipe and its state
```

For `--push`, give CI a `mushi login` key (it carries `mcp:read`). A push with
the SDK key (`report:write` only) keeps its findings and the CI gate, but never
sets the score the console shows or dispatches a design fix, because that key
ships inside your app.

---

## Hole checks (radar)

Checks that catch a problem before a user hits it. `scan` runs in your own CI
job; Mushi never clones your repo.

```bash
mushi radar scan                     # storage deletes done in SQL, secret keys in the built app; lists the build files the store rules read
mushi radar scan --push              # send results to Mushi (one extra step in your existing CI job, after the build step)
mushi radar scan --bundle-dir web/dist   # scan only these built client folders (repeatable), e.g. to leave out a server dist
mushi radar show                     # every hole check for this project and what it found
```

Run `scan` **after your build step**: it also reads the built app (`dist`,
`build`, `out`, `.next/static`, `.output/public`, `.svelte-kit/output/client`,
`.vercel/output/static`, native JS bundles) for secret keys. A `dist` that holds
server code counts too; name the client folders with `--bundle-dir` to leave it
out. With no build output, that check is left out and reads "Not checked",
never a pass.
Only the file, the line and the kind of key are sent, never the key itself.
The Supabase anon key and the Mushi SDK key are public by design and are not
flagged.

### One CI step for both checks

`radar scan --push` and `recipe check --push` belong in a job you already
run, so they cost no extra job. Both need `@mushi-mushi/cli` 0.29.0 or later;
an older CLI answers "unknown command", and the packaged action stops with
that version in its error instead. Store a project key as a repo secret first.
The SDK ingest key works; an account-level (org) key does not. Both commands
read the checked-out repo, so the job needs `actions/checkout` before them,
and `radar scan` also reads the built app, so put the step after your build.

**Copy-paste `run:` step**, for any CI system:

```yaml
- name: Mushi checks
  run: |
    npx --yes @mushi-mushi/cli@latest radar scan --push
    npx --yes @mushi-mushi/cli@latest recipe check --push
  env:
    MUSHI_API_KEY: ${{ secrets.MUSHI_INGEST_KEY }}
```

**Packaged GitHub Action**, the same CLI with the inputs spelled out:

```yaml
- uses: actions/checkout@v4
- uses: kensaurus/mushi-mushi/packages/cli@master
  with:
    api-key: ${{ secrets.MUSHI_INGEST_KEY }}
    upload-sourcemaps: 'false'   # set 'true' (the default) to also upload source maps
    radar-scan: 'true'
    recipe-check: 'true'
    # working-directory: apps/web   # if the app is not at the repo root
    # fail-on-error: 'false'        # warn instead of failing the job
```

| Input | Default | What it does |
|---|---|---|
| `radar-scan` | `false` | Runs `mushi radar scan --push`. Findings do not fail the job; they show on the hole checks. |
| `recipe-check` | `false` | Runs `mushi recipe check --push`. An invalid `mushi.recipe.json` (or none) fails the step. |
| `fail-on-error` | `true` | `false` turns a failed check or an unreachable Mushi into a warning. |
| `working-directory` | `.` | The repo root both checks read. |
| `upload-sourcemaps` | `true` | The action's original source-map upload. Uses `release`, `sourcemaps-dir`, `dry-run`. |

Run it on pushes to your default branch. `recipe check --push` records the
commit SHA and branch from `GITHUB_SHA` and `GITHUB_REF_NAME`, and on a pull
request the branch is the merge ref.

---

## Store listings

Copy the live App Store and Google Play listings into the repo once, so the
listing lives as code. It runs with your own keys and sends nothing to Mushi.
Your own CI publishes listing changes after that.

```bash
mushi store pull --asc-key-id <id> --asc-issuer-id <id> --asc-key-path AuthKey.p8 \
  --play-key-path play-service-account.json
```

It reads `store.listingDir`, `store.ios.appleId` and `store.android.package`
from `mushi.recipe.json`. The keys can also come from `MUSHI_ASC_KEY_ID`,
`MUSHI_ASC_ISSUER_ID`, `MUSHI_ASC_KEY_PATH` and
`GOOGLE_APPLICATION_CREDENTIALS`. Review the files before you commit them.

---

## Skill pipelines

```bash
mushi skills list [--category workflow] [--search "fix bug"]
mushi skills show workflow-fix-and-ship
mushi skills sync [--source-id <id>]

mushi pipeline start <reportId> --skill workflow-fix-and-ship [--mode cloud]
mushi pipeline watch <runId-or-prefix>
mushi pipeline checkin <runId-or-prefix> --step 0 --status passed [--notes "Done"]
```

| Mode | Behavior |
| ---- | -------- |
| `handoff` | Prints a context packet for your local Cursor agent |
| `cloud` | Dispatches each step to Cursor Cloud; status streams to the console |

---

## Integrations, keys & Slack

```bash
mushi integrations list
mushi integrations test slack
mushi integrations test sentry
mushi integrations test github

mushi keys list
MUSHI_BYOK_KEY=sk-ant-... mushi keys add --provider anthropic --label "Backup"

# Spend down a Cursor key's expiring credits on open bugs (draft PRs only)
mushi keys spend-down                                   # status of every Cursor key
mushi keys spend-down <keyId> --on --expires 2026-10-31 \
  --model 'grok-4.7?reasoning_effort=xhigh&context=500k' --per-day 20

mushi slack status
mushi slack test
```

Spend-down mode starts `--window-days` (default 14) before the credits expire
and dispatches the best open reports of the apps the key already pays for,
inside each app's auto-fix limits. A key shared by the whole organization is
changed by an owner or admin in the console (Settings, AI keys, Cursor).
It pauses an app on its own when that app's recent agent pull requests review
poorly, then sends one test fix a day until they recover
([agent PR review](/concepts/agent-pr-review#spend-down-and-its-safety-stop)).

---

## Indexing, sourcemaps & deploy

```bash
mushi index ./src                    # upload codebase chunks to RAG
mushi sourcemaps upload --release 1.4.2 --dir ./dist
mushi deploy check                   # edge-function health + latency
mushi test                           # synthetic report end-to-end
```

---

## Several apps

For a team with more than one app. These read team-wide data, so they need an
account-level key (console: **Connect → MCP → account key**), not a key bound
to one project. If you belong to several teams, the error lists each one with
the `--org ` to pass.

```bash
mushi portfolio show                 # each app: health, open reports, holes, SDK version, last release
mushi portfolio findings             # the same problem repeated across apps, SDK skew, integration holes
mushi portfolio resources            # domains, accounts and buckets shared between apps
mushi connectors list                # connectors with status and last error (read-only)
mushi connectors status <id>
mushi connectors actions             # requested connector actions and whether they ran
mushi funnel show                    # one funnel, every app side by side
mushi funnel set --steps signup,first_report,fix_merged --window 7d
mushi releases calendar              # what is waiting to ship in each app, and one suggested batch
```

Adding, probing or editing a connector takes credentials, so it stays in the
console.

---

## Environment variables

| Variable | Purpose |
| -------- | ------- |
| `MUSHI_API_KEY` | Admin or ingest API key (prefer env over `--api-key` flag) |
| `MUSHI_API_ENDPOINT` | API base URL |
| `MUSHI_PROJECT_ID` | Project UUID |
| `MUSHI_CONSOLE_URL` | Admin console base for CLI hints + browser opens |
| `MUSHI_BYOK_KEY` | BYOK key value for `mushi keys add` (keeps key out of shell history) |
| `MUSHI_NO_UPDATE_CHECK=1` | Skip npm registry version nudge in `mushi init` |
| `MUSHI_ASC_KEY_ID`, `MUSHI_ASC_ISSUER_ID`, `MUSHI_ASC_KEY_PATH` | Your App Store Connect key for `mushi store pull` (read on your machine, never sent to Mushi) |

### Config file

The CLI keeps credentials in one `config.json`. The first match wins:

1. `$XDG_CONFIG_HOME/mushi/config.json` when `XDG_CONFIG_HOME` is set, on any platform
2. `%APPDATA%\mushi\config.json` on Windows
3. `~/.config/mushi/config.json` otherwise (macOS, Linux)

On macOS and Linux the file is mode `0o600`; on Windows the CLI restricts its
ACL to your account (and SYSTEM) instead. A legacy `~/.mushirc` auto-migrates
on first load. `mushi setup --help` prints the path it resolved on your
machine.

---

## See also

- [CLI ↔ console loop](/quickstart/cli-console-loop) — create project, mint key, paste into terminal
- [Admin → Onboarding](/admin/onboarding) — success panel + `?setup=cli` deep link
- [Admin → Fix orchestrator](/admin/fixes) — streaming view, CI feedback, console merge
- [Admin → Reports & triage](/admin/reports) — merge from report detail
- [@mushi-mushi/mcp](/sdks/mcp) — MCP tools for agents (`dispatch_fix`, skill pipelines)
- [AGENTS.md](https://github.com/kensaurus/mushi-mushi/blob/master/AGENTS.md) — full agent inventory
