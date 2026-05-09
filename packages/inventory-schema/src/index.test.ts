import { describe, expect, it } from 'vitest'
import {
  computeStats,
  parseInventory,
  STATUS_GLYPHS,
  STATUS_PRIORITY,
  validateInventory,
} from './index.js'

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

describe('parseInventory', () => {
  it('accepts a well-formed v2 inventory', () => {
    const r = parseInventory(VALID_YAML)
    expect(r.ok).toBe(true)
    expect(r.inventory?.app.id).toBe('glot-it')
    expect(r.inventory?.pages[0]?.elements[0]?.id).toBe('btn-submit')
  })

  it('rejects yaml without schema_version 2.x', () => {
    const r = parseInventory(VALID_YAML.replace('"2.0"', '"1.0"'))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.path === 'schema_version')).toBe(true)
  })

  it('reports the structural path of an invalid HTTP method', () => {
    const yaml = VALID_YAML.replace('method: POST', 'method: SUBMIT')
    const r = parseInventory(yaml)
    expect(r.ok).toBe(false)
    expect(r.issues[0]?.path).toMatch(/pages\[0\]\.elements\[0\]\.backend\[0\]\.method/)
  })

  it('rejects pages without leading slash', () => {
    const yaml = VALID_YAML.replace('path: /practice', 'path: practice')
    const r = parseInventory(yaml)
    expect(r.ok).toBe(false)
  })

  it('returns issues for non-yaml input', () => {
    const r = parseInventory('@@@@: not yaml :: { ::')
    expect(r.ok).toBe(false)
    expect(r.issues[0]?.code).toBe('YAML_PARSE')
  })
})

describe('validateInventory', () => {
  it('accepts a parsed object', () => {
    const r = validateInventory({
      schema_version: '2.0',
      app: { id: 'a', name: 'A', base_url: 'https://a.app' },
      pages: [{ id: 'home', path: '/', elements: [] }],
    })
    expect(r.ok).toBe(true)
  })
})

describe('computeStats', () => {
  it('counts pages, elements, actions, deps, claimed status', () => {
    const r = parseInventory(VALID_YAML)
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

describe('status table integrity', () => {
  it('exposes a glyph + priority for every status', () => {
    expect(Object.keys(STATUS_GLYPHS).length).toBe(6)
    expect(Object.keys(STATUS_PRIORITY).length).toBe(6)
  })
})

describe('expected_outcome (spec-traceability contract)', () => {
  // Element with full expected_outcome — used by the synthetic monitor and
  // the fix-worker to verify that any AI-drafted fix still satisfies the
  // contract the action was meant to fulfil.
  const YAML_WITH_OUTCOME = `
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
        action: submit answer
        backend:
          - method: POST
            path: /api/practice/submit
        expected_outcome:
          summary: Persists an attempt row and returns the submission id.
          response:
            status_in: [200, 201]
            json_path:
              - path: data.id
                op: exists
              - path: data.status
                op: equals
                value: queued
          database:
            table: attempts
            where:
              user_id: $reporter_id
            expect: row_exists
          ui:
            visible_text: Answer received
            route_change_to: /practice/results/:id
`.trim()

  it('accepts an element that declares a full expected_outcome contract', () => {
    const r = parseInventory(YAML_WITH_OUTCOME)
    expect(r.ok).toBe(true)
    const eo = r.inventory!.pages[0].elements[0].expected_outcome
    expect(eo?.response?.status_in).toEqual([200, 201])
    expect(eo?.response?.json_path?.[0]?.op).toBe('exists')
    expect(eo?.database?.table).toBe('attempts')
    expect(eo?.database?.expect).toBe('row_exists')
    expect(eo?.ui?.route_change_to).toBe('/practice/results/:id')
  })

  it('treats expected_outcome as optional (legacy inventories still validate)', () => {
    const yaml = YAML_WITH_OUTCOME.replace(/\s+expected_outcome:[\s\S]*/m, '')
    const r = parseInventory(yaml)
    expect(r.ok).toBe(true)
    expect(r.inventory!.pages[0].elements[0].expected_outcome).toBeUndefined()
  })

  it('rejects an unknown json_path operator', () => {
    const yaml = YAML_WITH_OUTCOME.replace('op: equals', 'op: bogus_op')
    const r = parseInventory(yaml)
    expect(r.ok).toBe(false)
    expect(
      r.issues.some((i) => /expected_outcome\.response\.json_path/.test(i.path)),
    ).toBe(true)
  })

  it('rejects database.expect outside the documented enum', () => {
    const yaml = YAML_WITH_OUTCOME.replace('expect: row_exists', 'expect: row_maybe')
    const r = parseInventory(yaml)
    expect(r.ok).toBe(false)
    expect(
      r.issues.some((i) => /expected_outcome\.database\.expect/.test(i.path)),
    ).toBe(true)
  })

  it('rejects HTTP statuses outside 100..599', () => {
    const yaml = YAML_WITH_OUTCOME.replace('status_in: [200, 201]', 'status_in: [200, 999]')
    const r = parseInventory(yaml)
    expect(r.ok).toBe(false)
  })
})
