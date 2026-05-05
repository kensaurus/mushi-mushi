/**
 * json-schema round-trip tests — keeps the hand-authored draft-07 JSON
 * Schema (`./json-schema.ts`) in sync with the Zod schema (`./index.ts`).
 *
 * Why this file exists
 * ────────────────────
 * The Zod schema is the source of truth at runtime. The JSON Schema is
 * a hand-authored companion shipped to consumers that need a draft-07
 * artefact (the VS Code yaml plugin, GitHub Actions setup, generic
 * editor schema feeds). Without a test that exercises both validators
 * against the same fixtures, the JSON Schema can silently drift from
 * the Zod schema and consumers will get phantom errors / phantom
 * passes.
 *
 * Strategy: pin the static "shape" (top-level required fields, enums,
 * key invariants) and assert that any valid YAML the Zod parser
 * accepts is also acceptable structurally to the JSON Schema's static
 * shape. We deliberately do NOT pull in `ajv` — a real draft-07
 * validator would more than triple this package's install graph for a
 * test that is purposefully scope-bounded.
 */

import { describe, expect, it } from 'vitest'

import { parseInventory } from './index.js'
import { inventoryJsonSchema } from './json-schema.js'

const MINIMAL_VALID_YAML = `
schema_version: "2.0"
app:
  id: glot-it
  name: Glot.it
  base_url: https://glot.it
pages:
  - id: practice
    path: /practice
    elements:
      - id: btn-submit
        type: button
        action: submit the answer
`

describe('inventoryJsonSchema (draft-07 companion)', () => {
  it('declares the same top-level required fields as the Zod parser enforces', () => {
    expect(inventoryJsonSchema.required).toEqual(['schema_version', 'app', 'pages'])
  })

  it('pins the canonical $id so editor schema feeds keep resolving', () => {
    expect(inventoryJsonSchema.$id).toBe('https://mushimushi.dev/schemas/inventory-2.0.json')
  })

  it('exposes the schema_version pattern Zod also enforces (`^2(\\.\\d+)*$`)', () => {
    const sv = inventoryJsonSchema.properties.schema_version
    expect(sv.type).toBe('string')
    expect(sv.pattern).toBe('^2(\\.\\d+)*$')
  })

  it('mirrors the element.type enum from the Zod schema', () => {
    const elementType =
      inventoryJsonSchema.properties.pages.items.properties.elements.items.properties.type
    expect(elementType.enum).toEqual([
      'button',
      'link',
      'form',
      'input',
      'list',
      'toggle',
      'menu',
      'image',
      'media',
      'other',
    ])
  })

  it('mirrors the element.status enum from the Zod schema', () => {
    const elementStatus =
      inventoryJsonSchema.properties.pages.items.properties.elements.items.properties.status
    expect(elementStatus.enum).toEqual([
      'stub',
      'mocked',
      'wired',
      'verified',
      'regressed',
      'unknown',
    ])
  })

  it('mirrors the api.method enum from the Zod schema', () => {
    const method =
      inventoryJsonSchema.properties.pages.items.properties.elements.items.properties.backend.items
        .properties.method
    expect(method.enum).toEqual(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
  })

  it('declares pages.minItems = 1 (mirrors Zod `pages.min(1)`)', () => {
    expect(inventoryJsonSchema.properties.pages.minItems).toBe(1)
  })

  it('shares the `additionalProperties: false` posture at the root', () => {
    expect(inventoryJsonSchema.additionalProperties).toBe(false)
  })

  it('round-trips the minimal valid YAML through the Zod parser without errors', () => {
    const parsed = parseInventory(MINIMAL_VALID_YAML)
    expect(parsed.ok).toBe(true)
    expect(parsed.issues).toEqual([])
    if (parsed.ok && parsed.inventory) {
      // The fields the JSON Schema marks `required` are present after
      // a successful Zod parse. If a future change drops a field from
      // either side, this assertion catches it before publish.
      for (const key of inventoryJsonSchema.required) {
        expect(parsed.inventory).toHaveProperty(key)
      }
    }
  })

  it('rejects schema_version "1.0" via Zod, matching JSON Schema pattern', () => {
    const bad = parseInventory(MINIMAL_VALID_YAML.replace('"2.0"', '"1.0"'))
    expect(bad.ok).toBe(false)
    // Sanity: the JSON Schema pattern would also reject this string.
    const re = new RegExp(inventoryJsonSchema.properties.schema_version.pattern)
    expect(re.test('1.0')).toBe(false)
    expect(re.test('2.0')).toBe(true)
    expect(re.test('2.1')).toBe(true)
  })
})
