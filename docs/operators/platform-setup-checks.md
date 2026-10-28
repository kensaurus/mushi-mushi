# Platform setup checks: operator notes

Some features need secrets that only the Mushi operator can set, on the
server, for every app at once. An app owner cannot fix them, so they never
appear on an app's Set up page. They appear in the server doctor, for
super-admins only:

- `GET /v1/admin/doctor` (and `mushi doctor --server`) adds one `platform_*`
  check per group when the caller's `app_metadata.role` is `super_admin`;
- the console shows the same report on **Mushi health** (`/health`), in the
  "Server doctor (only you see this)" card.

Each check names the secrets that are **missing**. It never shows a value.
The code is `packages/server/supabase/functions/_shared/platform-setup-checks.ts`.

| Check | Secrets | What fails without them |
| --- | --- | --- |
| `platform_slack_oauth` | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | "Add to Slack" for every app. Report 2d5e2bd7: the button failed for every app and nothing said why until someone clicked it. |
| `platform_slack_signing` | `SLACK_SIGNING_SECRET` | Slack buttons and the `/mushi` command (requests from Slack cannot be verified). |
| `platform_linear_oauth` | `LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET` | "Connect Linear" for every app. |

## Setting them

Set them as Supabase Edge Function secrets on the project. No redeploy is
needed: functions read them on their next request.

```bash
supabase secrets set SLACK_CLIENT_ID=… SLACK_CLIENT_SECRET=… --project-ref <ref>
```

`SLACK_STATE_SECRET` is optional: without it, the Slack install state is
signed with `SLACK_CLIENT_SECRET`.

## The app owner's checks

The per-app checks (GitHub access per repo, the review follow-up key, the
auto-fix Cursor key, deploy events in the last 14 days, the Slack bot token)
are on the app's Set up page and in `GET /v1/admin/setup-gaps`. See
[`apps/docs/content/admin/onboarding.mdx`](../../apps/docs/content/admin/onboarding.mdx#setup-gaps).
