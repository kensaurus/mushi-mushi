# Plan 021 — `mushi ux`: visual UX loop, repo and project groups, console IA

Status (2026-10-06, worktree `.claude/worktrees/ux-loop` on `origin/master` 6f389a34, uncommitted):
- **Built:** Phases 1, 2 and 4. Phase 0 code is done but some probes are owner-owed. Phase 3 is built, including the single `NextStep` component (owner-approved, built 2026-10-06, uncommitted).
- **Outlined:** Phase 5.
- **Applied and deployed:** all three migrations, now all in the migration history, and `api` v657 / `retention-sweep` v148. Production runs this uncommitted code: an `api` deploy from master before it lands would drop the ux-runs, ux-cloud and project-groups routes, while the tables stay.
- **Not yet live:** `@mushi-mushi/ux` is unpublished, so `mushi ux` and the CI action cannot run outside this checkout; the console deploys on push.

Owner decisions taken 2026-10-06.

## 1. Why

The owner asked for three things:

1. **Group repos.** Show a project's frontend and backend repos as one app
   (solo-boss-cloud links `solo-boss-cloud-documentation` and
   `solo-boss-cloud_backend`), and group projects above that.
2. **A console a newcomer understands.** Today there are 77 routes, 5
   dashboards, 3 setup flows and 7 "what next" widgets.
3. **A local loop.** It maps a running app's pages, tabs and dialogs into a
   burndown, then drives a chosen coding agent and model (for example Cursor
   with Grok 4.7, to spend the plan's included credits) one surface at a time
   against screenshot baselines. The run is watched live, with before/after and
   diffs, and ends with a pairwise judge on a different model, grounded in the
   repo's design tokens.

This is a bug-mediator feature (ADR 0004). Each UX problem the loop finds and
cannot fix becomes a report in the normal queue (`reports.source = 'ux_loop'`):
a UX bug found before a user hits it (ADR 0017's drift test).

## 2. Owner decisions (2026-10-06)

| Question | Decision |
| --- | --- |
| Act gate | Lifted fully: local and cloud runs. ADR 0017's exception stands: nothing merges or acts on its own; a run ends in a draft PR, and a cloud run starts only from a console JWT session. |
| Live view | A local dashboard **and** console sync, from the first release. |
| Repo grouping | Both: repos inside a project, and project groups. |
| Where edits land | A git worktree on `mushi-ux/<run>`, with its own dev server. |

## 3. Research basis

| Finding | Source | Design consequence |
| --- | --- | --- |
| GPT-4 screenshot UX audits: 80% error rate, 14–26% discovery | Baymard, "Testing ChatGPT-4 for UX audits" | The judge never auto-accepts. It works pairwise, before vs after. |
| Only 13% of zero-shot Gemini UI critiques were valid | UICrit (UIST '24, arXiv 2407.08850) | The rubric is grounded in tokens and probes, and every claim needs a selector and bounding box. |
| UX-Ray reaches 95% only by limiting itself to validated heuristics | Baymard, "AI heuristic UX evaluations" | A small, fixed rubric, not open-ended critique. |
| Agent + browser + screenshots + a principles file works | OneRedOak `claude-code-workflows/design-review` | Closest prior art. Mushi adds the burndown, any agent, diffs, the cross-page regression check and the bug queue. |
| Cursor CLI runs headless (`agent -p --force --model --output-format stream-json --workspace`) and installs on Windows; `@cursor/sdk` local mode has open Windows bugs | cursor.com/docs/cli/headless; Cursor forum, 2026-10-02 | Subprocess adapters (Cursor, Claude Code, Codex). ACP later. |
| Cursor Design Mode is interactive: point, then prompt | cursor.com/docs/agent/design-mode | No overlap: this loop is a batch that runs unattended and measures itself. |
| Lost Pixel is sunsetting; Argos is the hosted diff service | Argos and OverlayQA comparisons, 2026 | Diff locally with pixelmatch. |

## 4. Phases

### Phase 0 — probes and the repo remainder

- [x] `sdk-upgrade-runner` picks the repo from `project_repos` (primary
  first; backend counts as an SDK host because of `@mushi-mushi/node`; docs
  and infra only as a last resort). The legacy `github_repo_url` stays as the
  fallback. The repo's own branch and its App installation are used. Covered by
  `sdk-upgrade-repo.test.ts`.
- [x] Role chips with icons for all 8 roles (`apps/admin/src/lib/repoRoles.ts`)
  on `/repo`. `/connect` lists every linked repo with its role.
- [ ] Probes (§5): partly run. **Not run, owner-owed:**
  - the Cursor CLI `--list-models` and `?params` check;
  - the Cursor billing probe, the go/no-go for local Cursor runs;
  - the persistent-profile login;
  - the non-GET census on apps/admin.

### Phase 1 — local MVP: `@mushi-mushi/ux` (bin `mushi-ux`) — built

Built: `packages/ux` (guard, discover, capture, probes, image, state, packet, agents, worktree, verdict, loop, judge, dashboard, cli), `mushi ux` proxy in `@mushi-mushi/cli`, ADR 0020, docs (`apps/docs/content/sdks/cli.mdx`, AGENTS.md). Verified: 42 unit tests; two browser suites (`MUSHI_UX_BROWSER_TESTS=1`) prove no write leaves the browser during discovery, keep/rollback/regressed decisions on a fixture repo, and the person's checkout untouched; one live run with Claude Code on the fixture repo (2 screens, 72 s, contrast 4→0, two commits on the run branch). Not verified: the live judge call (no Anthropic credentials on the build host), the Cursor and Codex adapters (CLIs not installed), a run against apps/admin (needs the owner's test account).


A separate package, because Playwright would break the CLI install-size cap.
`mushi ux` in `@mushi-mushi/cli` proxies to it.

- **Discovery.** Next / React Router routes, the sitemap, a same-origin crawl,
  and per-page states (tabs, dialogs, menus). Duplicates are removed by DOM
  hash plus dHash.
- **Hard rule: discovery and capture never write.** Every non-GET request is
  aborted except a per-target allowlist. Forms are never submitted, and labels
  such as delete, remove, pay, send, submit and log out are skipped.
- **Probes.** axe (its `color-contrast` rule is the contrast check), tap targets,
  overflow, console errors and CLS.
- **The loop.** Baseline at desktop and mobile widths, then prompt packet,
  agent run, HMR settle, recapture, pixelmatch and probe deltas, and a cheap
  verdict. Accept means a commit; reject means a revert.
- **Cross-page regression check.** After each accept, re-shoot a sample of the
  surfaces already done; anything that changed goes back on the burndown as
  `regressed`.
- **Judge.** Pairwise, on a different model, using the user's own key.
- **State and dashboard.** A resumable `state.json`, and a localhost dashboard
  served over SSE.
- **ADR 0020.** Local agents run in the CLI process; the edge stays
  cloud-only. It also covers the ADR 0006 boundary (the agent sees screenshots,
  never the session or config) and that dogfooding uses a test account.

**Deviations from the plan in Phase 1 (recorded 2026-10-06):**
- **No CLI subpath exports.** `packages/ux` does not depend on `@mushi-mushi/cli`. Its `packet.ts` lists the repo's design files (recipe, DTCG tokens, Tailwind `@theme` CSS) for the agent to read; it does not parse tokens through the recipe engine.
- **No `gh pr create` at the end of a local run.** The run ends with the `mushi-ux/<run>` branch for the person to review. The cloud action opens the draft PR.

### Phase 2 — console sync, project groups, findings as reports — built

Applied on `dxptnwrhwsqckaftyymj`:
- `20261006100000_project_groups`;
- `20261006100100_ux_runs`, first applied through `execute_sql` in parts after an MCP session error, then re-applied with `apply_migration` (the file is idempotent) so it is in the migration history;
- `20261006100200_reports_source_ux_loop`.

Verified: RLS on, anon has no SELECT, Realtime on, private bucket, no ERROR advisors. `api` and `retention-sweep` are deployed.

Built on top:
- `mushi-ux run --sync`, which PUTs a snapshot and uploads screenshots through signed URLs;
- `/ux-runs` (live through Realtime);
- "File as bug", which files a `ux_loop` report with no AI call;
- `mushi ux-runs list|show|file`;
- project groups (API, CLI `mushi portfolio groups`, Portfolio filter, switcher chips).

Hardened after review: viewers cannot sync, upload, file or start a cloud run (403). Two racing "File as bug" clicks keep one report. The retention sweep picks screens by their run's age through an inner join, so runs it already cleared cannot crowd newer ones out of the 200-row batch (query shape checked live against PostgREST).

Not exercised end to end: a synced run as a signed-in user. The saved CLI key lacks `mcp:write`; `mushi login` mints one.

- **Migrations:** `project_groups`, `project_group_members` (same org only),
  `ux_runs`, `ux_surfaces`, `ux_iterations`, the private bucket `ux-captures`
  with retention, and `reports.source` gains `'ux_loop'`.
- **API:** `api/routes/ux-runs.ts` and org project-group CRUD. Portfolio gains
  a `?group=` filter.
- **Console:** `/ux-runs` under Check, a group filter on Portfolio and in the
  project switcher. Group management (create, rename, delete, members) lives in
  the Portfolio groups bar, not on `ProjectsPage` as first planned.

### Phase 3 — console IA (dogfooding the loop) — built, one item deferred

- [x] **Page hubs** (`lib/pageHubs.ts`, `components/PageHubView.tsx`):
  - Home `/dashboard` (today, apps, users, funnels, insights, growth);
  - App health `/health` (integrations, code, schema, spikes);
  - Team `/team` (members, billing, AI spend, audit log, SSO, compliance, storage).

  Every former route redirects to its view and keeps the query. Plan-gated views are hidden.
- [x] **One setup path:** `/setup-copilot` became the Diagnose tab of `/onboarding`.
- [x] **Settings tabs:** landed on master separately (#442).
- [x] **Stage tones:** already in `Layout.tsx`.
- [x] **Next step:** `NextBestAction` stands down while the Setup guide is open.
- [x] **One `NextStep` component in place of the nudges** (owner approved; built 2026-10-06). `components/NextStep.tsx` (banner / card / inline) fed by `lib/useNextStep.ts`; NextBestAction, QuickstartMegaCta and SetupNudge deleted; the dashboard checklist became the card; checklists, lanes and the setup guide mark one `nextSetupStepId`; a refcounted claim keeps one next step per screen, and the banner stands down while the setup guide or the tour is open.

### Phase 4 — cloud mode — built (host CI, not an edge runner)

**Deviation from the plan, recorded in the ADR 0020 addendum.** Edge functions cannot run a browser, and Browserbase or Firecrawl could not run the probes. So the cloud runner is the host's own GitHub Actions:
- `docs/templates/mushi-ux.yml` (the workflow);
- the public composite action `.github/actions/ux-loop`, the ADR 0019 pattern.

That removes the planned `ux-loop-runner` cron, the generic agent-adapter subject and the preview-URL lookup: the runner starts the app's dev server itself.

- **`--agent cursor-cloud`** (`packages/ux/src/cursor-cloud.ts`):
  - pushes the run branch;
  - `POST /v1/agents` with `workOnCurrentBranch: true` and `autoCreatePR: false`, plus inline PNGs as `{data, mimeType}`;
  - polls the run, then applies the agent's commit to the worktree uncommitted, so measuring and keep/revert are unchanged.

  Wire shape from cursor.com/docs/cloud-agent/api/endpoints (read 2026-10-06), **not yet called live**.
- **Console:** "Run in the cloud" on `/ux-runs` calls `POST /v1/admin/projects/:pid/ux-runs/cloud`.
  - Auth: jwtAuth only; an API key gets 401 (checked live).
  - Rate limit: 3 per hour per app.
  - The route fires `repository_dispatch` `mushi-ux-run` at the front end repo (Contents: write suffices).
  - With no workflow, no connection, an unseen repo, or a refusal, it answers 409 with the `gh workflow run` command in `data.fallback`. A GitHub outage is a 502.
- **Safety:**
  - only `cursor-cloud` runs on CI;
  - the dev server and install get the app's environment without the tool's own keys (`appEnv`);
  - one draft PR per run, opened with `GITHUB_TOKEN`;
  - a cloud run sees the app signed out.
- **Verified:**
  - route tests (`ux-cloud.test.ts`, 10);
  - adapter tests against a real local git remote, including a rejected attempt being replaced;
  - each composite step run under bash with fake `npx`/`gh` (argument building, validation, PR success and failure, output file shape);
  - `api` v656 deployed; anon and API-key requests get 401.
- **Owed:**
  - publish `@mushi-mushi/ux`;
  - one real dispatch against a repo with the workflow and secrets;
  - one live Cursor Cloud run, which also confirms `workOnCurrentBranch` and image acceptance.
- **Owner pricing decision (still open):** a Mushi-hosted judge would need an opt-in entry in `llm-usage.test.ts`. Today the judge runs only on the user's own Anthropic key.

### Phase 5 — A/B (outline, not built)

The existing experiment engine is enough; nothing new on the server until Phase 2 data exists.

1. **Variants.** `mushi-ux run --variants 2` keeps the best two accepted attempts per screen as branches `mushi-ux/<run>/<surface>/v1`, `…/v2`, instead of reverting the runner-up.
2. **Register.**
   - An `experiments` row: `name = ux:<surface label>`, the hypothesis drawn from the probe deltas.
   - One `experiment_variants` row per branch, plus `control`, with `config = { branch, commit, surface_key }`.
   - Uses `api/routes/experiments.ts`; nothing deploys on its own.
3. **Serve.** The host ships the variants behind its own flag. The SDK reports exposure and conversion into `experiment_assignments` (the reporter token is already the unit).
4. **Analyse.** `experiment-analyzer` (CUPED, mSPRT, SRM, Thompson) picks a winner. The console shows it next to that screen's UX-run row, and "Keep winner" opens a draft PR.
5. **Gate.** No variant goes live without the host's own flag and a human merge (ADR 0016/0017).

## 5. Probe results

| Probe | Result (2026-10-06, Windows 11) |
| --- | --- |
| Claude Code `-p --restricted` edits files and reads PNGs | **Yes.** Edited a file in a temp repo; named both colours of a two-colour PNG. |
| Live loop, Claude Code, fixture repo | **Yes.** 2 screens in 72 s; Home contrast fixed (problem score 4→0), nav tap targets raised; one commit per screen; main checkout clean. |
| Dashboard | Renders at 1280 and 390 px with no sideways scroll; request without token → 403; `../` in shot path → 404. |
| Cursor CLI installed | **Yes** (2026.10.01, `%LOCALAPPDATA%\cursor-agent`), signed in with `agent login`. |
| Cursor CLI model ids and `?params` | `agent models` lists flat ids (`grok-4.7-xhigh`); bracket params `id[k=v]` work; the studio maps `id?k=v` to them. 245 models listed live. No 500k context option for grok-4.7. |
| Cursor CLI billing (included usage vs on-demand) | Grok 4.7/4.6/4.5 and Composer 2.5 draw from the plan's "Cursor Models" pool (cursor.com/help/models-and-usage/usage-limits). The owner should still confirm on the usage dashboard after a run. |
| Cursor CLI + Claude Code hooks | The CLI also runs `~/.claude/settings.json` hooks; started under Git Bash a hook fails and every tool call is refused. Started from PowerShell, Grok 4.7 xhigh reads and edits. The run's agent check (preflight, about 30 s) now catches this before any slow step. |
| Live loop, Cursor + Grok 4.7 xhigh + `enhance-mobile-native-feel`, glot.it (run 20261006-093719-2ohc) | All 5 named pages mapped (after the goto fix below), preflight 33 s, heartbeat and live steps synced to the console (`ux_runs.current_progress`), attempt 1 on Home rolled back (mobile problems 0 → 2), attempt 2 running. Final result: see the last row. |
| Discovery dropped a named page with no message | A dev server's full reload during a slow first compile replaces the navigation; Playwright then throws `net::ERR_ABORTED` or resolves `goto` to `null` (reproduced in a fixture). `gotoPatiently` now retries once on either; regression test in `discover.browser.test.ts`. |
| Measuring things that are not the app | An earlier "kept" Home attempt fixed a dev-only build stamp and counted an sr-only skip link as a small target. Screenshots now hide, and axe and the tap-target count skip, dev overlays, build stamps, the Mushi widget, `data-mushi-ux-ignore` and `--ignore` selectors; sr-only and `pointer-events: none` elements are not tap targets. |
| Resume after a killed process | The host ran low on memory and its reaper killed the studio, and the run with it, mid-attempt (10:07 UTC). Resume now needs only the run id. Settings and skill files are saved at start (`state.options`, `<run>/skill/`); a resume clears the old error, reruns an unfinished install, moves the branch back to the last saved kept commit, discards half-made edits and compares against the last kept version. It refuses a run that checked in within 90 s. A browser test kills a run mid-attempt (half edit plus an unrecorded commit) and resumes it to the end. Run 093719 was resumed from the studio's Resume button at 11:22 UTC: preflight 24 s, edits cleared, Home attempt 2 rerun. |
| Layout shift as noise | glot.it Home lost both attempts to CLS 0 → 0.085 (mobile) and 0 → 0.05 (desktop), each under the 0.1 "good" threshold (web.dev/articles/cls), with every other probe at 0. The penalty now counts CLS only past 0.1, matching what the agent's brief already said; rollback reasons name the measure that rose. The run was stopped and resumed on the fixed build at 11:44 UTC (Study's first attempt, 3 min in and with no edits, reran). |
| Agent reads until the time box ends | Grok 4.7 xhigh spent Study's whole 15 minutes reading and searching (0 edits), and Thai Word Bank started the same way. The timeout then ended the screen and labelled it "No change needed". Now the brief's "Start here" lists the page, layout and co-located components (`screenFiles`), with a first edit due within a third of the time box; a timeout gets one more attempt with a firmer note; a screen whose agent never finishes is `blocked` ("Not finished"). The run was resumed on this build at 12:05 UTC. |
| Framework console noise | Study and Words baselines carried React's key warning from Next 16's segment explorer ("Check the render method of `OuterLayoutRouter`"). Listed as a measured problem, it sent Grok into `node_modules/next` for whole attempts. Framework dev-tool messages are now filtered at capture and scrubbed from saved state on start/resume, and the brief forbids `node_modules`. After the 12:3x resume, Words attempt 2 edited within minutes and was kept (commit 1638f84e5), and Account was kept on attempt 1 (e4faafa8c). |
| False "moved by another change" | After Account was kept, Words was re-shot while the dev server recompiled: all skeletons, flagged 58% moved. Captures now wait for skeleton classes or running skeleton/shimmer/pulse animations (glot.it's Skeleton is marked only by `skeleton-wave`), and a regression needs a second confirming shot. The Words flag in run 093719 predates the fix. |
| Run 093719 final (13:23 UTC) | 3 kept commits on `mushi-ux/20261006-093719-2ohc`: Words (1638f84e5), Account ×2 (e4faafa8c, cc72a35bd). Home rolled back ×2 (old CLS rule), Study timed out (framework noise), Chat rolled back ×2 on single-shot CLS 0.14 and 0.118 just past 0.1, Words falsely flagged as regressed (skeleton re-shot). The console row is synced (done, 9 iterations with steps). After the run, CLS past 0.1 now gets a second shot and the lower reading counts (`clsNeedsSecondLook` / `steadierCls`). Home, Study and Chat are worth a rerun on the fixed build. |
| Small steps (owner, 2026-10-06: "can't we break into smaller iterations or parts") | Whole-screen 15-minute attempts lost entire attempts to one problem. Steps mode: a planning pass (≤ 5 min, edits discarded) writes `.mushi-ux/PLAN.md` with 2–5 items (`parsePlan`); each attempt gets one item ("## This step (k of N)"), at most 3 files asked and over 6 files rolled back as too big; no-change moves on to the next step; the plan lives in `SurfaceState.plan` (resumable) and shows as a checklist in the studio. Browser test: plan of 3, step 1 kept, step 2 rolled back (8 files), step 3 not needed, the planning pass's stray edit discarded. Rerun of Home, Study and Chat started 14:13 UTC as run 20261006-141328-dkvu (4 steps × 8 min). |
| Agent ignores in-prompt deadlines | Grok 4.7 xhigh read 30+ files in both of Home's planning passes and never wrote PLAN.md despite "within your first 2 minutes"; its 8-minute whole-screen attempt did the same. Cursor's `agent -p --resume <session_id>` keeps the session's context (probe 2026-10-06: a code word given in run 1 came back in run 2). `runWithNudge` continues the same session once, after a box runs out with nothing to show: PLAN_NUDGE (2 min) and EDIT_NUDGE (3 min). Planning passes keep a step log (`agent/<screen>-plan.steps.log`); a failed plan is retried while the screen has only failed attempts. Browser test: an agent that only ever times out still ends with a plan and a kept step through the nudge. |
| Console walkthrough of run 141328 (owner, 2026-10-07: "everything should be done via the uiux manually") | Signed in as the owner on the local console, 10 problems found and fixed: the "Could not load" tile kept an old label; "edits kept" counted screens (now kept attempts, "on N improved screens"); the plan never reached the console (migration `20261006100500_ux_plan_steps`: `ux_surfaces.plan`, `ux_iterations.step`); attempts said "Attempt n" where the studio said "Step k"; the phone screenshot squeezed the attempts into one narrow column; "File as bug" showed on improved screens; repeated `[find] a search` lines; the cloud-run form came before the runs and filled a phone's first screen; status "stopped" in lower case; run cards showed only agent and model (now status, "N screens · M improved" and the skill). Run 141328 re-synced: Home, Study and Chat each carry a 4-step plan and every step attempt is named. The second pass in the browser caught two more: putting the attempts beside the phone screenshot left them about 290 px, so badges and notes were cut off (now only the plan sits beside it; attempts are full width below), and `parsePlan` cut steps at 240 characters mid-word and mid-code-span (now `cutAtWord`, 280, with "…"; file names render as code and wrap). No sideways scroll at 390 px. Step 1 of Home keeps its old cut text, because the run stored it that way. |
| Owner run, 2026-10-07 ("it is still a little cryptic"; "checked with what? no metadata or status") | (1) Run 032240 mapped 0 screens: all 8 pages HTTP 500 from the rrweb import under Turbopack (the fix ships in `@mushi-mushi/web` with this batch; 1.31.1 on npm lacks it), and the run still said "Done". Now it fails with the reason and the dev server's first error. The studio had fallen back to `npx next dev` because the working `--webpack` command lived only in one browser's localStorage: the launcher now puts the dev command of the newest run that mapped screens first. (2) Run 033253 failed 11 minutes into mapping: /profile redirected to /account on the client and "Execution context was destroyed" failed the whole run; that page is now skipped, and redirect chains and page loads are capped. (3) kensaurus/skills 2.4.0's index missed enhance-mobile-native-feel; the skill list now comes from the folders. (4) Console: the Full-stack audit read the newest 50 runs and the schema scanner filled them, hiding design drift's 82 findings; it now reads every check's newest run and groups findings by check (what checks it, last run, commit, age, rules, a link to the owning page). App blueprint cards say how each part is checked and link to their page. The automated-checks card no longer counts May results as current. (5) The schema scanner flagged all 201 glot.it tables as changed daily (jsonb key order + row-count estimate); it compares schema shape now and records a clean scan as a pass, verified in production. (6) Cursor accounts: Cursor allows several accounts, but its usage policy forbids getting around limits, so the launcher shows the signed-in account and plan (`agent about --format json`) and never switches accounts on its own; no CLI or personal API reports remaining credit, so none is shown. |
| Owner run 2, 2026-10-07 ("is this working? 174 minutes, something is wrong") | Measured on run 041659 (8 screens, Grok 4.7 xhigh): 176 min = 16 startup and mapping + 88 agent + 37 between screens (baseline, 4-5 min planning) + 30 between attempts (83 s each: captures, checks, regression re-shoots). Benchmarked on a small read-only prompt: grok-4.7-xhigh 39 s wall, -xhigh-fast 48 s, -high-fast 31 s, -medium-fast 29 s, with 10-20 s fixed CLI start-up each, so the speed tier was not the cause. Each step re-read 5-19 files and ran 3-23 searches the plan pass had done: steps now resume the planning session (fresh after a rolled-back step). Regression re-shoots once per screen; viewports captured in parallel; named pages warmed together (following redirects). Two of three "moved by another change" flags were the shared browser context: /words lost its empty state after other screens wrote localStorage; captures now use fresh contexts (browser test fails without it). Checker and keep-invisible per ADR 0021: `claude -p --model claude-opus-5-5 --tools Read` read two cropped PNGs and answered in 12 s for $0.13. Skills from npm via jsDelivr (2.5.0, 160 skills, chains from "## Related"). |
| What leaves the machine on `--sync` | Phase, screens, scores (worst of phone and desktop), probe counts, screenshots, and per attempt only the files read and edited (`syncableStep`). The agent's words, commands and output stay in `.mushi/ux/<run>/agent/`. |
| Claude Code CLI | Installed (`~/.local/bin/claude`). |
| Worktree install time | `pnpm install --frozen-lockfile --prefer-offline`: 86 s; then building admin's dependencies: 15 s (turbo cache warm). |
| Service Worker writes vs the guard | Playwright 1.61 + Chromium: with workers **allowed**, the worker's own POSTs were still caught by `context.route` (server saw none). The guard blocks workers anyway, per Playwright's docs. |
| Persistent profile login, non-GET census on apps/admin | Not run: needs the owner at the keyboard and a test account (ADR 0005/0006). |
| Anthropic credentials for the judge | Not on the build host (`ANTHROPIC_API_KEY` unset, no `ant` CLI). Judge tested against a stubbed client only. |
| Cursor Cloud v1 create body (docs, 2026-10-06) | `prompt.images[]` = `{data, mimeType}` or `{url}`, max 5, 15 MB each. `workOnCurrentBranch: true` pushes to `startingRef` instead of a new `cursor/...` branch. No `branchName` field. Not yet exercised live. |
| `repository_dispatch` permission (GitHub docs) | Contents: write; `client_payload` max 10 top-level keys, under 64 KB; success is 204. |
| Composite action steps | Each `run:` block extracted and run under bash with fake `npx`/`gh`: argument building, input validation (bad model, shell characters, a non-cloud agent all refused), draft PR opened, refusal → warning with a compare link, no PR when no screen kept a change. |
| Gates (final, 2026-10-06) | server 298 files / 3927 tests; admin 287 / 1880; cli 55 / 672 (with `MUSHI_*` unset); ux 12 / 64 incl. both browser suites; admin typecheck + lint 0 errors; ux tsc + eslint; knip production and default under their ratchets; surface-parity, nav-registry, install-size, docs-stats, helm-migrations, changeset-coverage, route-manifest regenerated, console-knowledge unchanged; test:scripts 293/0; `deno check` api: only the 4 known errors (connectors/jwt ×2, public-page-store, recipe). |
