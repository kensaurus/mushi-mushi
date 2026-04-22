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

| `command`          | What it does                                                                 | Required inputs                       |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------- |
| `check-coverage`   | Fails if `classified / total` is below `min-coverage`. Default threshold `0.8`. | —                                     |
| `trigger-judge`    | Runs the classification pipeline on up to 50 unclassified reports.           | —                                     |
| `dispatch-fix`     | Queues an agentic fix attempt for a specific report.                         | `report-id`                           |
| `query`            | Runs a natural-language query and prints the result.                         | `question`                            |

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

## Inputs

| Input           | Required              | Default                                                     | Description                                                         |
| --------------- | --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `api-key`       | yes                   | —                                                           | Mushi project API key. Store as a repo secret.                      |
| `project-id`    | yes                   | —                                                           | Mushi project UUID.                                                 |
| `command`       | yes                   | —                                                           | One of the commands above.                                          |
| `api-endpoint`  | no                    | Hosted Supabase functions URL                               | Override for self-hosted deployments.                               |
| `report-id`     | when `dispatch-fix`   | —                                                           | Report UUID to dispatch a fix for.                                  |
| `question`      | when `query`          | —                                                           | Natural-language query text.                                        |
| `min-coverage`  | no                    | `0.8`                                                       | For `check-coverage`: minimum classified ratio.                     |
| `fail-on-quota` | no                    | `true`                                                      | Fail the step on `QUOTA_EXCEEDED`. Set `false` to warn and continue. |

## Outputs

| Output     | Description                                              |
| ---------- | -------------------------------------------------------- |
| `result`   | Raw JSON envelope returned by the Mushi API.             |
| `coverage` | For `check-coverage`: observed classified ratio (0–1).   |

## License

MIT
