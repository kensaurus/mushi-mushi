# `@mushi-mushi/mcp-ci`

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


GitHub Action that runs Mushi Mushi MCP-style tools from CI. Use it to
**gate PR merges** on classification coverage, kick off the judge after a
deploy, dispatch fixes for a specific report, or run natural-language
queries against your report corpus — all without leaving your workflow.

```yaml
- uses: kensaurus/mushi-mushi/packages/mcp-ci@master
  with:
    api-key: ${{ secrets.MUSHI_API_KEY }}
    project-id: ${{ secrets.MUSHI_PROJECT_ID }}
    command: check-coverage   # fail the step when under 80% of reports are triaged
```

Docs: [mcp-ci reference](https://kensaur.us/mushi-mushi/docs/sdks/mcp-ci)

> Not a full MCP server. For the full MCP experience (tools, prompts,
> streaming), install [`@mushi-mushi/mcp`](https://www.npmjs.com/package/@mushi-mushi/mcp) and run it against your
> local Claude Code / Codex / Cursor setup. This Action is the 80% glue
> path: short-lived CI jobs that call the same REST endpoints the MCP
> server exposes, with no stdio transport overhead.

## Commands

### Triage & fix loop

| `command`          | What it does                                                                 | Required inputs                       |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------- |
| `check-coverage`   | Fails if `classified / total` is below `min-coverage`. Default threshold `0.8`. | —                                     |
| `trigger-judge`    | Runs the classification pipeline on up to 50 unclassified reports.           | —                                     |
| `dispatch-fix`     | Queues an agentic fix attempt for a specific report. Optionally accepts `inventory-action-node-id` to pin the fix to a specific inventory `Action` so the worker threads its `expected_outcome` contract into the LLM prompt and runs a targeted post-PR synthetic probe (whitepaper §2.10). | `report-id` (+ optional `inventory-action-node-id`) |
| `query`            | Runs a natural-language query and prints the result.                         | `question`                            |

### Mushi v2 — bidirectional inventory & gates

| `command`          | What it does                                                                                                                                    | Required inputs                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `gates`            | Runs the pre-release gates for the current commit (`all` = `dead_handler`, `mock_leak`, `api_contract`, `status_claim`, `orphan_endpoint`, `unknown_call`), prints one line per gate, and fails the step when any gate fails, errors or returns no result. `dead_handler` and `mock_leak` read your ESLint JSON report (`eslint-report`); without it the step fails. The crawl runs from Inventory → Reconcile, not here. Use `gates: 'api_contract,status_claim'` to run a subset. | `eslint-report` for the lint gates (also `commit-sha` / `pr-number` / `gates`) |
| `discover-api`     | Walks the customer repo for Next.js route handlers + OpenAPI + (optionally) Supabase introspection and POSTs the resulting `discovered_apis` to `inventory-gates` so Gate 3 (`api_contract`) has something to diff against. | — (uses `repo-root` / `openapi-file` / `supabase-*`) |
| `spec-drift`       | Gate 6: runs `oasdiff breaking` between two OpenAPI specs, records the findings as a `spec_drift` gate run and sets the `findings` output. Fails on a breaking change unless `fail-on-breaking: false`. | `base-spec`, `head-spec` (+ optional `fail-on-breaking`, `commit-sha`, `pr-number`) |

### Mushi v2.1 — passive discovery & proposal flow

| `command`          | What it does                                                                                                                                                       | Required inputs                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `discovery-status` | Reads `GET /v1/admin/inventory/:projectId/discovery` and surfaces `route_count`, `total_events`, `ready_to_propose` as step outputs. Useful as a CI gate before `propose`. | —                                              |
| `propose`          | Kicks the LLM proposer (`POST /v1/admin/inventory/:projectId/propose` → `inventory-propose` Edge Function). Emits `proposal_id`; chain it into a PR-comment job.   | —                                              |
| `auth-bootstrap`   | Refreshes the crawler cookie via [`@mushi-mushi/inventory-auth-runner`](https://www.npmjs.com/package/@mushi-mushi/inventory-auth-runner) (shells out to `npx --yes -p @mushi-mushi/inventory-auth-runner mushi-mushi-auth refresh`). Run before any `gates` step that triggers a crawl. | `TEST_USER_*` env vars consumed by your script |

## Quick start — gate merges on triage coverage

```yaml
# .github/workflows/mushi-gate.yml
name: Mushi CI Gate
on: [pull_request]

jobs:
  classify:
    runs-on: ubuntu-latest
    steps:
      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: trigger-judge

      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
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
      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
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

      # Refresh the crawler cookie so the crawler can reach auth-gated routes.
      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: auth-bootstrap
        env:
          TEST_USER_EMAIL: ${{ secrets.MUSHI_TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.MUSHI_TEST_USER_PASSWORD }}

      # Feed Gate 3 (api_contract) the current commit's API surface.
      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: discover-api

      # Gates 1 + 2 read your ESLint report: lint with eslint-plugin-mushi-mushi
      # (no-dead-handler, no-mock-leak) and save it as JSON. `|| true` keeps
      # lint errors from stopping the job here; the gates step judges them.
      - run: npx eslint -f json -o mushi-eslint.json src/ || true

      # Run the gates; the step fails when any gate fails.
      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: gates
          eslint-report: mushi-eslint.json
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
        uses: kensaurus/mushi-mushi/packages/mcp-ci@master
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: discovery-status

      - if: steps.status.outputs.ready_to_propose == 'true'
        uses: kensaurus/mushi-mushi/packages/mcp-ci@master
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
| `inventory-action-node-id` | no             | —                                                           | For `dispatch-fix`: pin the fix to one inventory action so its `expected_outcome` goes into the agent's prompt.        |
| `question`          | when `query`          | —                                                           | Natural-language query text.                                                                                           |
| `min-coverage`      | no                    | `0.8`                                                       | For `check-coverage`: minimum classified ratio.                                                                        |
| `fail-on-quota`     | no                    | `true`                                                      | Fail the step on `QUOTA_EXCEEDED`. Set `false` to warn and continue.                                                   |
| `commit-sha`        | when `gates`          | `GITHUB_SHA`                                                | Commit the gates run against. Surfaces in the admin `/inventory ▸ Gates` view.                                         |
| `pr-number`         | when `gates`          | —                                                           | Pull-request number used to scope `gate_findings` for the admin UI.                                                    |
| `gates`             | when `gates`          | `'all'`                                                     | Comma-separated subset of `dead_handler,mock_leak,api_contract,status_claim,orphan_endpoint,unknown_call`. `crawl` is refused: start it from Inventory → Reconcile. |
| `eslint-report`     | when `gates` runs `dead_handler` or `mock_leak` | —                                     | Path to an ESLint JSON report (`eslint -f json`) made with `eslint-plugin-mushi-mushi`. Without it those gates fail the step instead of passing on no evidence. |
| `repo-root`         | when `discover-api`   | `GITHUB_WORKSPACE`                                          | Directory to walk for Next.js route handlers + OpenAPI files. For `gates`, the root `eslint-report` paths are made relative to. |
| `openapi-file`      | when `discover-api`   | `<repo-root>/openapi.yaml`                                  | Explicit OpenAPI file path.                                                                                            |
| `supabase-url`      | when `discover-api`   | —                                                           | Supabase project URL to introspect via `/rest/v1/` for `db_deps`.                                                      |
| `supabase-anon-key` | when `discover-api`   | —                                                           | Supabase anon key for the introspection.                                                                               |
| `base-spec`         | when `spec-drift`     | —                                                           | Path or URL of the base OpenAPI spec (the previous version).                                                           |
| `head-spec`         | when `spec-drift`     | —                                                           | Path or URL of the head OpenAPI spec (this PR).                                                                        |
| `fail-on-breaking`  | no                    | `true`                                                      | For `spec-drift`: fail the step on a breaking change. Set `false` to warn only.                                        |

## Outputs

| Output              | Description                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `result`            | Raw JSON envelope returned by the Mushi API.                                           |
| `coverage`          | For `check-coverage`: observed classified ratio (0–1).                                 |
| `findings`          | For `spec-drift`: JSON array of the oasdiff findings.                                  |
| `ready_to_propose`  | For `discovery-status`: `'true'` once the project has a defensible-sized SDK sample.   |
| `total_events`      | For `discovery-status`: total `discovery_events` rows aggregated server-side.          |
| `route_count`       | For `discovery-status`: distinct route templates observed in the last 30 days.         |
| `proposal_id`       | For `propose`: UUID of the new `inventory_proposals` row, ready to deep-link into the admin. |

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 520 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
