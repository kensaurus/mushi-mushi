# 0053. Fresh-eyes runs: a first-time visitor may sign in on the app's own origins, with a synthetic account

Status: Accepted 2026-10-27 (owner: "proceed and build it and run with grok and the cursor credits and test thoroughly"). Date: 2026-10-27

Amends ADR [0045](0045-ux-audit-finds-bugs-on-signed-in-screens.md) (never a
fresh browser) and ADR [0046](0046-explore-mode-model-drives-code-judges.md)
(read-only exploring) for this one mode. Related: ADR
[0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) (write guard), ADR
[0029](0029-site-watch-files-a-page-only-after-a-second-failure.md) (confirm
before filing), ADR [0039](0039-better-models-make-mushi-better.md) (facts in
code, judgement to the model), ADR [0048](0048-local-workers.md) (local
workers), `packages/ux/src/fresh-eyes.ts`, `packages/ux/src/guard.ts`,
`api/routes/fresh-eyes.ts`, `_shared/fresh-eyes.ts`, migration
`20261027200000_fresh_eyes.sql`.

## Context

The critical audit of 2026-10-27 found that no outside user ever reached a
first diagnosis: all 3 outside installs stopped on localhost. Nothing in
Mushi tests the path a stranger takes (landing → sign up → set up → first
value). The UX audit and explore mode (ADRs 0045, 0046) start from a cached,
signed-in profile and never write, so they cannot walk that path: it starts
signed out and needs a sign-in, an app and a key.

## Decision

**A fresh-eyes run** (`mushi-ux fresh-eyes --url <landing> --goal <text>`) is
a mode of the UX loop, not a new system. It reuses explore's closed action set
and model-free replay.

- **Persona and model.** The model plays someone who has never seen the
  product and reads only what is on screen: the page's accessibility snapshot,
  fenced as data. It never sees the source, the docs index or the repo; the
  Cursor CLI runs in ask mode in an empty per-step folder. It only picks the
  next action. `--model` is a setting (default `grok-4.7-high-fast`).
- **Success is code.** A run declares its goal check: a URL reached, a
  selector or text visible, or an API condition. The model saying "done" is
  not success.
- **Clean browser, signed out.** The one UX mode that does not use a cached
  profile (amends 0045). Headless Chromium keeps its own User-Agent, so the
  server drops its product events as automation.
- **Writes only on the app's own origins.** Guard mode `writes: 'same-origin'`
  lets non-GET requests reach the start URL's origin and the hosts given as
  the app's (`--app-host`, e.g. the Supabase project). Everything else stays
  read-only. The default stays read-only; `--dry-run`, and any run with no
  synthetic identity to write as, keep it read-only.
- **Always refused, in every mode:** any write to, and any page navigation
  into, a payment host or a third-party sign-in host (Google, GitHub, Apple,
  Microsoft); a third-party sign-in started through the app
  (`auth/v1/authorize?provider=`, any method); and the public sign-up, OTP,
  magic-link and password-recovery calls (`auth/v1/signup|otp|recover`), even
  on the app's own origin, so a run never creates an account through the
  public form. Scripts and images from those hosts (Stripe.js) still load. A
  captcha is detected, never solved: the session stops there and reports it.
  Elements whose label reads as delete, remove, revoke, pay, checkout,
  upgrade, subscribe, invite, sign out or "continue with Google/GitHub/Apple"
  are never clicked, checked on the element the click resolves to and on the
  focused element before Enter or Space. An email address the model types
  itself (not `{{email}}`) is never typed.
- **Synthetic identity.** The model types placeholders (`{{email}}`,
  `{{password}}`, `{{name}}`); code substitutes the values. Real values never
  reach the prompt (a filled field's value is redacted from the snapshot), the
  timeline, the console sync or the logs, and credential fields are masked in
  screenshots. Without an
  account the run stops at the sign-up wall and files that as its finding.
- **Synthetic accounts (Mushi only).** `POST /v1/admin/fresh-eyes/test-account`
  (an operator, `MUSHI_OPERATOR_USER_IDS`; never a synthetic account) creates
  a confirmed Supabase user (`email_confirm: true`, `app_metadata.synthetic`)
  on a reserved domain and returns the password once. The user is recorded in
  `synthetic_accounts` and in `operator_users`, the list every company count
  and lifecycle email already excludes; server product events for it are not
  written. The daily `retention-sweep` deletes it once it is 24 h old, with
  the projects and organizations it alone owns (an organization someone else
  joined keeps its account and everything in it, and the sweep says so). Other
  apps pass their own test account (`MUSHI_FRESH_EYES_EMAIL` /
  `MUSHI_FRESH_EYES_PASSWORD`); a hosted "test sign-up hook" for them is not
  built.
- **Time is the app's time.** Each step records the model's think time and the
  app's time (action, navigation, settle) apart. Time to first value is the
  app time to the success check plus a reading-time estimate for each new
  screen (words on screen at 238 a minute), never the model's latency.
- **Findings policy.**
  - Measured page facts are filed automatically once a model-free replay of
    the steps shows them again: console and page errors, a 5xx from the app,
    a blank screen, a dead end (no way forward), a step that needs something
    outside the app (an inbox, an API key, a terminal, a third-party account),
    a captcha or sign-up wall the run cannot pass.
  - Model opinions (confusing, unclear copy, too many choices, and giving up
    with no measured cause) are filed only when at least 2 of 3 sessions name
    the same screen and category. One session never files an opinion.
  - Filed as `reports.source = 'fresh_eyes'`, ≤15 a run, deduped by
    fingerprint; `--dry-run` files nothing.
- **Score over time.** `ux_runs.kind = 'fresh_eyes'` holds the timeline,
  `ttfv_seconds`, steps and where it stalled; each finished run writes
  `fresh_eyes.ttfv_seconds` and `fresh_eyes.steps` to `metric_series` once.
- **Terminal setup.** For apps whose setup is a CLI (Mushi), a model-free
  runner scaffolds a tiny sample app in a temp folder, runs the setup command
  non-interactively with a supplied key, times each phase, starts the sample
  and sends one report through the widget, then hands back to the browser.

## Rejected

- **Signing up through the public form.** It creates unflagged production
  accounts, hits rate limits and needs an inbox. The admin route makes a
  flagged, confirmed account; the public form's own errors are still seen up
  to its submit.
- **A score from the model ("this onboarding is 6/10").** Run-to-run agreement
  is about κ 0.5; measured facts and multi-session agreement are filed instead.
- **Model latency as time to first value.** A slower model would read as an
  onboarding regression.
- **"Run now" through a local worker lane in this change.** The `worker:run`
  scope cannot reach the operator-only account route, and a `ux` lane needs a
  claim kind, a closed charter schema on both sides and an ADR 0020 amendment
  for unattended runs (BL-138 stays open). The console shows the exact command.
  Superseded by the amendment below.

## Consequences

- Mushi's own onboarding gets a number that moves with each release.
- A run writes to production only through a synthetic account that is deleted
  within a day; every count that matters excludes it.
- Other apps get fresh-eyes up to their sign-up wall until they pass a test
  account.

## Amendment 2026-10-28: Run now from the console, on the user's own worker

Status: Accepted 2026-10-28, asked for by the owner after walking the feature
as a normal user: the tab showed Mushi's landing, goal and `--mint-account` for
every app, and the only way to run was a terminal with a signed-in Cursor CLI. Related: ADR
[0048](0048-local-workers.md) (local workers), ADR
[0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md), migration
`20261028090000_fresh_eyes_queue.sql`, `_shared/fresh-eyes-queue.ts`,
`api/routes/work-fresh-eyes.ts`, `packages/cli/src/worker/fresh-eyes.ts`,
`packages/ux/src/fresh-eyes-request.ts`.

**Decision.** The console names it the **First-time user test** (its own page,
`/first-user-test`; "fresh eyes" stays a search word) and starts it with one
button. Run now queues a `ux_runs` row (`kind = 'fresh_eyes'`, `status =
'queued'`); a local worker (ADR 0048) takes it and runs `mushi-ux fresh-eyes`
on the user's machine, where the browser and the model run, as before.

- **Defaults come from the app.** The start page is the app's last test, its
  live-site watch, its site audit or its crawler address; Mushi's landing and
  goal only for Mushi's own project. The goal defaults to a plain one ("sign up
  and start using the app") and is editable. The server decides both.
- **A claim kind, not a lane mode.** Any lane of the app that claims (not a
  follow-ups lane, not paused, draining or past its stop date) takes a queued
  test before its own work: the test needs no clone, and a person who already
  runs a worker for the app gets one click. The daemon says it can run it
  (`host.takes = ['fresh_eyes']`, a closed list, `work_hosts.takes`); an older
  daemon is never offered one. The claim answer is closed too: a run id, an
  http(s) start page, a goal in plain text (no control characters, never read
  as an option), 1 to 5 visitors, optional words that mean done, dry run or
  not, and accounts. The heartbeat answer adds `wake`: lane ids whose app has a
  test waiting, so a click is picked up within a minute instead of after a
  lane's 15-minute idle wait. Lease, renewals and outcomes are ADR 0048's;
  `ran` is the test's own outcome, and the run row says in plain words why a
  test failed, stopped or lost its lease.
- **No command, no shell, no secrets in argv.** The worker starts
  `mushi-ux fresh-eyes --request-stdin --sync [--file | --dry-run]` with Node
  itself (refusing the Windows shell fallback); everything the server chose
  goes on stdin as one JSON document, never argv or the environment. The
  child gets the worker key to sync; `mushi-ux` drops every `MUSHI_*` variable
  before its model runs.
- **The worker key reaches one run.** `worker:run` may PUT, upload and file
  findings for a fresh-eyes run only while its own machine holds an active
  claim on that run (the same rule as `workerClaimDenial` for fixes).
- **Graceful states.** Run now answers 409 `NO_WORKER` with one plain sentence
  and one action when no computer can take it: none set up (Pipeline →
  Workers, `mushi worker install`), offline, too old to run tests, or every
  lane paused. A queued test can be cancelled; one nobody took within a day
  stops with that reason.
- **Test accounts: minted at claim time, never stored.** Only an operator's
  console session on Mushi's own project may ask for them (the panel offers
  the option only then; the server checks again). Queueing stores a
  single-use grant (`account_granted_by`, `account_grant_until`, 2 hours) and
  no password. When a worker claims the run, the server mints one synthetic
  account per visitor through the same code as the operator route
  (`_shared/synthetic-accounts.ts`, the same hourly limit, flags and 24-hour
  sweep) **only if the claiming machine belongs to that same operator**, the
  grant is unexpired and the granting user is still an operator; the grant is
  spent in the same compare-and-set that starts the run. The passwords travel
  once, in the claim answer (`Cache-Control: no-store`), to the operator's own
  worker, and from it to `mushi-ux` on stdin; they are never written to the
  database, `work_claims.detail`, a log line or the console. Any other case
  runs without an account (read-only up to the sign-up page) and the run row
  says why. The `worker:run` scope itself still cannot mint: the authority is
  the operator's own click, bound to the operator's own machine.
- **A dry run syncs.** `--dry-run --sync` now mirrors the run to the console
  (marked "look around only"); it still writes nothing to the app and files
  nothing, and writes no trend point.

**Rejected.**

- *Minting at queue time.* The password would sit in the database until a
  worker claimed the run.
- *A `fresh_eyes` lane mode.* It needs a lane (and a clone) per app just for
  this; any claiming lane can run it.
- *Running it in the cloud.* The model is the user's Cursor CLI and the
  browser runs where the person's account and network are; a hosted runner is
  a separate decision.
- *Passing the goal or accounts as arguments or environment variables.* `ps`
  and a Windows shell would read them.
