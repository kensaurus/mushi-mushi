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
