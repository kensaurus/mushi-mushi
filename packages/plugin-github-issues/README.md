# `@mushi-mushi/plugin-github-issues`

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


Mushi Mushi plugin: open a GitHub Issue (with a `mushi-bug` label) for every
classified bug report and close it automatically when Mushi applies a fix.

## Install

```bash
npm i @mushi-mushi/plugin-github-issues
```

## Run as a stand-alone server

```bash
MUSHI_PLUGIN_SECRET=...        # set when the plugin is installed in Mushi admin
GITHUB_TOKEN=...               # PAT or App installation token (issues:write, metadata:read)
GITHUB_OWNER=acme              # repo owner (user or org)
GITHUB_REPO=widget-app         # repo name
ADMIN_BASE_URL=https://...     # Mushi admin base URL (deep-links)
PORT=3000                      # optional
npx mushi-plugin-github-issues
```

Install **GitHub Issues** in the Mushi admin Marketplace and point its
`webhook_url` at `https://your-host/mushi/webhook`.

## Programmatic usage

```ts
import { createGithubIssuesPlugin } from '@mushi-mushi/plugin-github-issues'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk'

const handler = createGithubIssuesPlugin({
  token: process.env.GITHUB_TOKEN!,
  owner: process.env.GITHUB_OWNER!,
  repo: process.env.GITHUB_REPO!,
  adminBaseUrl: process.env.ADMIN_BASE_URL!,
  mushiSecret: process.env.MUSHI_PLUGIN_SECRET!,
})

express().post('/mushi/webhook', expressMiddleware(handler)).listen(3000)
```

## Subscribed events

- `report.classified` → `POST /repos/{owner}/{repo}/issues` (creates the
  `mushi-bug` label idempotently if missing).
- `fix.applied` → `PATCH /repos/{owner}/{repo}/issues/{number}` with
  `state: closed`.

## Notes

- Default issue-number cache is in-memory; persist mappings in
  `report_external_issues` for durability across restarts.
- All GitHub API calls retry transient failures via `withRetry` from
  `@mushi-mushi/plugin-sdk`.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 55 edge functions · 325 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
