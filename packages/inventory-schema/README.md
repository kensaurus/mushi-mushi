# @mushi-mushi/inventory-schema

> **Your AI wrote it. Mushi tells you why it broke.**

AI-built apps often ship a button that looks finished but is wired to
nothing. An `inventory.yaml` lists your app's pages, the buttons and forms on
each one, what each should do, and the test that proves it, so Mushi Mushi can
check those claims. This package validates that file: Zod schema, JSON Schema
and TypeScript types in one place.

The package is MIT and works offline. Uploading an inventory to Mushi Mushi
and running its checks needs the Studio or Enterprise plan on Mushi Mushi
Cloud ([pricing](https://kensaur.us/mushi-mushi/docs/pricing)).

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

The Zod schema (and a hand-written JSON Schema copy) for what your app says it does:

- `App` (`app`): your product: `id`, `name`, `base_url`, optional `auth`
- `UserStory` (`user_stories`): the goal a user is trying to reach, in plain words
- `Page` (`pages`): a route or screen
- `Element` (`pages[].elements`): a button, link, form or other control (`type`) and its `action`, what it does in plain words (`triggers payroll calculation and persists payslips`)
- `ApiDep` (`backend`): a backend route the element calls
- `DbDep` (`db_writes` / `db_reads`): a table the element writes to or reads from
- `TestRef` (`verified_by`): the test that proves the element works
- **`expected_outcome`**: an optional success check on each element. The fix worker puts it into the agent's prompt and the synthetic monitor checks it after each probe

`parseInventory(yamlString)` parses and validates YAML. `validateInventory(value)` does the same for an object you already parsed. Both return `{ ok, inventory, issues }`.

## Why it exists

Error tools catch what crashes, and tests catch what someone tested. Neither
catches a handler that ships wired to nothing, because nothing throws.

Each element declares its `backend` routes and `verified_by` tests. Mushi
Mushi's status reconciler then marks each action `stub`, `mocked`, `wired`,
`verified` or `regressed` from what it can observe: lint results, the API
contract diff, CI test results, the synthetic monitor and user reports. Your
`inventory.yaml` is what those signals are compared against.

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

## `expected_outcome`: what success looks like

Every element accepts an optional `expected_outcome` block. The fix worker
puts it word for word into the agent's prompt, the `validateAgainstSpec`
check refuses to open a PR that removes a `json_path` field it asserts on,
and the synthetic monitor checks the live action against it after a PR
merges.

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

The TypeScript type is exported as `ExpectedOutcome`.

## License

MIT.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
