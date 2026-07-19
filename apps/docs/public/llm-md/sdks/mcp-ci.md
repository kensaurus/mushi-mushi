# @mushi-mushi/mcp-ci

Source: https://kensaur.us/mushi-mushi/docs/sdks/mcp-ci

---
title: '@mushi-mushi/mcp-ci'
---

# `@mushi-mushi/mcp-ci`

The Mushi v2 GitHub Action — runs the five-gate composite check, drafts
inventory entries from a recent crawl, and bootstraps an authenticated
session for crawler / synthetic monitor runs against staging.

## Quick start

```yaml filename=".github/workflows/mushi-gates.yml"
name: Mushi gates
on:
  pull_request:
    branches: [main, master]
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
        with:
          api-key:    ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command:    gates
```

The action posts a single composite GitHub status — `mushi-mushi/gates` —
which rolls up:

- `mushi-mushi/no-dead-handler` — empty `onClick` / `onSubmit` etc. found
  by the ESLint plugin.
- `mushi-mushi/no-mock-leak` — faker / `John Doe` arrays surfaced in
  non-test paths.
- **Inventory drift** — actions added, removed, or renamed since the last
  push.
- **Agentic-failure detection** — handlers that regressed across deploys
  (the inventory's `expected_outcome` checks no longer hold).
- **Synthetic walk health** — the synthetic monitor's last walk against
  staging.

## Commands

| `command:`           | What it does                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `gates`              | The default — runs all five gates and posts the composite check.      |
| `propose`            | Asks the LLM proposer for an updated `inventory.yaml` draft, opens a PR. |
| `discover-api`       | Crawls the candidate routes the SDK observed in production.           |
| `discovery-status`   | Prints the current discovery snapshot for the project.                |
| `auth-bootstrap`     | Runs the `inventory.yaml` `auth.scripted` block and seeds the cookies into `project_settings`. |

## In your IDE

The same commands are exposed as MCP tools via [`@mushi-mushi/mcp`](/sdks/mcp).
Cursor, Claude Code, and Copilot can run them on your behalf when the MCP
server is configured. Inside the admin console you can also click
**Run gates** / **Run crawler** directly on each row of the User stories
page — see [Admin → User stories · Inventory](/admin/inventory).

## Inputs

| Input         | Required | Default       | Description                                          |
| ------------- | :------: | ------------- | ---------------------------------------------------- |
| `api-key`     | ✓        | —             | Project API key (`mushi_…`).                         |
| `project-id`  | ✓        | —             | Project ID (`proj_…`).                               |
| `command`     |          | `gates`       | One of the commands listed above.                    |
| `api-url`     |          | auto-routed   | Override for self-hosted Mushi deployments.          |
| `inventory`   |          | `inventory.yaml` | Path to the inventory file (relative to repo root). |
| `working-directory` |    | `.`           | Sub-directory to run the action from (monorepos).    |
