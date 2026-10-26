# `@mushi-mushi/plugin-github-issues`

> **Your AI wrote it. Mushi tells you why it broke.**

Opens a GitHub issue (labelled `mushi-bug`) for each bug Mushi triages and
closes it when Mushi applies the fix.

**Do you need this package?** Not on Mushi Cloud: add GitHub Issues on the
**Integrations** page of the console (owner, repo and a token with Issues:
write) and Mushi opens and closes the issues itself. The console's
Marketplace has no GitHub Issues listing (checked 2026-10-26), so this
package only receives events from a Mushi server you run yourself, once you
add a `plugin_registry` row for it.

```bash
npm i @mushi-mushi/plugin-github-issues
export MUSHI_PLUGIN_SECRET=...      # the signing secret set when the plugin is installed
export GITHUB_TOKEN=...             # PAT or App installation token (Issues: write, Metadata: read)
export GITHUB_OWNER=acme            # repo owner (user or org)
export GITHUB_REPO=widget-app       # repo name
export ADMIN_BASE_URL=https://...   # optional: Mushi console URL, for report links
npx -p @mushi-mushi/plugin-github-issues mushi-plugin-github-issues   # POST /mushi/webhook on PORT (default 3000)
```

Docs: https://kensaur.us/mushi-mushi/docs/plugins/github-issues

## Programmatic usage

```bash
npm i @mushi-mushi/plugin-github-issues @mushi-mushi/plugin-sdk express
```

```ts
import { createGithubIssuesPlugin } from '@mushi-mushi/plugin-github-issues'
import express from 'express'
import { expressMiddleware } from '@mushi-mushi/plugin-sdk/express'

const handler = createGithubIssuesPlugin({
  token: process.env.GITHUB_TOKEN!,
  owner: process.env.GITHUB_OWNER!,
  repo: process.env.GITHUB_REPO!,
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? '',
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

- The issue-number cache is in-memory by default, so after a restart
  `fix.applied` cannot find the issue. Pass your own cache as the second
  argument to `createGithubIssuesPlugin` to keep it.
- All GitHub API calls retry transient failures via `withRetry` from
  `@mushi-mushi/plugin-sdk`.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 76 edge functions · 507 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
