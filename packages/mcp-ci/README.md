# `@mushi-mushi/mcp-ci`

GitHub Action that runs Mushi Mushi MCP-style tools from CI. Use it to
**gate PR merges** on classification coverage, kick off the judge after a
deploy, dispatch fixes for a specific report, or run natural-language
queries against your report corpus — all without leaving your workflow.

> Not a full MCP server. For the full MCP experience (tools, prompts,
> streaming), install [`@mushi-mushi/mcp`](../mcp) and run it against your
> local Claude Code / Codex / Cursor setup. This Action is the 80% glue
> path: short-lived CI jobs that call the same REST endpoints the MCP
> server exposes, with no stdio transport overhead.

## Commands

### Triage & fix loop

| `command`          | What it does                                                                 | Required inputs                       |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------- |
| `check-coverage`   | Fails if `classified / total` is below `min-coverage`. Default threshold `0.8`. | —                                     |
| `trigger-judge`    | Runs the classification pipeline on up to 50 unclassified reports.           | —                                     |
| `dispatch-fix`     | Queues an agentic fix attempt for a specific report.                         | `report-id`                           |
| `query`            | Runs a natural-language query and prints the result.                         | `question`                            |

### Mushi v2 — bidirectional inventory & gates

| `command`          | What it does                                                                                                                                    | Required inputs                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `gates`            | Runs all five pre-release gates (`dead_handler`, `mock_leak`, `api_contract`, `crawl`, `status_claim`) for the current commit and posts a single composite status. Use `gates: 'crawl,status_claim'` to run a subset. | — (uses `commit-sha` / `pr-number` / `gates`)    |
| `discover-api`     | Walks the customer repo for Next.js route handlers + OpenAPI + (optionally) Supabase introspection and POSTs the resulting `discovered_apis` to `inventory-gates` so Gate 3 (`api_contract`) has something to diff against. | — (uses `repo-root` / `openapi-file` / `supabase-*`) |

### Mushi v2.1 — passive discovery & proposal flow

| `command`          | What it does                                                                                                                                                       | Required inputs                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `discovery-status` | Reads `GET /v1/admin/inventory/:projectId/discovery` and surfaces `route_count`, `total_events`, `ready_to_propose` as step outputs. Useful as a CI gate before `propose`. | —                                              |
| `propose`          | Kicks the LLM proposer (`POST /v1/admin/inventory/:projectId/propose` → `inventory-propose` Edge Function). Emits `proposal_id`; chain it into a PR-comment job.   | —                                              |
| `auth-bootstrap`   | Refreshes the crawler cookie via [`@mushi-mushi/inventory-auth-runner`](../inventory-auth-runner) (shells out to `npx --yes @mushi-mushi/inventory-auth-runner refresh`). Run before any `gates` step that triggers a crawl. | `TEST_USER_*` env vars consumed by your script |

## Quick start — gate merges on triage coverage

```yaml
# .github/workflows/mushi-gate.yml
name: Mushi CI Gate
on: [pull_request]

jobs:
  classify:
    runs-on: ubuntu-latest
    steps:
      - uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: trigger-judge

      - uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: check-coverage
          min-coverage: '0.9'
```

## Quick start — auto-dispatch fix on label

```yaml
on:
  issues:
    types: [labeled]

jobs:
  dispatch:
    if: github.event.label.name == 'mushi:auto-fix'
    runs-on: ubuntu-latest
    steps:
      - uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: dispatch-fix
          report-id: ${{ github.event.issue.body }}
```

## Quick start — Mushi v2 gates on every PR

```yaml
# .github/workflows/mushi-gates.yml
name: Mushi v2 Gates
on: [pull_request]

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Refresh the crawler cookie so Gate 4 can hit auth-gated routes.
      - uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: auth-bootstrap
        env:
          TEST_USER_EMAIL: ${{ secrets.MUSHI_TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.MUSHI_TEST_USER_PASSWORD }}

      # Feed Gate 3 (api_contract) the current commit's API surface.
      - uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: discover-api

      # Run Gates 1–5 server-side and gate the PR on the composite status.
      - uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: gates
          commit-sha: ${{ github.event.pull_request.head.sha }}
          pr-number: ${{ github.event.pull_request.number }}
```

## Quick start — Mushi v2.1 weekly proposal job

```yaml
on:
  schedule:
    - cron: '0 9 * * 1' # every Monday 09:00 UTC

jobs:
  propose:
    runs-on: ubuntu-latest
    steps:
      - id: status
        uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: discovery-status

      - if: steps.status.outputs.ready_to_propose == 'true'
        uses: mushi-mushi/mushi-mushi/packages/mcp-ci@v1
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: propose
```

## Inputs

| Input               | Required              | Default                                                     | Description                                                                                                            |
| ------------------- | --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `api-key`           | yes                   | —                                                           | Mushi project API key. Store as a repo secret.                                                                         |
| `project-id`        | yes                   | —                                                           | Mushi project UUID.                                                                                                    |
| `command`           | yes                   | —                                                           | One of the commands above.                                                                                             |
| `api-endpoint`      | no                    | Hosted Supabase functions URL                               | Override for self-hosted deployments.                                                                                  |
| `report-id`         | when `dispatch-fix`   | —                                                           | Report UUID to dispatch a fix for.                                                                                     |
| `question`          | when `query`          | —                                                           | Natural-language query text.                                                                                           |
| `min-coverage`      | no                    | `0.8`                                                       | For `check-coverage`: minimum classified ratio.                                                                        |
| `fail-on-quota`     | no                    | `true`                                                      | Fail the step on `QUOTA_EXCEEDED`. Set `false` to warn and continue.                                                   |
| `commit-sha`        | when `gates`          | `GITHUB_SHA`                                                | Commit the gates run against. Surfaces in the admin `/inventory ▸ Gates` view.                                         |
| `pr-number`         | when `gates`          | —                                                           | Pull-request number used to scope `gate_findings` for the admin UI.                                                    |
| `gates`             | when `gates`          | `'all'`                                                     | Comma-separated subset (`dead_handler,mock_leak,api_contract,crawl,status_claim`).                                     |
| `repo-root`         | when `discover-api`   | `GITHUB_WORKSPACE`                                          | Directory to walk for Next.js route handlers + OpenAPI files.                                                          |
| `openapi-file`      | when `discover-api`   | `<repo-root>/openapi.yaml`                                  | Explicit OpenAPI file path.                                                                                            |
| `supabase-url`      | when `discover-api`   | —                                                           | Supabase project URL to introspect via `/rest/v1/` for `db_deps`.                                                      |
| `supabase-anon-key` | when `discover-api`   | —                                                           | Supabase anon key for the introspection.                                                                               |

## Outputs

| Output              | Description                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `result`            | Raw JSON envelope returned by the Mushi API.                                           |
| `coverage`          | For `check-coverage`: observed classified ratio (0–1).                                 |
| `ready_to_propose`  | For `discovery-status`: `'true'` once the project has a defensible-sized SDK sample.   |
| `total_events`      | For `discovery-status`: total `discovery_events` rows aggregated server-side.          |
| `route_count`       | For `discovery-status`: distinct route templates observed in the last 30 days.         |
| `proposal_id`       | For `propose`: UUID of the new `inventory_proposals` row, ready to deep-link into the admin. |

## License

MIT
