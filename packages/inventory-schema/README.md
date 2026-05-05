# @mushi-mushi/inventory-schema

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
    "https://mushimushi.dev/schemas/inventory-2.0.json": "inventory.yaml"
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
`https://mushimushi.dev/schemas/inventory-2.0.json` for editor
autocomplete (see above).

## License

MIT.
