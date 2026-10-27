# Fresh-eyes runs (operators)

A fresh-eyes run (ADR [0051](../adr/0051-fresh-eyes-runs-may-sign-up.md)) tries one goal
as a first-time visitor and times the path. This page is for running it on Mushi itself,
where it needs a synthetic account, and for checking that those accounts never count.

## Release order

1. Apply migration `20261027200000_fresh_eyes.sql` (additive: `synthetic_accounts`,
   `ux_runs.kind` and the fresh-eyes columns, `reports.source` gains `fresh_eyes`,
   `is_synthetic_subject()`).
2. Deploy `api-ext` (the routes), `api` (forwards the paths), `retention-sweep` (deletes
   expired synthetic accounts), and every function that imports
   `_shared/product-events.ts` (server events skip synthetic accounts).
3. Optional secret `MUSHI_FRESH_EYES_EMAIL_DOMAIN` (default `synthetic.kensaur.us`): the
   domain synthetic emails use. Pick one no mailbox answers on.

Verify after the migration:

```sql
select relrowsecurity from pg_class where relname = 'synthetic_accounts';            -- t
select pg_get_constraintdef(oid) from pg_constraint where conname = 'reports_source_check'; -- lists fresh_eyes
select has_function_privilege('authenticated', 'public.is_synthetic_subject(uuid, uuid)', 'execute'); -- f
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
- `--dry-run` creates no account, writes nothing and stops at the sign-up page.

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

Not built yet (BL-138): the Fresh eyes tab shows the command. A `ux` lane on a local
worker would need its own claim kind, a closed charter schema on both sides, and a key
that can mint accounts, which `worker:run` deliberately cannot.
