# @mushi-mushi/inventory-auth-runner

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

Mushi Mushi's crawler and synthetic monitor can only check pages they can
reach, and most app pages sit behind a login. This runner signs in to your app
with Playwright, using the login script in your `inventory.yaml`, and hands
Mushi Mushi only the session cookie, never your test password.

```bash
MUSHI_API_KEY=mushi_xxx MUSHI_PROJECT=<project-uuid> \
TEST_USER_EMAIL=qa@example.com TEST_USER_PASSWORD=… \
npx --yes -p @mushi-mushi/inventory-auth-runner mushi-mushi-auth refresh
```

**What you need**

- A project on the Studio or Enterprise plan of Mushi Mushi Cloud. The
  inventory routes this runner reads and writes answer 402 on other plans.
  See [pricing](https://kensaur.us/mushi-mushi/docs/pricing).
- An `inventory.yaml` for the project with a `scripted` login (below), already
  uploaded to Mushi Mushi.
- A project API key with the `mcp:write` scope.
- Playwright's Chromium on the machine that runs it
  (`npx playwright install --with-deps chromium`).

Docs: [inventory-auth-runner](https://kensaur.us/mushi-mushi/docs/sdks/inventory-auth-runner).
The `auth` block it runs is defined in
[`@mushi-mushi/inventory-schema`](https://www.npmjs.com/package/@mushi-mushi/inventory-schema).

## What it does

1. Reads the project's currently-ingested `inventory.yaml` from
   `GET /v1/admin/inventory/:projectId`.
2. Finds the `app.auth` block of type `scripted` and runs its `script` against
   `app.base_url + app.auth.config.login_path` in a headless Chromium
   instance via Playwright.
3. Picks the resulting session cookie (prefers `*session*` / `*auth*` /
   `sb-*` / `next-auth*` names, then `HttpOnly` + `Secure`).
4. PATCHes that cookie into `project_settings.crawler_auth_config` via
   `PATCH /v1/admin/inventory/:projectId/settings`.

After a successful refresh, the crawler and synthetic monitor can open
pages behind your login without seeing your test credentials. They only see
the cookie.

## What it does not do

- It does not sandbox your login script. An inline `script` runs in Node
  through `new Function`, gets only `page`, `env` and `context`, and is
  refused if it contains one of the blocked words listed under
  [Inventory snippet](#inventory-snippet). That is a denylist, not a sandbox.
  A `js:` file is a normal Node module, so review it like any code in your
  repo.
- It does **not** store credentials on the Mushi Mushi server. Creds are read
  from the local environment (`TEST_USER_EMAIL`, `TEST_USER_PASSWORD`,
  or whatever variables your `script` references) and only the
  *cookie* is shipped to the server.
- It does **not** persist the browser context between runs. Every
  invocation starts a clean Chromium profile.

## Install

```bash
# As a one-shot via npx (no install needed):
npx --yes -p @mushi-mushi/inventory-auth-runner mushi-mushi-auth refresh

# Or as a dev dependency in your repo:
pnpm add -D @mushi-mushi/inventory-auth-runner
```

The `mushi-mushi-auth` bin is exposed by the package; `npx mushi-mushi-auth refresh`
works once it's installed.

## Use

Set the two required env vars, plus whatever your login script reads, and
run `refresh`:

```bash
MUSHI_API_KEY=mushi_xxx \
MUSHI_PROJECT=00000000-0000-0000-0000-000000000000 \
TEST_USER_EMAIL=qa@example.com \
TEST_USER_PASSWORD=… \
npx --yes -p @mushi-mushi/inventory-auth-runner mushi-mushi-auth refresh
```

| Var                  | Required | Description                                                                                                |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `MUSHI_API_KEY`      | yes      | Project-scoped API key with the `mcp:write` scope. Mint one on the admin console's Connect page (`/connect`, read + write access) or under Projects → keys. |
| `MUSHI_PROJECT`      | yes      | Mushi Mushi project UUID.                                                                                      |
| `MUSHI_API_ENDPOINT` | no       | API base URL. Defaults to the hosted Supabase functions endpoint.                                          |
| `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | usually | Picked up by your login `script` (as `env.TEST_USER_EMAIL`); the runner itself doesn't read them. Add whatever your script needs. |

`--debug` prints the captured cookie name + a 6-char prefix of the value
to stderr. **Never use `--debug` in CI.** Anything the job prints ends up
in your build logs.

## Inventory snippet

Your `inventory.yaml` declares the script the runner will execute, as
`auth` inside `app` (the schema has no top-level `auth`):

```yaml
app:
  id: my-app
  name: My app
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

`auth` sits under `app`, where [`@mushi-mushi/inventory-schema`](https://www.npmjs.com/package/@mushi-mushi/inventory-schema) defines it. Inline scripts may not contain `require(`, `import(`, `process.`, `globalThis.`, `Function(`, `eval(`, `child_process`, `Deno.` or `Worker(`, and are capped at 8 KB; put anything else in a `js:` file.

Two `script` shapes are accepted:

1. **Inline** (above): a function body that receives `page`, `env` and
   `context`. It runs via `new Function(...)`, so it cannot see the
   runner's own variables.
2. **File reference**: `script: 'js:./scripts/login.js'`. The runner
   `import()`s the path relative to the folder of your local
   `inventory.yaml` (`--inventory <path>` or `MUSHI_INVENTORY_FILE`;
   default `./inventory.yaml`, so the working directory); the module must `default-export`
   an `(page, env, context) => Promise<void>` function. Use this when
   you'd rather commit the script to your repo without inline-escaping
   it into YAML.

## CI integration

The [`@mushi-mushi/mcp-ci`](https://www.npmjs.com/package/@mushi-mushi/mcp-ci) GitHub Action exposes an
`auth-bootstrap` command that shells out to this runner. Its `uses:` path does
not run today (the Action's built files are missing from the repository; see
the mcp-ci README), so until that is fixed, run the `npx` command above as a
plain `run:` step instead.

```yaml
- run: npx playwright install --with-deps chromium
- run: npx --yes -p @mushi-mushi/inventory-auth-runner mushi-mushi-auth refresh
  env:
    MUSHI_API_KEY: ${{ secrets.MUSHI_API_KEY }}
    MUSHI_PROJECT: ${{ secrets.MUSHI_PROJECT_ID }}
    TEST_USER_EMAIL: ${{ secrets.MUSHI_TEST_USER_EMAIL }}
    TEST_USER_PASSWORD: ${{ secrets.MUSHI_TEST_USER_PASSWORD }}
```

Once the Action works, the same step is:

```yaml
- uses: kensaurus/mushi-mushi/packages/mcp-ci@master
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
- The cookie write (`PATCH /v1/admin/inventory/:projectId/settings`)
  requires the `mcp:write` scope; a key without it is rejected by the
  server and the refresh fails.
- Cookies have a soft TTL via `last_refreshed_at`; re-run on a daily
  cron or after every CI deploy.
- Each run starts a fresh headless Chromium: no saved browser profile and no
  cookies shared between runs.

## Scripts

```bash
pnpm auth         # tsx src/run.ts (run the CLI from source)
pnpm build        # tsup → dist/run.js (the bin) + dist/index.{js,cjs,d.ts}
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
```

The published package ships the built `dist/` only; `pnpm auth` runs the
TypeScript source through `tsx` for local development.

## License

MIT. See [LICENSE](https://github.com/kensaurus/mushi-mushi/blob/master/packages/inventory-auth-runner/LICENSE).


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
