# `@mushi-mushi/mcp-ci`

> **Your AI wrote it. Mushi tells you why it broke.**

A GitHub Action for people who already use Mushi Mushi and want CI to act on
their bug reports: hand one report to an agent that opens a fix PR, ask
questions about your reports, or run Mushi Mushi's pre-release checks on a
commit.

> **Status: the `uses:` line below does not run today.** `action.yml` starts
> `dist/cli.js`, and the built `dist/` folder is not in the repository
> (checked 2026-10-29 on `master` and on the `@mushi-mushi/mcp-ci@0.6.8` tag),
> so the step fails before any command starts. The commands below describe
> what the code does once that is fixed.

```yaml
- uses: kensaurus/mushi-mushi/packages/mcp-ci@master
  with:
    api-key: ${{ secrets.MUSHI_API_KEY }}
    project-id: ${{ secrets.MUSHI_PROJECT_ID }}
    command: dispatch-fix
    report-id: <report-uuid>
```

**What you need**

- A Mushi Mushi project and a project API key with MCP access, saved as a
  repo secret. An SDK key (`report:write`) is refused. `check-coverage`,
  `query` and `discovery-status` need `mcp:read`; every other command needs
  `mcp:write`. Mint the key on the console's **Connect** page.
- For `dispatch-fix`: a GitHub repo connected to the project, so the agent
  has somewhere to open the PR.
- For the inventory commands (`gates`, `discover-api`, `spec-drift`,
  `discovery-status`, `propose`, `auth-bootstrap`): the Studio or Enterprise plan on Mushi Mushi
  Cloud. Other plans get a 402. See [pricing](https://kensaur.us/mushi-mushi/docs/pricing).

Docs: [mcp-ci reference](https://kensaur.us/mushi-mushi/docs/sdks/mcp-ci)

This is not an MCP server. It calls the same REST API the MCP tools use, from
a short CI job. For tools inside your editor, install
[`@mushi-mushi/mcp`](https://www.npmjs.com/package/@mushi-mushi/mcp).

## Commands

### Reports and fixes

| `command`          | What it does                                                                 | Required inputs                       |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------- |
| `check-coverage`   | Meant to fail the step when fewer than `min-coverage` (default `0.8`) of your reports are classified. **It cannot fail today:** it reads a `classified` count that `GET /v1/admin/stats` does not return, so the ratio is `NaN` and the step passes. | none                                  |
| `trigger-judge`    | Asks the judge to grade Mushi Mushi's diagnoses it has not graded yet. It does not classify reports (that happens on its own when a report arrives). Needs the judge switched on for the project; the grading runs in the background after the step ends. | none                                  |
| `dispatch-fix`     | Hands one report to a coding agent, which opens a fix PR. `inventory-action-node-id` pins the fix to one inventory action, so its `expected_outcome` goes into the agent's prompt. | `report-id` (+ optional `inventory-action-node-id`) |
| `query`            | Asks a question about your reports in plain words and prints the answer.     | `question`                            |

### Inventory and pre-release checks (Studio or Enterprise plan)

| `command`          | What it does                                                                                                                                    | Required inputs                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `gates`            | Runs the pre-release gates for the current commit (`all` = `dead_handler`, `mock_leak`, `api_contract`, `status_claim`, `orphan_endpoint`, `unknown_call`), prints one line per gate, and fails the step when any gate fails, errors or returns no result. `dead_handler` and `mock_leak` read your ESLint JSON report (`eslint-report`); without it the step fails. The crawl runs from Inventory → Reconcile, not here. Use `gates: 'api_contract,status_claim'` to run a subset. | `eslint-report` for the lint gates (also `commit-sha` / `pr-number` / `gates`) |
| `discover-api`     | Reads your repo for Next.js route handlers and OpenAPI files (and, optionally, your Supabase tables) and sends the list to Mushi Mushi, so the `api_contract` check has something to compare against. | — (uses `repo-root` / `openapi-file` / `supabase-*`) |
| `spec-drift`       | Runs `oasdiff breaking` between two OpenAPI specs, records the findings as a `spec_drift` gate run and sets the `findings` output. Fails on a breaking change unless `fail-on-breaking: false`. | `base-spec`, `head-spec` (+ optional `fail-on-breaking`, `commit-sha`, `pr-number`) |

### Inventory from SDK traffic (Studio or Enterprise plan)

| `command`          | What it does                                                                                                                                                       | Required inputs                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `discovery-status` | Reads `GET /v1/admin/inventory/:projectId/discovery` and surfaces `route_count`, `total_events`, `ready_to_propose` as step outputs. Useful as a CI gate before `propose`. | —                                              |
| `propose`          | Kicks the LLM proposer (`POST /v1/admin/inventory/:projectId/propose` → `inventory-propose` Edge Function). Emits `proposal_id`; chain it into a PR-comment job.   | —                                              |
| `auth-bootstrap`   | Refreshes the crawler cookie via [`@mushi-mushi/inventory-auth-runner`](https://www.npmjs.com/package/@mushi-mushi/inventory-auth-runner) (shells out to `npx --yes -p @mushi-mushi/inventory-auth-runner mushi-mushi-auth refresh`). Run before any `gates` step that triggers a crawl. | `TEST_USER_*` env vars consumed by your script |

## Example: start a fix by hand

```yaml
# .github/workflows/mushi-fix.yml
on:
  workflow_dispatch:
    inputs:
      report_id:
        description: 'Mushi Mushi report id (UUID)'
        required: true

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: kensaurus/mushi-mushi/packages/mcp-ci@master
        with:
          api-key: ${{ secrets.MUSHI_API_KEY }}
          project-id: ${{ secrets.MUSHI_PROJECT_ID }}
          command: dispatch-fix
          report-id: ${{ inputs.report_id }}
```

## Example: pre-release checks on every PR

```yaml
# .github/workflows/mushi-gates.yml
name: Mushi Mushi checks
on: [pull_request]

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # auth-bootstrap signs in with Playwright, so the job needs a browser.
      - run: npx playwright install --with-deps chromium

      # Refresh the crawler cookie so the crawler can reach pages behind your login.
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

## Example: weekly inventory proposal

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
| `api-key`           | yes                   | —                                                           | Mushi Mushi project API key with `mcp:read` or `mcp:write` (see above). Store as a repo secret.                        |
| `project-id`        | yes                   | —                                                           | Mushi Mushi project UUID.                                                                                              |
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

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
