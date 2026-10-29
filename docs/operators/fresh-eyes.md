# First-time user tests (fresh-eyes runs, operators)

A first-time user test (ADR [0053](../adr/0053-fresh-eyes-runs-may-sign-up.md) and its
2026-10-28 amendment) tries one goal as a first-time visitor and times the path. This page
is for running it on Mushi itself, where it needs a synthetic account, for starting it from
the console, and for checking that those accounts never count.

## Release order

1. Apply migration `20261027200000_fresh_eyes.sql` (additive: `synthetic_accounts`,
   `ux_runs.kind` and the fresh-eyes columns, `reports.source` gains `fresh_eyes`,
   `is_synthetic_subject()`), then `20261028090000_fresh_eyes_queue.sql` (additive:
   `ux_runs.status` gains `queued` and the request columns, `work_claims` kind
   `fresh_eyes` with `ux_run_id` and outcome `ran`, `work_hosts.takes`).
2. Deploy `api-ext` (the routes, the worker claim), `api` (forwards the paths, including
   `…/fresh-eyes/:runId/cancel`), `retention-sweep` (deletes expired synthetic accounts),
   and every function that imports `_shared/product-events.ts` (server events skip
   synthetic accounts). The worker heartbeat reads `work_hosts.takes`, so the second
   migration goes first.
3. Publish `@mushi-mushi/ux` and `@mushi-mushi/cli` with `--request-stdin` and the
   `fresh_eyes` claim; a worker with an older CLI shows as "too old" on Run now.
4. Optional secret `MUSHI_FRESH_EYES_EMAIL_DOMAIN` (default `synthetic.kensaur.us`): the
   domain synthetic emails use. Pick one no mailbox answers on.

Verify after the migration:

```sql
select relrowsecurity from pg_class where relname = 'synthetic_accounts';            -- t
select pg_get_constraintdef(oid) from pg_constraint where conname = 'reports_source_check'; -- lists fresh_eyes
select has_function_privilege('authenticated', 'public.is_synthetic_subject(uuid, uuid)', 'execute'); -- f
select pg_get_constraintdef(oid) from pg_constraint where conname = 'work_claims_kind_target';      -- has fresh_eyes
```

## A run on Mushi

```bash
# from a machine where the Cursor CLI is signed in, with an operator's account-level key
mushi ux fresh-eyes --url https://kensaur.us/mushi-mushi/ --goal "get my first bug explained" \
  --mint-account --terminal --sync --file
```

- `--mint-account` calls `POST /v1/admin/fresh-eyes/test-account` once per session. Only
  an operator (`MUSHI_OPERATOR_USER_IDS`) may, with a console session or an account-level
  key that reaches every project; a project key, or a synthetic account, is refused. At
  most 12 an hour per operator.
- The account is created confirmed (`email_confirm: true`) with
  `app_metadata.synthetic = true`, recorded in `synthetic_accounts` and in
  `operator_users`. The password is returned once, typed by code, and never printed,
  synced or logged.
- The URL preset for `kensaur.us/mushi-mushi` adds the Supabase project as the app's own
  host and sets the goal check: a report page (`/mushi-mushi/admin/reports/*`) showing
  "Why it broke".
- `--dry-run` creates no account, writes nothing to the app, files nothing and stops at
  the sign-up page; with `--sync` it still shows in the console, marked "look around only".

## What excludes a synthetic account

| Where | How |
| --- | --- |
| Company funnel (`company_funnel_weekly`), growth page | the account is in `operator_users`, which every count already excludes |
| Lifecycle emails | the same `operator_users` exclusion in `lifecycle-emails` |
| Server product events | `emitProductEvent` skips a synthetic user and any event about a project it owns (`is_synthetic_subject`); a failed check records the event and logs `synthetic check failed` |
| Browser product events and sessions | the run's headless browser names itself in its User-Agent; events from it are dropped and sessions marked `is_bot` |
| Billing | a synthetic account never has a subscription or a Stripe customer; its reports count only against its own free project |

## Cleanup

The daily `retention-sweep` deletes each synthetic account once it is 24 hours old: its
product events and person rows, the projects it owns, the organizations it alone owns,
then the auth user (`synthetic_accounts` and `operator_users` rows cascade). A step that
fails leaves the account for the next day and is logged as
`synthetic_account_cleanup_failed` with the step; an organization someone else joined
keeps its account (step `organizations_shared`).

```sql
-- accounts waiting for the sweep
select user_id, email, expires_at from public.synthetic_accounts order by expires_at;
```

## Starting runs from the console

Console → **First-time user test** → **Run now** queues the test (`ux_runs.status =
'queued'`). A local worker (`mushi work --daemon`, ADR 0048) for that app takes it before
its lane's own work and runs `mushi-ux fresh-eyes --request-stdin --sync` on its machine;
the page follows the run row live. Any lane that claims will do (not a follow-ups lane,
not paused or draining); the worker's CLI must be new enough to say it runs these tests
(`work_hosts.takes`).

| Run now says | Why | What to do |
| --- | --- | --- |
| No computer of yours runs Mushi for this app yet | no worker lane for the app | `mushi worker install` on your machine (Pipeline → Workers) |
| … is not online | no heartbeat for 3 minutes | turn the machine on or start the worker |
| … is too old to run this test | the daemon did not send `takes: ['fresh_eyes']` | `npm i -g @mushi-mushi/cli@latest`, restart the worker |
| Every lane … is paused | every lane is paused, draining, past its stop date or follow-ups only | turn one on, on Pipeline → Workers |

A waiting test can be cancelled. One nobody took within a day stops with that reason.

**Test accounts from the console.** Only an operator's console session on Mushi's own
project sees "Sign up with test accounts". Queueing stores a single-use grant for two
hours, never a password. When a worker claims the run, the server mints one account per
visitor, through the same code and hourly limit as the route above, and only when the
claiming machine is that same operator's worker; otherwise the test runs without an
account and the run says why. The passwords go once, in the claim answer, to that worker
and from it to `mushi-ux` on stdin; they are never stored, logged or shown.
