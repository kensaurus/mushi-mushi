# 0051. Fresh-eyes runs: a first-time visitor may sign in on the app's own origins, with a synthetic account

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
  read-only. The default stays read-only, and `--dry-run` forces it.
- **Always refused, in every mode, for every method:** payment hosts, third-
  party OAuth and sign-in hosts (Google, GitHub, Apple, Microsoft, and
  `auth/v1/authorize?provider=`), and captcha hosts. A captcha is never
  solved: the session stops there and reports it. The public sign-up, OTP and
  password-recovery endpoints (`auth/v1/signup|otp|recover`) are never
  called, even on the app's own origin: a run never creates an account through
  the public form. Elements labelled delete, remove, revoke, pay, checkout,
  subscribe, sign out or "continue with Google/GitHub/Apple" are never clicked.
- **Synthetic identity.** The model types placeholders (`{{email}}`,
  `{{password}}`, `{{name}}`); code substitutes the values. Real values never
  reach the prompt, the timeline, the console sync or the logs. Without an
  account the run stops at the sign-up wall and files that as its finding.
- **Synthetic accounts (Mushi only).** `POST /v1/admin/fresh-eyes/test-account`
  (an operator, `MUSHI_OPERATOR_USER_IDS`; never a synthetic account) creates
  a confirmed Supabase user (`email_confirm: true`, `app_metadata.synthetic`)
  on a reserved domain and returns the password once. The user is recorded in
  `synthetic_accounts` and in `operator_users`, the list every company count
  and lifecycle email already excludes; server product events for it are not
  written. `retention-sweep` deletes it after 24 h, with the projects and
  organizations it alone owns. Other apps can pass their own test account; a
  hosted "test sign-up hook" for them is not built.
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

## Consequences

- Mushi's own onboarding gets a number that moves with each release.
- A run writes to production only through a synthetic account that is deleted
  within a day; every count that matters excludes it.
- Other apps get fresh-eyes up to their sign-up wall until they pass a test
  account.
