# @mushi-mushi/inventory-auth-runner

Source: https://kensaur.us/mushi-mushi/docs/sdks/inventory-auth-runner

---
title: '@mushi-mushi/inventory-auth-runner'
description: "@mushi-mushi/inventory-auth-runner logs in with Playwright from your inventory.yaml auth script so Mushi's crawler can reach pages behind a login."
---

# `@mushi-mushi/inventory-auth-runner`

A small Playwright runner that executes the scripted `app.auth` block of your
[`inventory.yaml`](/sdks/inventory-schema), captures the resulting cookies,
and stores them in `project_settings` so the v2 crawler and synthetic
monitor can reach pages behind a login wall.

## When you need it

If your `inventory.yaml` describes any path that requires a session
(`/dashboard`, `/settings/*`), the crawler and synthetic monitor will
get redirected to `/login` until they have valid auth. This package
gives you the bootstrap step that hands them a session.

## Install

```bash
pnpm add -D @mushi-mushi/inventory-auth-runner
```

## Usage

Add an `auth` block of type `scripted` inside `app` in `inventory.yaml`:

```yaml filename="inventory.yaml"
app:
  id: acme
  name: Acme
  base_url: https://app.acme.test
  auth:
    type: scripted
    config:
      login_path: /login
      script: |
        await page.fill('[data-testid=email]', env.E2E_EMAIL)
        await page.fill('[data-testid=password]', env.E2E_PASSWORD)
        await page.click('[data-testid=login]')
        await page.waitForURL('**/dashboard')
```

Then run:

```bash
E2E_EMAIL=user@acme.test \
E2E_PASSWORD=… \
MUSHI_API_KEY=mushi_… \
MUSHI_PROJECT=<project uuid> \
npx mushi-mushi-auth refresh
```

The runner opens `base_url + login_path` headlessly, runs the script,
picks the session cookie set by the target origin, and PATCHes it to
`/v1/admin/inventory/:projectId/settings`. The crawler and synthetic
monitor read from the same row on every run.

## In CI

Cookies expire. Rebake them on a schedule (e.g. nightly) so the
synthetic monitor never falls back to an unauthenticated walk:

```yaml filename=".github/workflows/mushi-auth-bootstrap.yml"
name: Mushi auth bootstrap
on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
        with:
          api-key:    ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command:    auth-bootstrap
```

The `auth-bootstrap` command in [`@mushi-mushi/mcp-ci`](/sdks/mcp-ci)
is a convenience wrapper that calls this runner — use it from CI.
