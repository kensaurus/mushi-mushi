# @mushi-mushi/inventory-schema

> **Your AI wrote it. Mushi tells you why it broke.**

JSON Schema for inventory.yaml user-story maps.


Single source of truth for the Mushi Mushi v2 `inventory.yaml` shape.

## What this is

The Zod schema (and a hand-authored JSON Schema companion) for the **positive side** of the Mushi Mushi bidirectional knowledge graph:

- `App` — your product
- `UserStory` — the human-readable goal a user is trying to achieve
- `Page` — a route / screen
- `Element` — an interactive UI element (`button`, `link`, `form`, …)
- `Action` — what an element does (`triggers payroll calculation and persists payslips`)
- `ApiDep` — backend route the action calls
- `DbDep` — table the action writes to / reads from
- `Test` — the Playwright spec that verifies the action
- **`expected_outcome`** — machine-readable success contract on every Action. Threaded into the fix-worker LLM prompt by [`@mushi-mushi/agents`](../agents/) and asserted by the synthetic monitor after every probe (whitepaper §2.10)

## Why it exists

Sentry catches what crashes. Mabl catches what is tested. User-feedback tools catch what users notice. **None of them catch code that ships claiming to work but isn't wired** — the dominant agentic-coding failure mode of 2025–2026.

The inventory makes that failure mode addressable. Every `Action` declares an `ApiDep` and a `verified_by` test; the Mushi Mushi v2 status reconciler then derives whether the action is `🔴 stub`, `🟠 mocked`, `🟡 wired`, `🟢 verified`, or `⚫ regressed` from observable signals (lint, contract diff, CI test results, synthetic monitor, user reports). The customer's `inventory.yaml` is the contract that makes all of this comparable.

## Install

```bash
npm install @mushi-mushi/inventory-schema
```

## Use

```ts
import { parseInventory, computeStats } from '@mushi-mushi/inventory-schema'

const result = parseInventory(yamlString)
if (!result.ok) {
  for (const issue of result.issues) {
    console.error(`${issue.path}: ${issue.message}`)
  }
  process.exit(1)
}

const stats = computeStats(result.inventory)
console.log(`${stats.actions} actions across ${stats.pages} pages.`)
```

## Editor autocomplete

Drop the JSON Schema into `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "https://kensaur.us/mushi-mushi/schemas/inventory-2.0.json": "inventory.yaml"
  }
}
```

Or import it directly:

```ts
import { inventoryJsonSchema } from '@mushi-mushi/inventory-schema/json-schema'
```

## Schema reference

The Zod schema in [`src/index.ts`](./src/index.ts) is the single source of
truth. The hand-authored JSON Schema companion lives in
[`src/json-schema.ts`](./src/json-schema.ts) and is published to
`https://kensaur.us/mushi-mushi/schemas/inventory-2.0.json` for editor
autocomplete (see above).

## `expected_outcome` — machine-readable success contract

Every `Action` accepts an optional `expected_outcome` block. It's the
contract that closes the spec-traceability loop on the **write** side:
the fix-worker injects it verbatim into the LLM prompt, the
deterministic `validateAgainstSpec` gate refuses to open a PR that
removes a `json_path` field the contract asserts on, and the synthetic
monitor probes the live action against it after every PR merge.

```yaml
- id: submit
  selector: '[data-testid="signup-submit"]'
  actions:
    - id: submit
      trigger: click
      expected_outcome:
        summary: 'POST /signup returns 200 and creates a user row'
        response:
          status_in: [200, 201]
          json_path:
            - { path: '$.user.id', op: 'exists' }
        database:
          table: 'users'
          expect: 'row_exists'
        ui:
          route_change_to: '/dashboard'
          visible_text: 'Welcome'
```

Supported `op` values for `response.json_path` entries: `exists`, `equals`, `not_equals`, `contains`, `gt`, `gte`, `lt`, `lte`, `matches`. Supported `database.expect` values: `row_exists`, `row_absent`, `row_count_at_least` (with `min_count`).

The full TypeScript shape is exported as `ExpectedOutcome` and mirrored
in [`@mushi-mushi/agents`](../agents/) so the agents package stays
buildable from the Edge runtime without pulling the YAML loader.

## License

MIT.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 51 edge functions · 298 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
