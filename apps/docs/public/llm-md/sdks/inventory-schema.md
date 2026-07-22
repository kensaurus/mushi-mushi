# @mushi-mushi/inventory-schema

Source: https://kensaur.us/mushi-mushi/docs/sdks/inventory-schema

---
title: '@mushi-mushi/inventory-schema'
---

# `@mushi-mushi/inventory-schema`

Source of truth for `inventory.yaml` — Zod schema, JSON Schema, and the
TypeScript types every other v2 surface depends on. The admin ingester,
the gate runner, the LLM proposer, and the GitHub Action all import from
here so a schema change is felt in exactly one place.

## Install

```bash
pnpm add -D @mushi-mushi/inventory-schema
```

You usually don't add this directly — the gates runner, ESLint plugin,
and CLI all bring it in transitively. Add it explicitly only if you're
writing a tool that produces or consumes `inventory.yaml` documents.

## What `inventory.yaml` looks like

```yaml filename="inventory.yaml"
version: 2
project:
  name: Acme web
stories:
  - id: signup
    title: New user signup
    pages:
      - id: signup
        path: /signup
        elements:
          - id: email
            selector: '[data-testid="email"]'
          - id: password
            selector: '[data-testid="password"]'
          - id: submit
            selector: '[data-testid="signup-submit"]'
            actions:
              - id: submit
                trigger: click
                # Machine-readable success contract. Threaded into the
                # fix-worker LLM prompt and asserted by the synthetic
                # monitor after every probe.
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

# Optional: feed an authenticated session to the synthetic monitor.
auth:
  scripted:
    steps:
      - navigate: /login
      - type: { selector: '[data-testid=email]', value: '$E2E_EMAIL' }
      - type: { selector: '[data-testid=password]', value: '$E2E_PASSWORD' }
      - click: { selector: '[data-testid=login]' }
      - waitFor: { url: /\/dashboard$/ }
```

See [Concepts → Inventory and gates](/concepts/inventory-and-gates) for
the conceptual model and a walkthrough of the five gates.

## Programmatic use

```ts
import {
  InventorySchema,
  parseInventory,
  type Inventory,
} from '@mushi-mushi/inventory-schema'

const result = parseInventory(yamlString)
if (!result.ok) {
  console.error(result.error.format())
  process.exit(1)
}
const inventory: Inventory = result.value
```

`InventorySchema` is the canonical Zod schema. `parseInventory` is a
small ergonomic wrapper that runs `safeParse` + a YAML loader.

## JSON Schema

The package also publishes a JSON Schema at
`@mushi-mushi/inventory-schema/json` for editor completion in any IDE
that understands `$schema` references:

```yaml filename="inventory.yaml"
# yaml-language-server: $schema=https://unpkg.com/@mushi-mushi/inventory-schema/json/inventory.schema.json
version: 2
# …
```
