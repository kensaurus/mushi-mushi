# AGENTS.md — Mushi Mushi Agent Conventions

This file describes the autonomous agents, edge functions, and orchestration
patterns used across the Mushi Mushi monorepo. It follows the OpenAI
[ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans)
philosophy: self-contained, machine-readable plans that any AI coding agent
can execute without additional context.

---

## Positioning — read this before you touch any user-facing surface

> The canonical constitution is [`/VISION.md`](./VISION.md). This block is the
> compressed copy so on-message behavior survives even when an agent only loads
> `AGENTS.md`. If this and `VISION.md` ever disagree, `VISION.md` wins — fix it
> here, don't fork it. Drift is enforced against by
> [`scripts/check-positioning-consistency.mjs`](./scripts/check-positioning-consistency.mjs).

**North star.** Your AI shipped it. Mushi tells you why it broke — in plain English, in your editor, with the fix ready to go — so a bug costs you five minutes instead of your whole afternoon.

**Category we own.** The bug mediator for AI-built apps — one queue between your users, your monitoring (Sentry/Crashlytics/Rollbar), your tracker (Linear/Jira/GitHub), your chat (Slack/Discord/Teams), and your coding agents, where every bug gets a plain-English diagnosis and a ready fix. (Not "error monitoring", not "observability" — those are someone else's ops-coded words.)

**The app recipe** (ADR 0016) is diagnosis context, not a new category: every
recipe element is optional, renders "not connected" when empty, and changes
ship only as reviewed draft PRs. It never leads a public surface.

**Primary buyer.** The solo / indie **vibe coder** who builds fast with AI (Cursor, Claude Code, Lovable, Bolt), ships to real users, then loses afternoons when something breaks because they don't fully grasp the generated code. Small teams and agencies are secondary; the enterprise SRE running Sentry + Datadog + Firebase is explicitly *not* who we lead with.

**Portfolio operator** (ADR 0017) is the same vibe coder with several apps.
Portfolio and radar features never lead a public surface; the claim is
"nobody bundles this for a solo operator", never "nobody does this".

**The three things we will not do** (drift tripwires):

1. **We will not require a monitoring stack to get value.** Standalone-first, always — every inbound integration is an optional on-ramp, never a prerequisite.
2. **We will not make you rip anything out.** Sentry, Linear, Slack, your agents all stay — Mushi mediates between them. Enterprise plumbing (SSO, region routing, Helm) still lives in `docs/operators/` and never leads.
3. **We will not let the surfaces diverge.** The tagline, the north-star sentence, and the buyer stay identical across npm, repo, landing, and this file.

The "is this drift?" test for any feature you build or surface you write: *"Does this help a solo vibe-coder understand and fix a bug faster, without leaving their editor?"* Yes → it can lead. No, but operators need it → `docs/operators/`, never the hero.

**Engineering yardstick** ([ADR 0039](./docs/adr/0039-better-models-make-mushi-better.md)). Before you build or change a feature, ask: *"When the models get better, does this get better on its own?"* The model is a setting, never a constant (project or organization column → edge secret → code default). Facts and safety (advisory matching, merge gates, test proof, budgets, permissions) are deterministic code; judgement (diagnosis, fix plans, review) goes to the model. Feed the model evidence, not prompt workarounds, and store outcomes per model so "better" shows.

**Decision memory.** Before proposing a change to architecture, dependencies, conventions, positioning, or testing posture, read [`docs/adr/INDEX.md`](./docs/adr/INDEX.md). Do not contradict an Accepted ADR silently — surface it, cite the ADR, and ask. A reversal produces a superseding ADR, by the human, on purpose. New decisions that meet the bar in the index land as an ADR in the same PR.

**Parked work.** Read [`docs/BACKLOG.md`](./docs/BACKLOG.md) before planning. New parked work adds a `BL-` row in the same PR.

---

## Agent Inventory

<sub>19 pipeline agents — run <code>pnpm docs-stats</code> for live edge-function, migration, and package counts. Checked Oct 16 2026: every function under <code>packages/server/supabase/functions/</code> is named on this page, and the CLI table matches the command groups registered in <code>packages/cli/src/index.ts</code>.</sub>

| Agent | Location | Trigger | Description |
|-------|----------|---------|-------------|
| `classify-report` | `supabase/functions/classify-report/` | `reports` INSERT | LLM triage: severity, category, blast-radius |
| `fix-worker` | `supabase/functions/fix-worker/` | manual / classify result | Opens a draft GitHub PR for a fix; auto-readies PR via GraphQL `markPullRequestReadyForReview`. Refactored to import branch/commit/PR helpers from `_shared/github-pr.ts`. A cloud dispatch on a report that had earlier attempts adds what they did (each PR's latest Opus review and serious findings, or the agent's no-PR note), screened and fenced (`_shared/prior-attempts.ts`), so a re-dispatch does not repeat a rejected theory. |
| `sdk-upgrade-worker` | `supabase/functions/sdk-upgrade-worker/` | POST from `sdk-upgrade` route | **NEW** Reads the connected repo's `package.json`(s), bumps `@mushi-mushi/*` to latest npm versions, opens a draft PR + marks ready. Writes result to `sdk_upgrade_jobs`. When the host has `.github/workflows/mushi-sdk-lockfile.yml` (ADR 0019) it pushes the bump as one commit and parks the job in `awaiting_lockfile` instead of opening the PR. Guards: allow-listed paths, semver-only bumps, vault token resolution, `requireServiceRoleAuth`. |
| `sdk-versions-cron` | `supabase/functions/sdk-versions-cron/` | pg_cron daily 02:30 UTC + release.yml | **NEW** Fetches latest stable version for every `@mushi-mushi/*` package from the npm registry and upserts into `sdk_versions` so freshness chips are accurate between hand-authored migrations. Service-role bearer (pg_cron) or a GitHub OIDC token from `release.yml` (`_shared/github-oidc.ts`). |
| `sdk-release-sync` | `supabase/functions/sdk-release-sync/` | pg_cron every 5 min | **NEW** Polls GitHub for active SDK upgrade jobs (`pr_opened \| ready_to_merge \| blocked \| merged \| deploying`): fetches PR detail, latest check-run, and deployment status (normalized via `normalizeDeployStatus`), then upserts CI/deploy/release status into `sdk_upgrade_jobs` to drive the release-cockpit chips. First opens the PR for `awaiting_lockfile` jobs once the host lockfile workflow pushed (or after 30 min, with a note). `requireServiceRoleAuth`. |
| `inventory-propose` | `supabase/functions/inventory-propose/` | manual / cron | Proposes user-story inventory from SDK observation data |
| `story-mapper` | `supabase/functions/story-mapper/` | POST /map-from-live | Crawls live app URL (Firecrawl/Browserbase) → Claude drafts `inventory.yaml` → `inventory_proposals` (source=live_crawl); opt-in Cursor Cloud PR |
| `test-gen-from-story` | `supabase/functions/test-gen-from-story/` | POST /stories/:id/generate-test | User story → Playwright TypeScript test + Firecrawl YAML + draft GitHub PR + `qa_stories` row; gated by `automation_mode` |
| `test-gen-from-report` | `supabase/functions/test-gen-from-report/` | manual | LLM generates a Playwright test from a bug report + opens a PR |
| `pdca-runner` | `supabase/functions/pdca-runner/` | queued runs / cron | Producer/Critic PDCA loop; **mode=qa_story_improve** analyzes failed qa_story_runs and proposes improved tests (source=pdca) |
| `inventory-crawler` | `supabase/functions/inventory-crawler/` | cron / manual | Crawls app routes to populate `inventory_nodes` |
| `inventory-gates` | `supabase/functions/inventory-gates/` | manual | Runs gate checks (dead handlers, mock leaks, …) |
| `judge-batch` | `supabase/functions/judge-batch/` | cron | Grades LLM fix quality; feeds `judge_results` |
| `generate-synthetic` | `supabase/functions/generate-synthetic/` | cron | Synthetic-monitor smoke tests via Playwright |
| `qa-story-runner` | `supabase/functions/qa-story-runner/` | cron (every minute) | Executes QA Coverage stories via Firecrawl / Browserbase / local; gates on `approval_status = 'approved'` |
| `intelligence-report` | `supabase/functions/intelligence-report/` | cron | Weekly LLM narrative from KPI trends |
| `a2a-push-notify` | `supabase/functions/a2a-push-notify/` | manual / other agents | Sends A2A protocol notifications to connected agents |
| `backend-drift-scanner` | `supabase/functions/backend-drift-scanner/` | cron daily 03:05 UTC | Snapshots each linked project's Supabase schema via read-only MCP, diffs vs previous snapshot, writes `gate_findings` of type `schema_drift` for dropped columns / missing RLS / unexpected table changes |
| `skill-sync` | `supabase/functions/skill-sync/` | cron daily + POST /v1/admin/skills/sources/:id/sync | Fetches SKILL.md files from allowlisted GitHub repos (any skills.sh-compatible repo, default: kensaurus/skills), parses frontmatter + chain_slugs, embeds descriptions (pgvector), upserts `agent_skills` catalog; secret-pattern scan guard; drives `classify-report` Stage 2 skill recommendation |

### Infrastructure worker edge functions (not pipeline agents)

Cron, billing, retention, and platform hygiene workers live alongside the 19 pipeline agents above. They are **not** user-facing agents but must be deployed for a **complete self-host**. Full list: run `pnpm docs-stats` and inspect `packages/server/supabase/functions/`.

| Function | Role |
| --- | --- |
| `fast-filter` | Stage-1 cheap triage before `classify-report` (invoked by `api`) |
| `ci-sync` | Polls GitHub check-runs for open fix PRs |
| `ci-jobs-collector` | Every 10 minutes (:02 to :52; Plan 022, ADR 0033): reads GitHub Actions runs updated in the last 2 h on every branch of each project's repos (≤40 calls a tick, fair across projects), classifies each job (`_shared/ci-infra.ts`: runner lost, waiting for a runner and queue expired are infra, never code failures) into `ci_jobs`, derives `ci_runners` (one-job `<label>-<seconds>` runners fold into their label), reads the repo runner list when the token has Administration: read, records each repo's visibility and owner once a day (Metadata: read; ADR 0037: public repos run GitHub minutes free), and deletes job rows and samples older than 30 days. Hosted vs self-hosted comes from the job's `runner_group_name` ("GitHub Actions" = hosted). `GET /v1/admin/ci/overview?refresh=1` live-syncs queued and running jobs at most once a minute per project. Host health arrives through `POST /v1/ingest/runner` with a `runner:write` key only (`mushi runner heartbeat` / job hooks). Cost and speed (ADR 0037): `GET /v1/admin/ci/compare` (SQL aggregate `ci_runner_comparison`, cost figures per organization in `ci_cost_settings`; MCP `get_ci_costs`, `mushi runner compare`), read-only; money is always estimated. Where CI runs (ADR 0037): `api/routes/ci-placement.ts` previews and requests a change to one allowlisted repo variable (`LINUX_RUNNER`, `RUNNER_<WORKFLOW>`) as a legacy-backed GitHub `connector_actions` row; an owner/admin console session approves (1 h) and executes it; the GitHub connector's act() checks the allowlist, `ci_runner_policies` and a compare-and-set (409 `VARIABLE_MOVED`) with the project's stored PAT; each tick also evaluates `ci_placement_watches` from `ci_jobs` (the next 10 moved jobs). Never runner labels, registrations or a dispatcher |
| `retention-sweep` | Applies data-retention policies |
| `stripe-webhooks` | Stripe subscription + invoice events |
| `slack-interactions` | Slack interactive payloads + threaded replies |
| `webhooks-github-indexer` | GitHub App push → codebase RAG indexer |
| `usage-aggregator` / `usage-alerts` | Stripe meter events + quota alerts |
| `anomaly-detector` | Hourly anomaly scoring |
| `codebase-analyze-worker` | Builds symbol graph on push / manual re-analyze |
| `console-knowledge-build` | Rebuilds console knowledge corpus |
| `integration-health-probe` | BYOK + integration probe cron |
| `plugin-dispatch-retry` | Retries failed outbound plugin deliveries |
| `qa-story-runner` | Scheduled QA story execution (also listed above) |
| `sdk-versions-cron` / `sdk-release-sync` | SDK freshness catalog + upgrade PR CI sync |
| `sentinel-audit` | Inventory drift vs SDK observations |
| `sentry-seer-poll` | Proactive Sentry Seer intake |
| `soc2-evidence` | Compliance evidence snapshots |
| `status-reconciler` | Inventory action status derivation |
| `synthetic-monitor` | Periodic health-check + post-PR probes |
| `tremendous-redemption-worker` | Reward payout fulfillment |
| `mistake-clusterer` / `mistake-summarizer` | Closed-loop mistake clustering + lesson summarization |
| `release-builder` | Auto-drafts release notes / changelog credit |
| `contract-graph-builder` / `drift-walker` | API contract graph + live-route drift crawl |
| `experiment-analyzer` | A/B experiment analysis |
| `prompt-auto-tune` | Classifier / prompt A-B tuning from judge feedback |
| `library-modernizer` | Library modernization proposals |
| `invitation-reminders` | Pending invite reminder cron |
| `lifecycle-emails` | Hourly at :37; four activation emails for new accounts (day-0 welcome, day-2 nudge, day-7 stalled, day-7 activated). Off until `mushi_runtime_config.lifecycle_emails_enabled = 'true'`; idempotent through `lifecycle_email_sends` |
| `recompute-tester-reputation` | Tester marketplace reputation recompute |
| `reward-payout-aggregator` | Aggregates reward payout batches |
| `recipe-collector` | Daily (03:35 UTC) refresh of each project's `mushi.recipe.json` + DTCG tokens into `app_recipe_snapshots`, then the `design_drift` deviance scan (Plan 019 Phase 1b) |
| `radar-scan` | Daily (04:05 UTC) hole checks per project (Plan 020): public probes (store names, listing locales, domain and certificate expiry, security headers, privacy link) and store-policy rules read from the repo → `gate_runs` gate `portfolio_radar`. Host CI pushes `portfolio_radar_ci` via `POST /v1/ingest/radar` (`mushi radar scan --push`) |
| `operator-digest` | Hourly at :20; sends each organization's opt-in daily digest (new reports, holes, releases, AI spend jump; weekly signups/activations per app on `gtm_weekday`) once a day at its `send_hour_utc` to Slack, Discord, Teams, Telegram (each through one project's existing connection), email or push (Plan 020 §9; `operator_digest_settings`, off by default) |
| `store-review-intake` | Every 6 hours at :45; per-project opt-in (`project_settings.store_review_intake_enabled`): reads App Store / Google Play reviews through the project's bound store connectors, dedupes in `store_review_items`, files reviews at or under `store_review_max_rating` (default 2) as reports with `source = 'store_review'` |
| `site-watch-poll` | Hourly at :14, and about 1 and 2.5 min after "Check now"; reads the finished checks of each project's Firecrawl crawl monitor (live-site watch, ADR 0024; `site_watches`, billed to the project's Firecrawl key) and records each broken page (5xx, linked 4xx, load error, judged breakage) as a suspect in `site_watch_pages`. A suspect files as a report with `source = 'site_watch'` only after a second failure (ADR 0029): a confirm scrape on the project's own key (`/v2/scrape`, `waitFor` 10 s, fresh; ≤6 per run shared fairly across watches, never on the platform env key) still sees it broken, or, for 5xx/4xx/load errors only, two checks in a row. Low-severity fallbacks: a confident judged break left inconclusive for 2 checks ("unconfirmed"), a 5xx found healthy 3 times in 7 days ("intermittent"). Judge fail-open is never evidence; a healthy confirm drops the suspect; one open finding per page |
| `site-audit` | Hourly at :29, and right after "Run now" (`POST /v1/admin/projects/:id/site-audit/run`, 3 an hour per app); the site audit (ADR 0040, `site_audits`, off by default, billed to the project's Firecrawl key): every `cadence_days` (default 7) maps the live site and starts a fresh Firecrawl batch scrape (html + links + markdown, ≤`page_limit` pages under `base_url`, the site watch's user agent), then on a later tick runs deterministic rules (`_shared/site-audit.ts`: dead internal/external links and images by 404/410/5xx/unreachable only, missing title/description/lang, localized metadata in another script, another locale's text in the body, links that drop the locale, images without alt) and files one report per failing rule (`source = 'site_audit'`, `site_audit_findings`); an open report is refreshed, a dismissed one never refiled, a fixed one refiled when the rule fails again. Settings and Run now on /credits |
| `search-rank` | Daily at 04:47, and right after "Check now" (`POST /v1/admin/projects/:id/search-ranks/run`, 3 an hour per app); search rank check: for each keyword in `search_rank_keywords` not checked in 7 days (≤40 a run), Firecrawl `/v2/search` top 20 in its country on the app's own Firecrawl key, stores the app's position (`_shared/search-rank.ts`, its watched/audited address as target), the leading hosts and a `search_rank_history` row. Keywords edited on /credits; files no reports |
| `spend-down-worker` | Every 10 minutes (:08 to :58); spend-down mode (ADR 0028): for each Cursor key with spend-down on and inside its window (`byok_keys.credits_expire_at` minus `spend_down_window_days`), dispatches the best open reports of the apps the key already serves (ADR 0023 order) as automatic `cursor_cloud` fixes, up to `spend_down_daily_limit` a day, inside each app's auto-fix caps, ≤3 running per app (`project_settings.autofix_max_concurrent` lowers it where every agent push runs slow or shared CI); the stop-loss (ADR 0028 amendment) pauses an app when, over its spend-down runs of the last 14 days (newest 40, 20+ samples, after its last Resume), the one-sided 95% Wilson bound puts its Opus merge rate under 20%, hold rate over 35% or no-PR share over 50%; a paused app gets 1 probe dispatch a day and resumes on 25% / 30% / 45% point estimates, 2 merged probes (which also reset its window), aging out, or Resume (`POST /v1/admin/byok/spend-down/projects/:projectId/resume`, console); logs `spend-down.paused` / `spend-down.resumed` once per change; a report whose newest PR Opus held is retried after 12 h, under 3 attempts, with the earlier attempts' findings in the prompt (ADR 0028 amendment 2026-10-24, `reportsToRetryAfterHold`); a key Cursor refuses for its usage limit is marked `byok_keys.exhausted_until` (6 h): new agents and spend-down's app assignment go to the next key in the pool while its running agents keep polling with the key recorded on the attempt (`external_agent_ref.key_id`); one tick per key via the `byok_keys.spend_down_claimed_until` lease; writes `spend_down_last_summary`. `GET /v1/admin/byok/spend-down` adds each key's 7-day scoreboard (runs → PRs → Opus verdicts → merged, latest review cost per PR) computed on read, per-app detail limited to the caller's apps |
| `agent-pr-review` | Every 10 minutes (:03 to :53), and on `POST /v1/admin/fixes/:id/review`; the agent PR review gate (ADR 0030): claims up to 8 due `fix_reviews`, one per project, re-reviews of a pushed PR before first reviews (queued when a cloud agent's PR is accepted as a fix, and 5 min after a push to a reviewed PR), each under a `run_id` claim token, sends the report, PR description, CI state and a budgeted diff to Claude Opus 5.5 on the project's own Anthropic key (skipped, with the reason stored, without one or when `project_settings.agent_pr_review_enabled` is off), stores the merge / fix_first / hold verdict with tokens and cost, adds a `reviewed` fix event and one PR comment. `{ backfill: true, limit }` queues open cloud-agent PRs that have none |
| `review-followup` | Every 10 minutes (:06 to :56); review follow-ups (ADR 0032): when an Opus review (ADR 0030) says `fix_first` on a PR's current head, starts one NEW Cursor agent on that PR (`repos[].prUrl`, `workOnCurrentBranch: true`, `autoCreatePR: false`, deterministic agent id) with the report's summary and diagnosis and every finding, to fix exactly those, add tests and push to the same branch. Only PRs a cloud agent opened (`cursor_cloud` / `github_cloud_agent`), whose live head is the agent's own branch in the base repo (no forks); once per (fix attempt, reviewed head), ≤2 per PR, never on hold / merge / a closed or merged PR / auto-fix off; findings screened (only files the PR changed; none reading as instructions to the agent or whose fix carries a foreign URL or a shell command). Key and model per organization (`organizations.review_followup_*`; `review_followup_escalation_model` runs a PR's last round on a stronger model, ADR 0032 amendment 2026-10-23; off by default, `review_followup_enabled_at` + 3 days of backlog, 30 a day; deleting the chosen key turns it off; never the platform env key; model checked against the key's `GET /v1/models`, cached 1 h, unlisted waits); inside the app's auto-fix caps (`checkAutofixBudget` counts follow-ups), not stopped by the spend-down stop-loss. `run_id` claims; Cursor 4xx skips (`cursor_rejected`), 5xx/429 back off on `cursor_failures`; a deleted key stops the run's watch (`key_removed`), never falls back; polls the agent, cancels it after 6 h, re-queues the review with force on a push, `followup` fix events, `verdict_after` once the new head is reviewed (`fix_review_followups`). CI repair (ADR 0032 amendment, 2026-10-22): a `merge` review whose head fails CI on the code (`ci_jobs`, latest attempt per job; never an infra stop, an approval or a workflow-file error) queues one `kind = 'ci_repair'` follow-up under the same caps and rules, with the failing check names and a screened, bounded log excerpt (`GET /actions/jobs/{id}/logs`), asking the agent to make CI green without weakening tests |
| `fix-verifier` | Every 10 minutes (:04 to :54), and on `POST /v1/admin/fixes/:id/verify`; verified fixes (ADR 0035, Plan 024): for each open cloud-agent PR whose Opus review is about its head (≤10 a tick, ≤3 per app), stores the merge gates for that head in `fix_merge_gates` under a `run_id` claim: Opus review merge, CI green (an infra stop is pending, ADR 0033), the host's **Mushi verify** check (`docs/templates/mushi-verify.yml`: a changed test fails without the fix and passes with it), no weakened tests (deleted test files, removed assertions, `.skip`/`.only`/`@ts-ignore`/`eslint-disable`…, CI config, lockfiles, snapshots over 50 lines, the app's protected globs), the diff budget (`verify_max_files` / `verify_max_lines`), then a second review by another model family on the app's own OpenAI or OpenRouter key (never the platform key; none = unavailable). When all pass and `project_settings.verified_auto_merge` is on (off by default), merges under the daily limit through `gatedMergePullRequest` as a service caller pinned to the head (it can never override a hold). Watches Mushi merges for 72 h (CI on the merge commit, a reopened report, a new report in a changed file) into `fix_regressions`, sets `fix_attempts.regressed_at` (counted as a hold by the spend-down stop-loss) and, with `auto_revert = 'pr'`, opens a `mushi/revert-<sha>` PR only when no later commit touched the fix's files; never merges a revert |
| `vuln-watch` | Daily at 05:25 UTC, and on "Check now" (`POST /v1/admin/projects/:id/vulnerabilities/scan`, also started by `POST /v1/admin/projects/:id/radar/run`); known holes (ADR 0038): reads the primary repo's lockfiles (npm, pnpm, yarn, composer, poetry, uv, pinned requirements, go.sum) and runtime pins (Dockerfile `FROM`, `.nvmrc`, `.tool-versions`, composer `config.platform.php`, go.mod `toolchain`) at the default-branch head, skipping fixtures and examples; matches exact versions on OSV.dev `querybatch` (runtimes through OSV's Bitnami and Go `stdlib` records, plus the hand-kept `runtime_advisories` table for the days before OSV has them, php2shell first), caches records in `vuln_advisories` (refetched when OSV's `modified` changes, ≤300 a run), enriches from CISA KEV (daily) and EPSS (`vuln_cve_signals`), stores `dependency_vulns` (coordinates only, never a lockfile), files one `security_advisory` report per (package, fixed version) per repo for production versions with a fix, status `classified` with a plain-English template and no model call (no diagnosis quota), up to `project_settings.vuln_reports_daily_limit` (default 10) a day, and records gate `portfolio_radar_vulns` (rules `known_vulnerable_dependency`, `runtime_end_of_life` from endoflife.date). Severity: KEV → critical; EPSS ≥ 0.1, CVSS ≥ 9 or a critical label → high; imported → +1; dev-only → info, never filed. Only package names and versions leave Mushi |
| `merge-queue` | Every 5 minutes (:01 to :56), and right after a person queues PRs on `/fixes` (`POST /v1/admin/merge-queue`, console only); "Merge when ready" (ADR 0041): one queued PR per repo at a time (`fix_merge_queue`): behind → GitHub update-branch, CI running → wait, CI failed / branch protection → blocked with the reason (re-checked only where nothing else in the repo moves), clean → merged as a service caller through `gatedMergePullRequest` pinned to the head (needs an Opus merge verdict on that exact head; a stale one is re-queued and waited for), then `finalizeFixMerge`; a conflict → a Cursor agent on the PR branch with the organization's review follow-up key and model, only while follow-ups are on, ≤2 per PR, given up after 90 min without a push; `merge_queue` fix events. Release trains (ADR 0044, default `project_settings.release_mode = 'train'`): per repo, once per `train_interval_minutes` (360) or at `train_max_members` (15) ready, merges the Opus-approved PRs into one `mushi/train/<UTC>` branch (GitHub merges API) and one train PR (`release_trains`), CI once, then `gatedTrainMerge` re-checks each member and merges with a merge commit; red → bisect (first half again, a lone failure held); a member that leaves the queue or loses its approval rebuilds the train; `security_advisory` and critical reports take the single-PR express lane; mode and interval via `PUT /v1/admin/projects/:id/release-settings` (console) |
| `skill-runs` | Every 10 minutes (:07 to :57), and right after a person starts one on /credits (`POST /v1/admin/projects/:id/skill-runs`, console only); skill runs (ADR 0042): one measurable skill from the synced catalog (`SKILL_RUN_SKILLS`) on one scope of one app, ≤5 rounds (`skill_runs`, ≤5 active per app). Files each round as a classified report (`source = 'skill_run'`, reporter `cron:skill-runs`) with the task, the before/after measurement and the skill's SKILL.md (≤12,000 characters); spend-down dispatches it on the app's pooled Cursor key. With `auto_merge` (default on) an Opus-approved round PR is put into `fix_merge_queue`. Next round after a merge (naming the merged rounds); done on `already_fixed`/`not_actionable` or the last round; stopped on `needs_human`, `wrong_repo`, a dismissed round or a closed PR |
| `healthz` | Unauthenticated liveness + cheap DB probe (`{status, db, version}`); `verify_jwt = false` |
| `linear-oauth-callback` | Completes Linear OAuth; vaults tokens; registers inbound webhook |
| `webhooks-linear` | Linear issue push webhooks (HMAC); resolves linked reports on completed/cancelled |
| `webhooks-linear-agent` | Linear AgentSessionEvent webhooks (acknowledge within 10s; may dispatch fix-worker) |
| `reporter-notify-fanout` | Email / push for a developer reply to a reporter; enqueued by the `report_comments` trigger, which stays the in-app writer (Plan 018) |

Also: **`api`** (Hono REST router), **`api-ext`** (the overflow half of the admin API: `api` forwards the CI runner, verified-fix, inventory, Ask Mushi, Codebase Atlas, modernization / super-admin, agent-skills, QA coverage, full-stack audit and UX-run paths there with the caller's headers, because `api` hit Supabase's 5 MB deployment size limit on 2026-10-21 and again on 2026-10-22; public URLs are unchanged, `_shared/edge-proxy.ts`; `scripts/deploy-edge-function.test.mjs` holds `api` under the last upload size known to deploy) and **`mcp`** (Streamable HTTP MCP transport) — infrastructure, not agents.

---

## QA Coverage Suite

The QA Coverage Suite (`qa-story-runner`) is the primary agent orchestration
layer. It allows users to define user-story tests as NL prompts or full
Playwright scripts, schedule them via cron, and run them on three providers:

### Providers

| Provider | Where it runs | When to use |
|----------|---------------|-------------|
| `firecrawl_actions` | Firecrawl cloud (Deno-compatible, HTTP) | Default. No setup. Works for content verification and basic navigation. |
| `browserbase` | Browserbase cloud Chromium | Complex UI interactions. Requires a Browserbase API key — configure via **Settings → Web tools** in the admin console (stored in Supabase Vault; see [BYOK Providers](#byok-bring-your-own-key-providers)). |
| `local` | Operator's machine via CLI | Full Playwright access. Not schedulable via edge function. Use `mushi qa run <story-id>`. |

### Story lifecycle

```
User creates story (NL prompt or Playwright script)
  → stored in `qa_stories` table (schedule_cron default: '0 * * * *', hourly)
  → pg_cron fires qa-story-runner every minute
  → cron-matching gate: only run if story schedule aligns with current UTC time
  → enabled check: disabled stories are skipped entirely
  → rate-limit check: max 3 concurrent runs per project (MAX_CONCURRENT_PER_PROJECT)
  → BYOK key resolution (firecrawl / browserbase / openai from mushi_runtime_config)
  → execute via provider (inline HTTP or Browserbase REST)
  → write qa_story_runs (status, latency_ms, provider_session_url, assertion_failures)
  → write qa_story_evidence (screenshots, console logs, HAR, video, traces)
  → update qa_stories state columns (last_run_status, consecutive_failures, slack_failure_ts, last_notified_at)
  → qa_story_coverage_24h MV refreshed by separate pg_cron (every 15 min)
  → Slack notification policy (transition-aware):
      • pass→fail or error: post new Block Kit message to project's Slack channel (store thread ts)
      • consecutive failures: threaded reply with backoff (1st, 3rd, 10th, then daily)
      • fail→pass: threaded "recovered after N failures" message, state reset
  → dispatchPluginEvent('qa_story.failed' | 'qa_story.recovered') for fan-out to Discord, Teams, etc.
  → Discord: direct webhook post to project_settings.discord_webhook_url (no relay plugin required)
```

**Important correction (Jun 2026):** The `a2a-push-notify` agent is listed in the agent inventory but is NOT invoked on QA story failure. The previous `a2a_push_deliveries` insert in `qa-story-runner` and `notifyA2A` in `pdca-runner` were schema-mismatched and silently failing; they have been removed. QA failure notification now routes through the Slack Block Kit policy and `dispatchPluginEvent`.

### Manual run trigger

`POST /v1/admin/projects/:pid/qa-stories/:sid/run` (requires story to be enabled, returns 409 otherwise) inserts a `pending` run row and fire-and-forgets a call to the `qa-story-runner` edge function with `{ trigger: 'manual', story_id, run_id }`. The runner picks it up immediately.

### AI-assisted authoring

When a user triggers "Generate test from report" in the Reports page:
1. `test-gen-from-report` edge function generates a Playwright TypeScript test
2. A draft GitHub PR is opened
3. A `qa_stories` row is automatically created (provider: `local`, weekly cron)

---

## Code Health Ingest (Jun 2026)

`POST /v1/ingest/metrics` — CI-push endpoint that records host-app bundle sizes and god-file LOC
findings into `metric_series` (time-series) and `gate_runs` / `gate_findings` (the new
`code_health` gate). Uses the same `apiKeyAuth` middleware as all other SDK ingest routes.

| Payload key | Type | Description |
|---|---|---|
| `metrics[]` | `MetricPoint` | `{ metric_name, dimension?, value, ts? }` — prefix allow-list: `bundle.`, `code_health.` |
| `findings[]` | `CodeHealthFinding` | `{ rule_id, severity, file_path?, line?, message, suggested_fix? }` |

The admin console `/code-health` page reads the data back via `GET /v1/admin/code-health?project_id=`.

**yen-yen integration**: `scripts/scan-god-files.mjs` scans `apps/mobile/app`, `apps/mobile/components`, `apps/mobile/lib` for files over 2,000 LOC. `.github/workflows/bundle-budget.yml` posts bundle KB + scan findings on every push to `main`. Requires `MUSHI_API_URL` + `MUSHI_INGEST_KEY` repo secrets on `kensaurus/yen-yen` (mint via Projects → SDK ingest key; `scripts/setup-yen-yen-ingest-secrets.mjs` automates Playwright + `gh secret set`).

---

## BYOK (Bring Your Own Key) Providers

Project-level API keys are stored encrypted in the `byok_keys` table via
Supabase Vault (`vault_store_secret` / `vault_get_secret` helpers). The unified
`resolveLlmKey(provider, projectId)` function in `_shared/byok.ts` tries, in
order: the project's own `byok_keys` rows, the legacy
`project_settings.byok_<provider>_key_ref` column, its organization's shared
rows (ADR 0023), the universal rows of its organization's owners (ADR 0031),
then the environment variable. A row has exactly one owner (`project_id`,
`organization_id` or `owner_user_id`); new console keys default to universal.

Keys are managed self-service in the admin console. **Settings → AI keys**
(`ByokPanel`) lists the key pool for every slug below and adds keys through
`POST /v1/admin/byok/keys`. **Settings → Web tools** holds the Firecrawl and
Browserbase panels, which also carry their crawl settings, through
`/v1/admin/byok/firecrawl` and `/v1/admin/byok/browserbase`. The legacy
single-key route `PUT /v1/admin/byok/:provider` still accepts `anthropic`,
`openai`, `firecrawl` and `browserbase`.

| Slug | Settings UI | Used by |
|------|-------------|---------|
| `anthropic` | AI keys | `test-gen-from-report`, `fix-worker`, `judge-batch` |
| `openai` | AI keys | `test-gen-from-report`, `inventory-propose`, fine-tune jobs |
| `openrouter` | AI keys | OpenAI-compatible LLM calls routed through OpenRouter |
| `cursor` | AI keys | Cursor Cloud agent dispatch (`_shared/agent-adapters.ts`, `story-mapper`) |
| `supabase` | AI keys | Personal access token for `backend-drift-scanner` and the schema-repair diagnostic |
| `firecrawl` | AI keys or Web tools | `qa-story-runner` (firecrawl_actions provider), `story-mapper` |
| `browserbase` | AI keys or Web tools | `qa-story-runner` (browserbase provider), `story-mapper` |

Bedrock fine-tuning is not a BYOK slug: it reads `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and `BEDROCK_ROLE_ARN` from the edge environment and
needs `MUSHI_BEDROCK_FINETUNE_ENABLED=1`.

---

## Adding a New Agent

1. Create `packages/server/supabase/functions/<name>/index.ts`
2. Import `withSentry` wrapper and `getServiceClient`
3. Register `requireServiceRoleAuth` for cron-triggered functions
4. Add to `packages/server/supabase/config.toml` if needed
5. Deploy: `npx supabase functions deploy <name> --no-verify-jwt`
6. Add a cron if needed via `SELECT cron.schedule(...)` or a migration
7. Update this file and `docs/execplans/PLANS.md`

---

## TDD / PDCA Story Engine

The TDD engine combines story discovery, automated test generation, and PDCA-driven improvement into a closed loop:

```
Live App URL
  → story-mapper (Firecrawl/Browserbase crawl → Claude drafts user stories)
  → inventory_proposals (source='live_crawl', reviewed in Discovery tab)
  → Accept proposal
  → [Per story] test-gen-from-story (Claude → Playwright spec + Firecrawl YAML)
  → qa_stories (source='test_gen_from_story', approval_status by automation_mode)
  → [Review/Approve in QA Coverage page or CLI/MCP]
  → qa-story-runner executes on schedule
  → Failures → pdca-runner (mode='qa_story_improve')
  → Improved qa_stories (source='pdca', parent_story_id chain)
  → A2A notification if configured
```

### Automation Modes

| Mode | Behavior |
|------|----------|
| `auto` | Generated tests enabled immediately, no human review |
| `review` | Test created with `approval_status='pending_review'`, shown in QA Coverage queue |
| `approve` | Same as review — alias for explicit human approval workflow |

### Key Tables

| Table | Purpose |
|-------|---------|
| `story_map_runs` | Tracks live crawl jobs (pending → running → completed/failed) |
| `inventory_proposals` | Stores drafted inventory.yaml; `source` column: `passive_discovery` / `live_crawl` / `manual` |
| `qa_stories` | Test scripts; notable columns: `source`, `approval_status`, `automation_mode`, `origin_story_node_id`, `parent_story_id`, `pdca_iteration`, `target_url`, `last_run_status`, `consecutive_failures`, `slack_failure_ts`, `last_notified_at` |

### CLI Quick Reference

| Group | Commands |
| --- | --- |
| **Setup & account** | `mushi init`, `mushi setup`, `mushi connect`, `mushi login`, `mushi upgrade`, `mushi reset`, `mushi whoami`, `mushi status`, `mushi doctor`, `mushi ping`, `mushi test` (synthetic report through ingest), `mushi migrate` (suggests a migration guide), `mushi completion`, `mushi nudge`, `mushi profile list/current/use` |
| **Project & deploy** | `mushi project`, `mushi config`, `mushi deploy check`, `mushi selfhost up/doctor`, `mushi index`, `mushi sourcemaps upload`, `mushi audit`, `mushi radar scan/show`, `mushi recipe init/check/show/sources/change`, `mushi store pull/reviews/reviews-pull/reviews-set`, `mushi repo digest/diagram`, `mushi code-health show/stats`, `mushi design settings/set/dispatch-findings` |
| **Reports & lessons** | `mushi reports list/show/search/triage/file/…`, `mushi lessons list/show`, `mushi sync-lessons`, `mushi feedback board`, `mushi sentry import`, `mushi outbox list/edit/release/discard` |
| **Fixes & releases** | `mushi fix`, `mushi fixes tail/refresh-ci/rerun-ci/merge/review/verify`, `mushi work` (a local Cursor CLI agent; you push and open the PR; `--followups` fixes Opus "fix first" findings on those PRs), `mushi console watch <reportId>`, `mushi releases draft/list/show/edit/publish/delete/stats/auto-release/calendar` |
| **QA / TDD** | `mushi qa stories/runs/run`, `mushi tdd gen/pending/approve/improve/run`, `mushi stories map`, `mushi ux discover/login/run/open` (local UX loop, `@mushi-mushi/ux`, ADR 0020), `mushi ux-runs list/show/file` |
| **Skills / pipeline** | `mushi skills list/show/sync`, `mushi pipeline start/watch/checkin` |
| **CI runners** (ADR 0033, 0037) | `mushi runner status/compare/placement show/preview/request/revert/heartbeat/hooks install/key/add/audit` |
| **Verified merge** (ADR 0035) | `mushi verify workflow` (the `mushi-verify` workflow for your repo; a fix's gates: `mushi fixes verify`) |
| **Integrations** | `mushi integrations list/test`, `mushi slack status/test`, `mushi keys list/add/spend-down`, `mushi connectors list/status/actions` |
| **Portfolio** (account-level key) | `mushi portfolio show/findings/resources/groups`, `mushi funnel show/set/growth`, `mushi accounts list/add/edit/remove/export/domain`, `mushi spend show/import/remove` |
| **Billing** | `mushi usage`, `mushi billing status/cap`, `mushi budgets show/autofix` |

```bash
# ── Integrations ──────────────────────────────────────────────────────────
# List all configured integrations and their health status
mushi integrations list

# Run a health probe for a specific integration
mushi integrations test slack
mushi integrations test sentry
mushi integrations test github

# ── Slack ─────────────────────────────────────────────────────────────────
# Check whether Slack is connected
mushi slack status

# Send a test Slack message to verify the channel works
mushi slack test

# ── QA Stories ────────────────────────────────────────────────────────────
# List all QA stories and their last run status
mushi qa stories

# Show recent runs for a story (with error heads)
mushi qa runs <story-id>

# Manually trigger a QA story run
mushi qa run <story-id>

# ── Doctor checks ─────────────────────────────────────────────────────────
# Full pre-flight + server + QA story health check
mushi doctor --qa-stories

# ── TDD / Story mapping ───────────────────────────────────────────────────
# Map user stories from live app
mushi stories map --url https://your-app.com --wait

# Generate Playwright TDD test from a story
mushi tdd gen user-login --mode review

# Review pending tests
mushi tdd pending

# Approve a generated test
mushi tdd approve <qa-story-id>

# Trigger PDCA improvement on failing tests
mushi tdd improve

# Manage API key pool
mushi keys list
# Prefer the env var so the key is not captured in shell history:
MUSHI_BYOK_KEY=sk-ant-... mushi keys add --provider anthropic --label "Backup key"

# ── Fix lifecycle (dispatch → CI → merge) ─────────────────────────────────
mushi fix <reportId> --agent cursor_cloud --wait
mushi fixes tail --report-id <reportId>
mushi fixes refresh-ci <fixId>
mushi fixes merge <fixId>              # squash-merge PR + mark report Fixed (refuses an Opus "hold"; overrides happen in the console)
mushi fixes review <fixId> --show      # the Opus review of the PR (ADR 0030)
mushi fixes verify <fixId> [--rerun]   # the verified-merge gates for the PR head (ADR 0035)
mushi verify workflow --out .github/workflows/mushi-verify.yml  # the fail-to-pass workflow

# ── Diagnoses usage + billing ─────────────────────────────────────────────
mushi usage                            # diagnoses used / limit / cap for this period
mushi billing status                   # full billing summary (plan, usage, cap, overage)
mushi billing cap                      # show current spend cap
mushi billing cap 100                  # set $100/mo hard spend cap
mushi billing cap 0                    # clear spend cap
```

### MCP Tools

Full catalog: **124 tools** in [`packages/mcp/src/catalog.ts`](packages/mcp/src/catalog.ts) — generated docs at [`apps/docs/content/sdks/mcp-tools.mdx`](apps/docs/content/sdks/mcp-tools.mdx). Vibe-coder incident loop: [`apps/docs/content/quickstart/incident-loop.mdx`](apps/docs/content/quickstart/incident-loop.mdx) (`get_fix_context` → prompt `summarize_report_for_fix`).

Core MCP tools (`mcp:read` scope): `get_recent_reports`, `get_report_detail`, `get_fix_context`, `query_lessons`, `list_lessons`, `list_qa_story_runs`, `get_qa_story_run`

Notification tools (`mcp:write` scope): `test_notification_channel`

Usage / billing tool (`mcp:read` scope): `get_usage` — diagnoses used / limit / spend cap for the current period.

TDD MCP tools: `map_user_stories`, `get_map_run_status`, `generate_tdd_from_story`, `improve_qa_story`,
`run_qa_story`, `list_byok_keys`, `add_byok_key`, `list_pending_review_stories`, `approve_qa_story`

**New in Jun 2026 Slack overhaul:**
- `list_qa_story_runs` — recent runs for a story with error heads
- `get_qa_story_run` — full run detail with screenshots and assertion failures
- `test_notification_channel` — send a test ping to verify Slack or Discord is wired up

---

## Skill-Driven Triage Pipelines

The Skill Pipeline feature (Jun 2026) integrates the [kenji skills / skills.sh](https://github.com/kensaurus/skills) agent-skill ecosystem into Mushi as a first-class pipeline concept.

### Architecture

```
git repo skills/SKILL.md
  → skill-sync edge fn (daily cron + manual POST)
  → agent_skills catalog (pgvector embeddings)
  → classify-report Stage 2 (recommended_skills on reports)
  → api/routes/skills.ts
  → skill_pipeline_runs + step_runs (Realtime)
  → Console SkillPipelinesPage (React Flow, live updates)
  → CLI: mushi skills / mushi pipeline
  → MCP tools (list_skills, start_skill_pipeline, …)
  → plugin-cursor-cloud (cloud mode auto-dispatch)
```

### Execution Modes

| Mode | Description |
|------|-------------|
| `handoff` | Composes a "run packet" (skill instructions + report context) for the dev's local Cursor agent via CLI/MCP |
| `cloud` | Each step dispatches a Cursor Cloud agent run via the existing plugin; step status streams to the console |

### CLI Quick Reference

```bash
# Skill catalog
mushi skills list [--category workflow] [--search "fix bug"]
mushi skills show workflow-fix-and-ship
mushi skills sync [--source-id <id>]

# Pipeline runs
mushi pipeline start <reportId> --skill workflow-fix-and-ship [--mode cloud]
mushi pipeline watch <runId-or-prefix>
mushi pipeline checkin <runId-or-prefix> --step 0 --status passed [--notes "Fixed null check"]
```

### MCP Tools (Jun 2026 Skill Pipelines)

Skill tools (`mcp:read` scope): `list_skills`, `get_skill`

Pipeline tools (`mcp:write` scope): `start_skill_pipeline`, `get_pipeline_run`, `checkin_pipeline_step`

### Key Tables

| Table | Purpose |
|-------|---------|
| `skill_sources` | Allowlisted git repos whose SKILL.md files are synced |
| `agent_skills` | Global catalog; one row per SKILL.md; carries pgvector embedding for Stage 2 semantic recommendation |
| `skill_pipeline_runs` | One run per "attach skill to report" action; stores `context_packet`, `mode`, `status` |
| `skill_pipeline_step_runs` | One step per skill in the chain; Realtime-enabled for live console updates |

### Guardrails

- **Allowlist only**: `skill-sync` only fetches from `skill_sources.repo_slug` rows (no arbitrary URL ingestion)
- **Secret-pattern scan**: every SKILL.md body is scanned for leaked keys/tokens before upsert
- **Description length**: enforced at ≤ 1024 chars per Agent Skills spec
- **Packet budget**: `context_packet` is capped at 40,000 chars (configurable in `_shared/skill-packet.ts`)
- **Rate limit**: pipeline starts are limited per project (enforced in `api/routes/skills.ts`)
- **Air-gap**: skill content flows *into* LLM prompts only — never executed against raw user strings

---

## Console merge loop (Jun 2026)

User-confirmed PR merge from the admin console or CLI — closes the gap between
"draft PR open" and report **Fixed** without requiring a manual GitHub merge +
webhook.

### Endpoints

| Route | Auth | Purpose |
| ----- | ---- | ------- |
| `POST /v1/admin/fixes/:id/merge` | `adminOrApiKey(mcp:write)` | Merge PR on GitHub + `finalizeFixMerge()` |
| `POST /v1/admin/fixes/:id/refresh-ci` | `adminOrApiKey(mcp:write)` | On-demand `ci-sync` for check-run badge |

Shared logic: `_shared/fix-merge.ts` (`mergeGithubPullRequest`, `finalizeFixMerge`).

**Review gate (ADR 0030).** Every request merge goes through
`_shared/gated-merge.ts` (this route, the console's generic PR merge, the
UX-run merge and the SDK-upgrade merge; a test fails on any other caller of
GitHub's merge). It reads the PR and keys on GitHub's current `base.repo`, so
the repo must be one of the project's repos (403 `REPO_NOT_IN_PROJECT`; 409
`REPO_RENAMED` when only its old name is connected); PR URLs are stored
canonical (`canonicalPrUrl`, 400 otherwise). It refuses a PR (found by
`fix_reviews.repo_id` or `repo`, + `pr_number`, across all projects, and PATCH
cannot rewrite a fix's PR once set) whose
latest completed Opus review (`fix_reviews`,
written by `agent-pr-review`) says `hold`, with 409 `REVIEW_HOLD`: also while
a re-review runs and on newer commits (a re-run never clears a verdict). Only
a console session of a non-viewer overrides, with `override: true` and an
`overrideReason` (audited); API keys (CLI, MCP) get 403
`OVERRIDE_NEEDS_CONSOLE`. GitHub merges only the head SHA the gate saw (409
`HEAD_MOVED` otherwise); a failed review read is a 503. `fix_first` merges; no
review merges as before and reports "Not reviewed"; a verdict about an older
commit reads "stale"; while a fix's first review runs, an API key gets 409
`REVIEW_PENDING` and a console user confirms first. `POST /v1/admin/fixes/:id/review` re-runs a review
(non-viewers, 3 an hour per fix, 409 while one runs; a hold on its own
commit only from the console) and a PR push
(`pull_request.synchronize`) re-queues it; the verdict rides on
`GET /v1/admin/fixes/:id/timeline` (`data.review`, MCP `get_fix_timeline`).
CLI: `mushi fixes review`.

### Draft → ready → merge

1. `fix-worker` opens a **draft** PR, then calls `markPullRequestReady()` (GraphQL —
   REST `draft: false` is unreliable).
2. Console/CLI merge calls `mergeGithubPullRequest()` which re-readies if still draft.
3. GitHub squash-merge (default) → webhook or inline `finalizeFixMerge()` sets
   `merged_at`, report → `fixed`, reporter notification, `fix.applied` plugins.

### CLI

```bash
mushi fixes refresh-ci <fixId>
mushi fixes merge <fixId> [--method squash|merge|rebase]
mushi fixes review <fixId> [--show]
```

Admin UI: `MergeFixPreflight`, `FixCiFeedback`, `pickPrimaryFixAttempt()` in
`apps/admin/src/lib/mergeFix.ts`.

---

## One-click SDK Install & Upgrade (Jun 2026)

Extends the "one-click MCP install" to **SDK/CLI install and upgrades**. The
headline capability is a **"Create Upgrade PR"** that opens a reviewed GitHub PR
bumping `@mushi-mushi/*` in the connected repo, reusing the existing GitHub App
+ draft-PR machinery.

### Architecture

```
Console "Create Upgrade PR" button
 → POST /v1/admin/projects/:pid/sdk-upgrade (sdk-upgrade route)
 → insert sdk_upgrade_jobs (queued)
 → waitUntil → invoke sdk-upgrade-worker
 → worker: resolveProjectGithubToken + Contents API + computeBumpPlan
 → createPrFromFiles (_shared/github-pr.ts) → draft PR → markReady
 → pr_url stored in sdk_upgrade_jobs
 → GET /stream SSE polling → Console status chip → PR link
```

### New API routes

| Route | Auth | Description |
| ----- | ---- | ----------- |
| `POST /v1/admin/projects/:pid/sdk-upgrade` | `adminOrApiKey(mcp:write)` | Enqueue upgrade job; fire-and-forget worker |
| `GET /v1/admin/projects/:pid/sdk-upgrade/:id` | `jwtAuth` | Poll job status (console JWT) |
| `GET /v1/admin/projects/:pid/sdk-upgrade/:id/stream` | `adminOrApiKey(mcp:read)` | SSE status stream |

### New tables

| Table | Purpose |
|-------|---------|
| `sdk_upgrade_jobs` | Tracks upgrade PR jobs; columns: `id, project_id, requested_by, status, pr_url, pr_number, branch, commit_sha, plan jsonb, error, timestamps`. RLS: service-role only. |

### Shared modules

| File | Role |
|------|------|
| `_shared/sdk-upgrade-plan.ts` | Pure `computeBumpPlan(pkg, latestVersions)` — mirrors CLI's `planUpgrade()` guards. Never replaces `workspace:` / `file:` / git specifiers. Always uses live npm registry at PR time. |
| `_shared/github-pr.ts` | Generic `createPrFromFiles()` + `ghFetch` / `ghFetchOptional`. Shared by `fix-worker` and `sdk-upgrade-worker`. |

### Frontend surfaces

| Surface | Location | What it adds |
|---------|----------|-------------|
| `ConnectPage` | `apps/admin/src/pages/ConnectPage.tsx` (route `/connect`) | Unified hub: **ConnectStudio** hero (3 lanes: MCP one-click, CLI, Skills) + GitHub connect → SDK install → Update center with "Create Upgrade PR" |
| `ConnectStudio` | `apps/admin/src/components/connect/ConnectStudio.tsx` | Higgsfield-style "pick your client → connect in one click" hero. 9-client picker + 3 lanes (MCP / CLI / Skills). Collapses old activation/snapshot/provenance strips into a single collapsible "Connection status" disclosure. |
| `ClientConnectButton` | `apps/admin/src/components/ClientConnectButton.tsx` | Registry-driven install button: handles deeplink (opens IDE), config-json, cli-command, and remote-url methods. Mints a per-project key before building the artifact. |
| `MCP_CLIENTS` registry | `packages/mcp/src/clients.ts` | Pure shared registry of all 9 AI clients (Cursor, VS Code, VS Code Insiders, Windsurf, Cline, Claude Code, Claude Desktop, Zed, Any). Consumed by both the admin console and the public docs `/connect` landing — single source of truth so the two never drift. |
| Public Connect landing | `apps/docs/app/connect/page.tsx` | Public Higgsfield-style landing at `/connect` on the docs site. Same 3-lane picker but with placeholder keys + "Sign in to mint & one-click install" CTA. Registered in docs nav. |
| `SdkUpgradeCTA` | `apps/admin/src/components/SdkUpgradeCTA.tsx` | Primary "Create Upgrade PR" button (when `projectId` supplied + GitHub connected); copy-cmd fallback always present |
| `SdkUpgradeBanner` | `apps/admin/src/components/dashboard/SdkUpgradeBanner.tsx` | Dashboard nudge when active project SDK is outdated/deprecated |
| `useSdkUpgrade` | `apps/admin/src/lib/useSdkUpgrade.ts` | React hook mirroring `useDispatchFix`: POST → SSE stream with poll fallback |

### sdk_versions catalog sync

The `sdk_versions` catalog is kept fresh via two paths:
1. **publish-time** — `release.yml`'s `catalog-sync` job calls
   `sdk-versions-cron` after Changesets publishes, authenticated by a GitHub
   Actions OIDC token (audience `mushi-sdk-catalog`) that
   `_shared/github-oidc.ts` pins to `release.yml` on `master` in this repo by
   numeric repository and owner id. No Supabase key is in the workflow. The
   published list rides along as a compare-only `expected` hint: the function
   still reads npm itself (with its major-jump quarantine) and answers 202
   while npm `latest` lags, so the job retries, then only warns.
2. **daily cron** — `sdk-versions-cron` edge function (02:30 UTC, service-role
   bearer) queries the npm registry for every `@mushi-mushi/*` package and
   upserts the latest stable version. Backstop for publish-time sync failures.

---

## Native CI Secrets Diagnostic & Auto-Write (Jun 2026)

For Capacitor, Expo, and React Native apps, the Mushi SDK environment variables
(`NEXT_PUBLIC_MUSHI_PROJECT_ID`, `NEXT_PUBLIC_MUSHI_API_KEY`,
`NEXT_PUBLIC_MUSHI_API_ENDPOINT`) must be **baked into the native bundle at
compile time** — Next.js inlines `NEXT_PUBLIC_*` vars at build time and they
cannot be injected at runtime. A missing secret silently disables `initMushi()`
and the lime feedback banner never appears in the downloaded store app.

### Detection

`GET /v1/admin/projects/:id/sdk-diagnostics` returns a fused verdict combining:
- **Authoritative**: repo Actions secrets/variables are listed via the stored GitHub
  token and compared against the required names from `projectMushiEnv` (per-project
  var map). Missing name → definitive `ci-secret-missing` verdict.
- **Telemetry fallback** (no GitHub token): scans `project_api_keys.last_seen_origin`
  / `last_seen_user_agent`; flags `native-never-seen` when web/server heartbeats
  exist but no `capacitor://` / `okhttp` / `CFNetwork` origin appears.

Response shape: `{ status, platformHint, endpointMatches, bannerEnabled, launcherMode,
requiredVars, presentVars, missingVars, lastSeenAt, recommendedFix, repoUrl, hasGithubToken }`.

### Auto-write

`POST /v1/admin/projects/:id/sync-ci-secrets` — the one-click operation:

1. Resolves repo from `project_repos` (primary row).
2. Resolves token via `resolveProjectGithubToken`.
3. Mints a project-scoped `report:write` key labelled `ci-auto:<repo>`; deactivates
   prior `ci-auto:*` keys (idempotent-by-name — avoids key sprawl).
4. Writes each required var via sealed-box encryption (libsodium `crypto_box_seal` +
   GitHub `PUT .../actions/secrets/{name}`) or plain `PUT .../actions/variables/{name}`.
5. Logs audit event; returns `{ ok, written, skipped, failed }`.

### GitHub App vs PAT permission boundary (critical for agent implementers)

The **Mushi GitHub App** currently requests only `Contents: write` and
`Pull requests: write`. It does **not** have `Actions secrets: write`. This means:

- Auto-write works **only** when a **fine-grained PAT** with
  `Actions secrets: Read and write` is stored in the project's GitHub connection
  settings (`project_settings.github_installation_token_ref`).
- When the GitHub App installation token is used and lacks the secrets scope,
  GitHub returns HTTP 403. The backend detects this and returns:
  `{ ok: false, error: { code: "GH_SECRETS_FORBIDDEN" }, fallback: { commands, envBlock } }`.
- The console `SdkNativeConnectivityCard` surfaces this as an inline warning with
  explanatory text and auto-expands the guided fallback (copy-paste `gh secret set`
  commands + CI `env:` block).

**To enable full auto-write via the GitHub App** (instead of a PAT):
1. Add `Secrets: Read and write` to the App's requested permissions on GitHub.
2. This forces a re-consent for all installations (users must approve the new scope).
3. Until then, the guided PAT path is the supported route for CI secret auto-write.

### Guided fallback

When auto-write is forbidden or no GitHub token is stored, the backend always
returns `fallback.commands` (one `gh secret set` / `gh variable set` command per
required var, prefixed with `.env.local`-sourced value substitution) and
`fallback.envBlock` (the `env:` YAML snippet to add to the CI workflow). The
console presents these as copyable code blocks so developers are never dead-ended.

### Frontend surfaces

| Surface | Location | What it adds |
|---------|----------|-------------|
| `SdkNativeConnectivityCard` | `apps/admin/src/components/SdkNativeConnectivityCard.tsx` | Fetches `/sdk-diagnostics`, renders status badge, one-click sync CTA, forbidden explanation, guided fallback commands |
| `ConnectPage` section "Native app CI secrets" | `apps/admin/src/pages/ConnectPage.tsx` | Wires the card into the Connect hub beside SDK install |
| `sdkCiSecrets.ts` | `apps/admin/src/lib/sdkCiSecrets.ts` | Pure helpers: diagnostic response types and `sdkCiStatusMeta` |
| `useCiSecretSync` | `apps/admin/src/lib/useCiSecretSync.ts` | React hook for the POST → sync flow (synchronous, no SSE needed) |
| `sdkClientPlatform.ts` | `apps/admin/src/lib/sdkClientPlatform.ts` | `sdkOriginKind` + `sdkPlatformHintFromUserAgent` classify `capacitor://`, `okhttp`, `CFNetwork` signals |

### Build-time guard (glot.it reference implementation)

`scripts/check-mushi-env.mjs` (non-fatal by default, strict with `MUSHI_ENV_STRICT=1`) is
invoked from `prebuild:native` and emits a prominent warning block when
`NEXT_PUBLIC_MUSHI_PROJECT_ID` or `NEXT_PUBLIC_MUSHI_API_KEY` are empty during a
native build. Copy this pattern into any Capacitor/RN project using the Mushi SDK.

---

## Codebase Atlas (`/explore`)

Server-hosted **Codebase Understand** surface in the admin console — parity with [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) commands.

| Tab group | Routes | Backend |
|-----------|--------|---------|
| Summary | `overview` | `GET /v1/admin/explore/stats` |
| Understand | `ask`, `tour`, `domains`, `knowledge` | `api/routes/codebase-understand.ts` |
| Map | `graph`, `layers` | `GET …/codebase/explore` (+ UA graph JSON when `symbols=1`) |
| Search | `search` | `POST …/codebase/search` (semantic + name modes) |
| Index | `index` | scope settings + analyze job debug |

**Workers & tables (Jun 2026):**

| Object | Role |
|--------|------|
| `codebase-analyze-worker` | Builds UA-shaped graph JSON from `project_codebase_files`; enqueued on push + manual Re-analyze |
| `project_codebase_graph` | Symbol-level graph JSONB per project |
| `codebase_analyze_jobs` | Job queue (service-role only) |
| `project_codebase_wiki_sources` / `…_knowledge_*` | Wiki ingest + RAG merge via `match_knowledge_chunks` |
| `project_settings.codebase_index_scope_paths` | Scoped subdirectory indexing |

**MCP tools:** `ask_codebase`, `get_file_summary`, `get_codebase_tour`, `search_codebase`, `get_codebase_domains`, `analyze_codebase_impact`, `analyze_wiki_knowledge`, `get_repo_digest` (on the default feature set; needs no index).

Graph builder concepts attributed to **Understand-Anything (MIT)** — see `packages/codebase-graph/README.md` and `_shared/codebase-graph-build.ts`.

---

## Production deployment

Maintainers shipping Mushi Cloud or npm SDK releases should follow
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (repo runbook) and the public summary at
[`apps/docs/content/operating/deployment.mdx`](apps/docs/content/operating/deployment.mdx).
Key points: Changesets version PR → merge → **manual `release.yml` dispatch** when
GitHub suppresses the bot merge trigger; Edge Functions / admin / docs deploy on
path-filtered pushes; **DB migrations are manual** (`supabase db push`).

---

## Reporter incentives & page-aware assistant (Jun 18 2026)

Closes three SDK pain points across the four host repos: (1) reporters had no
reason to come back, (2) the reward economy needed console wiring + a turnkey
host receiver, and (3) the console's page-aware chatbot had no in-SDK
equivalent. **All three migrations are applied and verified on remote
(`dxptnwrhwsqckaftyymj`); the `api` edge function is deployed.**

### Automatic point awards (no console config required)

Reporters now earn points on the two moments that matter, awarded server-side
inside the ingest + triage pipeline so incentives work out of the box:

| Moment | Where | Action | Default points |
|--------|-------|--------|----------------|
| Report submitted | `api/helpers.ts` `ingestReport` (after `end_user` link) | `report.submitted` | 10 |
| Report triaged | `classify-report/index.ts` (after classification) | `report.triaged` | 50 |

Both calls go through `awardPointsForEndUser` (`_shared/reputation.ts`), which
enforces `reward_rules` velocity caps, propagates to the tier-evaluator, and
fires the `points_awarded` notification. The dotted actions are seeded in
`LEGACY_POINT_TABLE` so they award with **zero** console config; a project can
override base/cap by adding a `reward_rules` row of the same name.

- **Fire-and-forget**: a rewards failure never blocks ingest or triage.
- **Idempotency**: `report.triaged` is guarded by an explicit prior-award check
  (`end_user_activity.action='report.triaged'` + `metadata->>report_id`) so
  re-classification / stage-2 retries can't double-award.

### One-click reward presets

`POST /v1/admin/rewards/presets/apply` (`jwtAuth` — console only) idempotently installs
recommended default rules (`report.submitted` / `report.triaged` /
`comment_posted`) and a 4-tier ladder (Explorer → Contributor → Champion →
Legend, with `host_credit_payload` grant instructions). Only inserts
actions/slugs that don't already exist, so it's safe to re-run and never
clobbers operator customisations. Surfaced as the "Use recommended defaults"
CTA on the empty-state of `apps/admin/src/pages/RewardsPage.tsx` — ease of
setup before customizability.

### Vault-backed reward webhook secrets + `@mushi-mushi/node` receiver

- `reward_webhooks.vault_secret_id` (migration `20260617235151_reward_webhook_vault_secrets.sql`) stores the raw
  HMAC signing secret in Supabase Vault; `secret_hash` is retained for
  display/equality only. `_shared/reward-webhooks.ts` `loadWebhookSecret` reads
  the raw value back via `vault_get_secret`, falling back to the legacy env var.
  The same migration **restores the canonical `vault_store_secret(text,text,uuid)`**
  function (it was missing on remote, which also broke BYOK key saves).
- `POST /v1/admin/rewards/webhooks` now **mints** a `mushi_whk_…` secret when the
  caller omits one, stores it in Vault, and returns it **once** (API-key style).
- `@mushi-mushi/node` exports `createMushiRewardsHandler({ secret, onTierChanged,
  onPointsAwarded })` — a framework-agnostic receiver (Express middleware +
  Web-standard `fetch` handler) that timing-safely verifies `X-Mushi-Signature`
  and routes events. This is the Mushi → host-repo "grant a role / grant a Stripe
  membership" trigger. See `packages/node/README.md`.

### Cross-app "My Reports" fix

`mushi_get_my_cross_app_reports` (migration `20260617234653_fix_cross_app_reports_columns.sql`) selected
`reports.short_id` / `reports.title`, neither of which exists — every call 500'd.
Now derives `short_id` from the UUID's first 8 hex chars and `title` from
`summary` (falling back to a trimmed `description`). The web widget's My Reports
tab, leaderboard (rank/points), account rank, and rewards "X pts to <next tier>"
display consume this.

### Page-aware in-SDK assistant

A knowledge-grounded "Ask" tab in the widget. **v1 has zero cross-user data
surface** — it answers only from the page context the SDK publishes and the
operator-authored knowledge corpus, so it structurally cannot leak another
user's data, source, or env.

```
Widget "Ask" tab → apiClient.askAssistant({ message, threadId, context })
  → POST /v1/sdk/assistant (apiKeyAuth, per-project 240/hr cap)
  → verify optional X-Mushi-User-Token (audit only — no user data fetched)
  → BYOK LLM via withAnthropicOrOpenAi (Anthropic primary → OpenAI fallback)
  → structured { kind: 'answer' | 'clarify', … } (generateObject + Zod)
  → log both turns to sdk_assistant_messages (route, model, tokens, cost, latency)
  → return MushiAssistantReply + threadId
```

| Object | Role |
|--------|------|
| `project_settings.assistant_*` | `assistant_enabled`, `assistant_label`, `assistant_greeting`, `assistant_suggestions`, `assistant_knowledge` (corpus, 40k cap) — migration `20260618001234_sdk_assistant.sql` |
| `sdk_assistant_messages` | Per-turn audit log; RLS `RESTRICTIVE` deny-all (service-role/edge-fn only) |
| `POST /v1/sdk/assistant` | `apiKeyAuth` — the assistant turn (security-hardened system prompt, BYOK, structured output, logging) |
| `GET /v1/sdk/config` | Now returns the `assistant` block so the widget shows the tab without a rebuild |
| `GET\|PUT /v1/admin/projects/:id/assistant` | `jwtAuth` — read/update config; the knowledge corpus is **secret-scanned** (rejects keys/tokens/connection strings with `SECRET_DETECTED`) and 40k-capped before persist |
| `GET /v1/admin/projects/:id/assistant/logs` | `jwtAuth` — recent turns for audit/cost review |

**Frontend surfaces:**

| Surface | Location | What it adds |
|---------|----------|-------------|
| `AssistantConfigCard` | `apps/admin/src/components/AssistantConfigCard.tsx` | One-toggle enable + greeting/label/chips; collapsed "Advanced" holds the knowledge editor + recent-turns log |
| SDK configurator | `apps/admin/src/pages/ProjectsPage.tsx` | Mounts `AssistantConfigCard` under `SdkInstallCard` |

**Security model:** the system prompt hard-forbids revealing secrets/source/env
and treats the user's message as untrusted data (prompt-injection resistant);
the knowledge corpus is the only operator-supplied text and is secret-scanned on
write; every turn is logged. Full doc: [`docs/SDK_ASSISTANT.md`](docs/SDK_ASSISTANT.md).

---

## Screenshot preview & consent caption (Jun 19 2026)

Finance and health hosts often disabled screenshot capture because reporters
could not see what would be sent. **v1.19.0** adds a visible preview on the
details step plus a configurable privacy caption — so capture can stay on with
an explicit review-and-remove gate.

```
Reporter opens widget (capture.screenshot on-report/auto)
  → SDK captures screen → data URL
  → Web: <img> preview on step 3  |  RN: thumbnail in bottom sheet
  → Optional caption from widget.screenshotSensitiveHint
  → Reporter Remove / Mark up (web) / Submit
  → POST ingest with or without screenshot blob
```

| Object | Role |
|--------|------|
| `MushiWidgetConfig.screenshotSensitiveHint` | `true` = localized default, `string` = custom, `false` = hide caption |
| `project_settings.sdk_screenshot_sensitive_hint` | Console/runtime store: `NULL` = default, `''` = hidden, string = custom (≤ 200 chars) — migration `20260619102932_sdk_screenshot_sensitive_hint.sql` |
| `GET /v1/sdk/config` | Emits `widget.screenshotSensitiveHint` for runtime merge |
| `PUT /v1/admin/projects/:id/sdk-config` | Persists via `coerceSdkConfigUpdate()` in `api/helpers.ts` |

**Frontend surfaces:**

| Surface | Location | What it adds |
|---------|----------|-------------|
| SdkInstallCard | `apps/admin/src/components/SdkInstallCard.tsx` | Checkbox + optional custom text for screenshot privacy caption |
| ConfigHelp | `sdk-install.screenshot_sensitive_hint` in `configDocs.ts` | Operator docs + link to deep-dive |

**Introduced in:** `@mushi-mushi/core` / `@mushi-mushi/web` **1.19.0** (current: **1.33.0** — see root `CHANGELOG.md`).
`@mushi-mushi/react-native` **0.19.0** (current: **0.24.0**). Full doc:
[`docs/SDK_SCREENSHOT_PREVIEW.md`](docs/SDK_SCREENSHOT_PREVIEW.md).

---

## SDK reliability overhaul (Jul 2026)

Fixes CLI browser sign-in desync, host-vs-console config clobbering, and several
backend hardening gaps. User docs:
[runtime config concept](https://kensaur.us/mushi-mushi/docs/concepts/runtime-config),
[CLI loop](https://kensaur.us/mushi-mushi/docs/quickstart/cli-console-loop).
Operator checklist: [`docs/operators/sdk-reliability-overhaul.md`](docs/operators/sdk-reliability-overhaul.md).

### CLI device auth

| Route | Auth | Role |
| --- | --- | --- |
| `POST /v1/cli/auth/device/start` | Public + IP rate limit | Mint device code; accepts `client_id` |
| `POST /v1/cli/auth/device/approve` | JWT | User approves code |
| `POST /v1/cli/auth/device/token` | Public + IP rate limit | CLI polls; sets `cli_token_claimed_at` |
| `GET /v1/cli/auth/device/status` | JWT | Approval page polls until claimed |

Shared logic: `_shared/cli-auth-helpers.ts` (`parseClientId`, `evaluateTokenDelivery`,
60s re-delivery grace). Migration: `20260702015655_cli_auth_two_phase_claim.sql`.

### SDK runtime config

| Object | Role |
| --- | --- |
| `_shared/sdk-config.ts` | Single `normalizeSdkConfig` / `coerceSdkConfigUpdate` (explicit-only emission) |
| `packages/web/src/runtime-merge.ts` | Client merge — host banner/capture win over console defaults |
| `GET /v1/sdk/config` | Runtime payload for SDK |

Full precedence: [`docs/SDK_RUNTIME_CONFIG.md`](docs/SDK_RUNTIME_CONFIG.md).

### Backend hardening (same release)

| Change | Migration / file |
| --- | --- |
| Idempotency cache not readable by project viewers | `20260702034746_request_idempotency_restrict_member_read.sql` |
| Rate limits work for IP-derived actors | `20260702035407_scoped_rate_limits_generalize_actor.sql` |
| MCP JWT validation for write scope | `functions/mcp/index.ts` |
| Canonical hosted tool manifest | `_shared/mcp-hosted-tool-manifest.json` |
| Liveness probe | `GET /health` in `api/routes/discovery.ts` (always-green process up) |
| Readiness probe | `GET /health/ready` in `api/routes/discovery.ts` (DB-aware) |
| Standalone healthz | `GET /functions/v1/healthz` — unauthenticated `{status, db, version}` edge function |
| LLM transient retry before key rotation | `_shared/llm-failover.ts` |

---

## HTTP API surfaces — operator reference

Generated manifest: [`docs/API_ROUTE_MANIFEST.generated.md`](docs/API_ROUTE_MANIFEST.generated.md) (`pnpm gen:route-manifest`). OpenAPI subset: `GET /functions/v1/api/openapi.json`.

### SDK ingest (`apiKeyAuth`)

| Route | Role |
| --- | --- |
| `POST /v1/reports` | Single report ingest |
| `POST /v1/reports/batch` | Batch ingest |
| `POST /v1/ingest/spans` | OTel span ingest |
| `POST /v1/ingest/metrics` | Code-health + bundle metrics |
| `POST /v1/sdk/activity` | Reporter activity events |
| `POST /v1/sdk/discovery` | SDK observation inventory |
| `POST /v1/sdk/assistant` | In-widget Ask tab |
| `GET /v1/sdk/config` | Runtime SDK config pull |
| `GET /v1/reports/:id/status` | Report status poll |
| `/v1/sdk/me/*` | Cross-app reporter rewards surface (`rewards.ts`) |

### Host-backend erasure (erase token, no API key)

| Route | Role |
| --- | --- |
| `POST /v1/sdk/erase-subject` | Account deletion: deletes one end user's reports (screenshots first) and reporter data in the project; org identity too with `erase_identity`. `X-Mushi-Erase-Token` = HS256 with the project identity secret, `purpose: "erase-subject"`, ≤5 min. ADR 0022, `erase-subject.ts`. |

### MCP / CLI sync mirror (`adminOrApiKey` or scoped JWT)

Prefix **`/v1/sync/*`** — reports, lessons, ingest-setup mirrors for MCP and CLI offline sync. See `api/routes/sync.ts`.

### Skills HTTP routes (`requireAuthOrApiKey`)

Under **`/v1/admin/skills/*`**: catalog (`GET /`, `GET /:slug`), sources CRUD + `POST /sources/:id/sync`, pipeline runs + checkin, `GET /cloud-readiness`. See `api/routes/skills.ts`.

---

## Voice loop, cloud agents, MCP 2026-07-28 (Sep 12 2026)

Plan 017 (`docs/execplans/dead-code-voice-agent-loop.md`, ADRs 0007–0013).

- **Hosted MCP is dual-era**: legacy clients (2024-11-05 … 2025-11-25) keep `initialize`; 2026-07-28 clients use `server/discover`, per-request `_meta`, `Mcp-Method`/`Mcp-Name` headers, MRTR `input_required`, and the `io.modelcontextprotocol/tasks` extension (`tasks/get|update|cancel` over `fix_dispatch_jobs`). Modules: `_shared/mcp-protocol.ts`, `mcp-mrtr.ts`, `mcp-tasks.ts`.
- **Voice intake**: `api/routes/intake-voice.ts` (`POST /v1/intake/voice`, scope `voice:write`), `_shared/voice-intake.ts` / `voice-intent.ts` / `stt.ts` / `voice-return.ts`; inboxes: iOS Shortcut (text), Slack (`api/routes/slack-events.ts`: Events API + `/mushi` commands), Telegram (`telegram-webhook` function + `api/routes/telegram-admin.ts`), installed console PWA (`apps/admin` share_target + tap-to-talk). Tables: `voice_intake_sessions`, `telegram_chat_bindings`, `telegram_bind_codes`, `user_push_subscriptions`; bucket `voice-intake`; `reports.source`.
- **Cloud agents**: `_shared/agent-adapters.ts` (`cursor_cloud` via `_shared/cursor-cloud.ts` v1 API, `github_cloud_agent` via `_shared/github-agent-tasks.ts`, `anthropic_managed` stub); `fix-worker` dispatches and writes `fix_attempts` up front; completion via `cursor-webhook` (v0 callback) or `agent-status-poll` (cron `5-55/5`); unknown agents are a 400 at `POST /v1/admin/fixes/dispatch`.
- **A2A 1.0 wire format** (`taskPushNotificationConfig`, StreamResponse callbacks, `/.well-known/agent-card.json`) with 0.3 aliases.
- **Web Push**: `_shared/web-push.ts` (`@pushforge/builder`, host allowlist), `api/routes/push.ts`; secrets `VAPID_*`.
- **Dead-code gate**: knip@6 baselines in `docs/execplans/knip-baseline/`, ratchets in the `build` job (`check:residue`; `check:env-source-parity` fails the build when a source read is missing from every `.env.example`).

## ExecPlans

Detailed, phase-by-phase implementation plans live in
[`docs/execplans/PLANS.md`](docs/execplans/PLANS.md).

Each plan follows the OpenAI ExecPlans format: a self-contained, numbered
checklist that a coding AI can execute step by step without additional
context.
