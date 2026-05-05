# @mushi-mushi/inventory-auth-runner

Refresh the cookie that lets the Mushi Mushi v2.1 crawler + synthetic
monitor + observed-route diffing reach **auth-gated routes** in your app.

> Part of the Mushi Mushi v2 bidirectional inventory pipeline. Pairs with
> [`@mushi-mushi/inventory-schema`](../inventory-schema) (the
> `auth.scripted` block in `inventory.yaml`) and the
> `inventory-crawler` / `synthetic-monitor` Edge Functions in
> [`@mushi-mushi/server`](../server).

## What it does

1. Reads the project's currently-ingested `inventory.yaml` from
   `GET /v1/admin/inventory/:projectId`.
2. Finds the `auth.scripted` block and runs its `script` against
   `app.base_url + auth.config.login_path` in a headless Chromium
   instance via Playwright.
3. Picks the resulting session cookie (prefers `*session*` / `*auth*` /
   `sb-*` / `next-auth*` names, then `HttpOnly` + `Secure`).
4. PATCHes that cookie into `project_settings.crawler_auth_config` via
   `PATCH /v1/admin/inventory/:projectId/settings`.

After a successful refresh, the crawler and synthetic monitor can
authenticate to gated routes without ever seeing your test credentials —
they only ever see the cookie.

## What it deliberately does NOT do

- It does **not** run user-supplied JS in a privileged context. The
  `script` field executes inside Playwright's `page.*` API only — i.e.
  anything the host app could already do via the browser.
- It does **not** store credentials on the Mushi server. Creds are read
  from the local environment (`TEST_USER_EMAIL`, `TEST_USER_PASSWORD`,
  or whatever variables your `script` references) and only the
  *cookie* is shipped to the server.
- It does **not** persist the browser context between runs. Every
  invocation starts a clean Chromium profile.

## Install

```bash
# As a one-shot via npx (no install needed):
npx --yes @mushi-mushi/inventory-auth-runner refresh

# Or as a dev dependency in your repo:
pnpm add -D @mushi-mushi/inventory-auth-runner
```

The `mushi-mushi-auth` bin is exposed by the package; `npx mushi-mushi-auth refresh`
works once it's installed.

## Use

Set the four required env vars and run `refresh`:

```bash
MUSHI_API_KEY=mushi_xxx \
MUSHI_PROJECT=00000000-0000-0000-0000-000000000000 \
TEST_USER_EMAIL=qa@example.com \
TEST_USER_PASSWORD=… \
npx --yes @mushi-mushi/inventory-auth-runner refresh
```

| Var                  | Required | Description                                                                                                |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `MUSHI_API_KEY`      | yes      | Project-scoped API key with the `inventory:write` scope. Mint one in `/settings/keys` in the admin console. |
| `MUSHI_PROJECT`      | yes      | Mushi project UUID.                                                                                        |
| `MUSHI_API_ENDPOINT` | no       | API base URL. Defaults to the hosted Supabase functions endpoint.                                          |
| `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | usually | Picked up by your `auth.scripted.script`; the runner itself doesn't read them. Add whatever your script needs. |

`--debug` prints the captured cookie name + a 6-char prefix of the value
to stdout. **Never use `--debug` in CI** — anything in stdout ends up in
your build logs.

## Inventory snippet

Your `inventory.yaml` declares the script the runner will execute:

```yaml
app:
  id: glot-it
  base_url: https://app.example.com

auth:
  type: scripted
  config:
    login_path: /login
    script: |
      await page.fill('[data-testid=email]', env.TEST_USER_EMAIL)
      await page.fill('[data-testid=password]', env.TEST_USER_PASSWORD)
      await page.click('[data-testid=submit]')
      await page.waitForURL('**/dashboard')
```

Two `script` shapes are accepted:

1. **Inline** (above) — function body that receives `page`, `env`,
   `context`. Runs via `new Function(...)` so it has no access to the
   runner's local closure.
2. **File reference** — `script: 'js:./scripts/login.js'`. The runner
   `import()`s the path relative to CWD; the module must `default-export`
   an `(page, env, context) => Promise<void>` function. Use this when
   you'd rather commit the script to your repo without inline-escaping
   it into YAML.

## CI integration

The [`mushi-mushi-gates`](../mcp-ci) GitHub Action exposes an
`auth-bootstrap` command that shells out to this runner:

```yaml
- uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
  with:
    api-key: ${{ secrets.MUSHI_API_KEY }}
    project-id: ${{ secrets.MUSHI_PROJECT_ID }}
    command: auth-bootstrap
  env:
    TEST_USER_EMAIL: ${{ secrets.MUSHI_TEST_USER_EMAIL }}
    TEST_USER_PASSWORD: ${{ secrets.MUSHI_TEST_USER_PASSWORD }}
```

Run this **before** any `gates` step that triggers a crawl, and on a
nightly schedule so the cookie stays fresh.

## Security model

- Cookies land in `project_settings.crawler_auth_config.value`, which
  RLS-gates on project membership.
- The runner refuses to run if `MUSHI_API_KEY` is missing the
  `inventory:write` scope.
- Cookies have a soft TTL via `last_refreshed_at`; re-run on a daily
  cron or after every CI deploy.
- The runner shells out to a fresh headless Chromium per invocation —
  no persisted browser profile, no shared cookies between runs.

## Scripts

```bash
pnpm auth         # tsx src/run.ts (local dev)
pnpm typecheck    # tsc --noEmit
```

There is no build step — the package ships TypeScript directly and runs
via `tsx`.

## License

See root [LICENSE](../../LICENSE).
