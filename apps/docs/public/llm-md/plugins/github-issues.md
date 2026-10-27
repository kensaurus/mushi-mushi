# GitHub Issues

Source: https://kensaur.us/mushi-mushi/docs/plugins/github-issues

---
title: GitHub Issues
description: Open a GitHub issue for every triaged Mushi report and close it when the fix lands — set it up on the Integrations page, or self-host the plugin.
---

# GitHub Issues plugin

Opens a GitHub issue for each bug Mushi triages, and closes it when the fix
lands.

## Setup (Mushi Cloud, no code)

1. Create a fine-grained token with **Issues: Read and write** on the repo
   that should get the issues (it can be a separate public tracker repo).
2. In the Mushi console: open the **Integrations** page, find **GitHub
   Issues**, and enter the owner, repo and token. **Test connection** checks it.

Mushi opens the issues and closes them itself; you do not need the npm package.

## Self-hosted plugin

[`@mushi-mushi/plugin-github-issues`](https://www.npmjs.com/package/@mushi-mushi/plugin-github-issues)
does the same from your own server. The console's Marketplace has no GitHub
Issues listing, so it only receives events from a Mushi server you run
yourself, once you add a `plugin_registry` row for it.

```bash
npm i @mushi-mushi/plugin-github-issues
export MUSHI_PLUGIN_SECRET=...
export GITHUB_TOKEN=...     # Issues: write, Metadata: read
export GITHUB_OWNER=acme
export GITHUB_REPO=widget-app
npx -p @mushi-mushi/plugin-github-issues mushi-plugin-github-issues
```

| Event | Action |
| --- | --- |
| `report.classified` | Open an issue labelled `mushi-bug` (the label is created if missing) |
| `fix.applied` | Close the issue |
