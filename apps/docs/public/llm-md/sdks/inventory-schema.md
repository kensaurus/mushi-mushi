# @mushi-mushi/inventory-schema

Source: https://kensaur.us/mushi-mushi/docs/sdks/inventory-schema

---
title: '@mushi-mushi/inventory-schema'
description: "The Zod schema, JSON Schema and TypeScript types for inventory.yaml: your app's pages, the buttons and forms on each, what they do, and the tests that prove it."
---

# `@mushi-mushi/inventory-schema`

Validate an `inventory.yaml`: the file that lists your app's pages, the
buttons and forms on each one, what each should do, and the test that
proves it. Zod schema, JSON Schema and TypeScript types, matching what the
Mushi console accepts when you upload the file.

## Install

```bash
pnpm add @mushi-mushi/inventory-schema
```

Add it when you write a tool that produces or checks `inventory.yaml`
files, or to validate the file in your own CI. Mushi's CLI, ESLint plugin
and GitHub Action do not depend on it.

## What `inventory.yaml` looks like

```yaml filename="inventory.yaml"
schema_version: '2.0'          # a string starting with "2"; quote it
app:
  id: acme-web
  name: Acme web
  base_url: https://app.acme.test
  # Optional: how the crawler signs in (see inventory-auth-runner).
  auth:
    type: scripted
    config:
      login_path: /login
      script: |
        await page.fill('[data-testid=email]', env.TEST_USER_EMAIL)
        await page.fill('[data-testid=password]', env.TEST_USER_PASSWORD)
        await page.click('[data-testid=login]')
user_stories:
  - id: signup
    title: New user signup
    pages: [signup]
pages:
  - id: signup
    path: /signup
    auth_required: false
    elements:
      - id: signup-submit
        type: button             # button, link, form, input, list, toggle, menu, image, media, other
        action: Creates the account and opens the dashboard
        user_story: signup
        testid: signup-submit
        backend:
          - { method: POST, path: /signup }
        db_writes:
          - { table: users, operation: insert }
        verified_by:
          - { file: e2e/signup.spec.ts, name: signs up a new user, framework: playwright }
        # Machine-readable success contract. Threaded into the
        # fix-worker LLM prompt and asserted by the synthetic
        # monitor after every probe.
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

`app` and at least one page are required; `user_stories`, `dependencies`
and `extensions` are optional. Each element needs `id`, `type` and
`action`. `auth` can also be `cookie`, `bearer` or `oauth`.

See [Concepts → Inventory and gates](/concepts/inventory-and-gates) for
the conceptual model and a walkthrough of the gates.

## Programmatic use

```ts
import {
  inventorySchema,
  parseInventory,
  type Inventory,
} from '@mushi-mushi/inventory-schema'

const result = parseInventory(yamlString)
if (!result.ok) {
  for (const issue of result.issues) console.error(`${issue.path}: ${issue.message}`)
  process.exit(1)
}
const inventory: Inventory = result.inventory!
```

`inventorySchema` is the canonical Zod schema. `parseInventory` loads the
YAML and runs `safeParse`; `validateInventory` does the same for an object
you already parsed. `computeStats` counts pages, elements, actions, stories,
API and database dependencies, and tests.

## JSON Schema

For editor completion, point your YAML extension at the published JSON
Schema:

```yaml filename="inventory.yaml"
# yaml-language-server: $schema=https://kensaur.us/mushi-mushi/schemas/inventory-2.0.json
schema_version: '2.0'
# …
```

The same schema is exported as `inventoryJsonSchema` from
`@mushi-mushi/inventory-schema/json-schema`.
