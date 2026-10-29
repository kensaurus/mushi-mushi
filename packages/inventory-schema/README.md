# @mushi-mushi/inventory-schema

> **Your AI wrote it. Mushi tells you why it broke.**

Validate an `inventory.yaml`: the file that lists your app's pages, the buttons and forms on each one, what each should do, and the test that proves it. Zod schema, JSON Schema and TypeScript types in one package.

```bash
npm install @mushi-mushi/inventory-schema
```

```ts
import { parseInventory, computeStats } from '@mushi-mushi/inventory-schema'

const result = parseInventory(yamlString)
if (!result.ok || !result.inventory) {
  for (const issue of result.issues) {
    console.error(`${issue.path}: ${issue.message}`)
  }
  process.exit(1)
}

const stats = computeStats(result.inventory)
console.log(`${stats.actions} actions across ${stats.pages} pages.`)
```

Docs: [inventory-schema](https://kensaur.us/mushi-mushi/docs/sdks/inventory-schema)

## What this is

The Zod schema (and a hand-authored JSON Schema companion) for the **positive side** of the Mushi Mushi bidirectional knowledge graph:

- `App` (`app`) — your product: `id`, `name`, `base_url`, optional `auth`
- `UserStory` (`user_stories`) — the human-readable goal a user is trying to achieve
- `Page` (`pages`) — a route / screen
- `Element` (`pages[].elements`) — an interactive UI element (`type`: `button`, `link`, `form`, …) and its `action`, what it does in plain words (`triggers payroll calculation and persists payslips`)
- `ApiDep` (`backend`) — backend route the element calls
- `DbDep` (`db_writes` / `db_reads`) — table the element writes to / reads from
- `TestRef` (`verified_by`) — the test that verifies the element
- **`expected_outcome`** — optional machine-readable success contract on each element. Threaded into the fix-worker LLM prompt by [`@mushi-mushi/agents`](https://github.com/kensaurus/mushi-mushi/tree/master/packages/agents) and asserted by the synthetic monitor after every probe

## Why it exists

Sentry catches what crashes. Mabl catches what is tested. User-feedback tools catch what users notice. **None of them catch code that ships claiming to work but isn't wired** — the dominant agentic-coding failure mode of 2025–2026.

The inventory makes that failure mode addressable. Each element declares its `backend` routes and `verified_by` tests; the Mushi Mushi v2 status reconciler then derives whether the action is `🔴 stub`, `🟠 mocked`, `🟡 wired`, `🟢 verified`, or `⚫ regressed` from observable signals (lint, contract diff, CI test results, synthetic monitor, user reports). The customer's `inventory.yaml` is the contract that makes all of this comparable.

`validateInventory(value)` does the same for an object you already parsed. Both return `{ ok, inventory, issues }`.

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

The Zod schema in [`src/index.ts`](https://github.com/kensaurus/mushi-mushi/blob/master/packages/inventory-schema/src/index.ts) is the single source of
truth. The hand-authored JSON Schema companion lives in
[`src/json-schema.ts`](https://github.com/kensaurus/mushi-mushi/blob/master/packages/inventory-schema/src/json-schema.ts) and is published to
`https://kensaur.us/mushi-mushi/schemas/inventory-2.0.json` for editor
autocomplete (see above).

## `expected_outcome` — machine-readable success contract

Every element accepts an optional `expected_outcome` block. It's the
contract that closes the spec-traceability loop on the **write** side:
the fix-worker injects it verbatim into the LLM prompt, the
deterministic `validateAgainstSpec` gate refuses to open a PR that
removes a `json_path` field the contract asserts on, and the synthetic
monitor probes the live action against it after every PR merge.

```yaml
# one entry in pages[].elements
- id: signup-submit
  type: button
  action: 'Creates the account and opens the dashboard'
  testid: signup-submit
  backend:
    - { method: POST, path: /signup }
  db_writes:
    - { table: users, operation: insert }
  expected_outcome:
    summary: 'POST /signup returns 200 and creates a user row'
    response:
      status_in: [200, 201]
      json_path:
        - { path: 'user.id', op: 'exists' }
    database:
      table: 'users'
      expect: 'row_exists'
    ui:
      route_change_to: '/dashboard'
      visible_text: 'Welcome'
```

Supported `op` values for `response.json_path` entries: `exists`, `equals`, `not_equals`, `contains`, `gt`, `gte`, `lt`, `lte`, `matches`. Supported `database.expect` values: `row_exists`, `row_absent`, `row_count_at_least` (with `min_count`).

The full TypeScript shape is exported as `ExpectedOutcome` and mirrored
in [`@mushi-mushi/agents`](https://github.com/kensaurus/mushi-mushi/tree/master/packages/agents) so the agents package stays
buildable from the Edge runtime without pulling the YAML loader.

## License

MIT.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 530 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
