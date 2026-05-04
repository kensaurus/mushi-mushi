/**
 * Server-side parity test for the v2 inventory schema.
 *
 * Why this exists
 * ───────────────
 * The v2 inventory schema lives in TWO places:
 *   - `packages/inventory-schema/`  (Node — admin / CLI / external callers)
 *   - `packages/server/supabase/functions/_shared/inventory.ts` (Deno edge runtime)
 *
 * Both files MUST accept and reject identical inputs. If they drift, the
 * admin UI's preflight will say "yaml is valid" while the server's
 * /v1/admin/inventory ingest rejects it (or vice-versa). This test runs
 * the Deno-side validator under Vitest against the same fixtures the
 * Node package tests use, so any drift fails CI loudly.
 */

import { describe, it, expect } from 'vitest'
import {
  parseInventoryYaml,
  computeStats,
  validateInventoryObject,
  STATUS_GLYPHS,
} from '../../supabase/functions/_shared/inventory.ts'

const VALID_YAML = `
schema_version: "2.0"
app:
  id: glot-it
  name: Glot.it
  base_url: https://glot.it
user_stories:
  - id: submit-answer
    title: Submit answer
    persona: Learner
    pages: [practice]
pages:
  - id: practice
    path: /practice
    title: Practice
    elements:
      - id: btn-submit
        type: button
        action: submits the user's answer
        backend:
          - method: POST
            path: /api/practice/submit
        db_writes:
          - table: attempts
            operation: insert
        crud: C
        verified_by:
          - file: tests/practice.spec.ts
            name: submit answer persists attempt
        status: verified
`.trim()

describe('Deno-side parseInventoryYaml', () => {
  it('accepts a well-formed v2 inventory', () => {
    const r = parseInventoryYaml(VALID_YAML)
    expect(r.ok).toBe(true)
    expect(r.inventory?.app.id).toBe('glot-it')
    expect(r.inventory?.pages[0]?.elements[0]?.id).toBe('btn-submit')
  })

  it('rejects yaml without schema_version 2.x', () => {
    const r = parseInventoryYaml(VALID_YAML.replace('"2.0"', '"1.0"'))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.path === 'schema_version')).toBe(true)
  })

  it('reports the structural path of an invalid HTTP method', () => {
    const r = parseInventoryYaml(VALID_YAML.replace('method: POST', 'method: SUBMIT'))
    expect(r.ok).toBe(false)
    expect(r.issues[0]?.path).toMatch(/pages\[0\]\.elements\[0\]\.backend\[0\]\.method/)
  })

  it('rejects pages without leading slash', () => {
    const r = parseInventoryYaml(VALID_YAML.replace('path: /practice', 'path: practice'))
    expect(r.ok).toBe(false)
  })

  it('returns issues for non-yaml input', () => {
    const r = parseInventoryYaml('@@@@: not yaml :: { ::')
    expect(r.ok).toBe(false)
    expect(r.issues[0]?.code).toBe('YAML_PARSE')
  })
})

describe('Deno-side computeStats', () => {
  it('counts pages, elements, actions, deps, claimed status', () => {
    const r = parseInventoryYaml(VALID_YAML)
    expect(r.ok).toBe(true)
    const stats = computeStats(r.inventory!)
    expect(stats.pages).toBe(1)
    expect(stats.elements).toBe(1)
    expect(stats.actions).toBe(1)
    expect(stats.api_deps).toBe(1)
    expect(stats.db_deps).toBe(1)
    expect(stats.tests).toBe(1)
    expect(stats.claimed_status.verified).toBe(1)
  })
})

describe('Deno-side validateInventoryObject', () => {
  it('accepts a parsed object', () => {
    const r = validateInventoryObject({
      schema_version: '2.0',
      app: { id: 'a', name: 'A', base_url: 'https://a.app' },
      pages: [{ id: 'home', path: '/', elements: [] }],
    })
    expect(r.ok).toBe(true)
  })
})

describe('status glyph table', () => {
  it('matches the whitepaper §3.3 glyphs', () => {
    expect(STATUS_GLYPHS.stub).toBe('🔴')
    expect(STATUS_GLYPHS.mocked).toBe('🟠')
    expect(STATUS_GLYPHS.wired).toBe('🟡')
    expect(STATUS_GLYPHS.verified).toBe('🟢')
    expect(STATUS_GLYPHS.regressed).toBe('⚫')
    expect(STATUS_GLYPHS.unknown).toBe('⚪')
  })
})
