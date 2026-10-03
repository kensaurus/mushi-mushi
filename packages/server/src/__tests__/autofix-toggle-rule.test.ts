/**
 * The rule behind POST /v1/admin/projects/:id/autofix/toggle
 * (_shared/autofix-toggle.ts), now that an API key can call it (gap #28).
 * autofix-toggle-contract.test.ts drives the real route handlers; this one
 * runs the pure functions they use.
 */
import { describe, expect, it } from 'vitest'
import {
  canToggleAutofix,
  decideAutofixToggle,
  parseAutofixToggleBody,
} from '../../supabase/functions/_shared/autofix-toggle.ts'

describe('canToggleAutofix', () => {
  it('is true only for an owner or admin', () => {
    expect(canToggleAutofix('owner')).toBe(true)
    expect(canToggleAutofix('admin')).toBe(true)
    for (const role of ['member', 'viewer', null, undefined] as const) expect(canToggleAutofix(role), String(role)).toBe(false)
  })
})

describe('decideAutofixToggle', () => {
  it('lets an owner or admin set either value', () => {
    expect(decideAutofixToggle('owner', { enabled: true })).toEqual({ ok: true, enabled: true })
    expect(decideAutofixToggle('admin', { enabled: false })).toEqual({ ok: true, enabled: false })
  })

  it('refuses members, viewers and callers without access, either way', () => {
    for (const role of ['member', 'viewer', null, undefined] as const) {
      for (const enabled of [true, false]) {
        expect(decideAutofixToggle(role, { enabled }), `${String(role)} ${enabled}`).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' })
      }
    }
  })

  it('checks the role before the body, so a stranger learns nothing about the shape', () => {
    expect(decideAutofixToggle('viewer', {})).toMatchObject({ status: 403 })
  })
})

describe('parseAutofixToggleBody', () => {
  it('accepts an explicit true or false', () => {
    expect(parseAutofixToggleBody({ enabled: true })).toEqual({ ok: true, enabled: true })
    expect(parseAutofixToggleBody({ enabled: false })).toEqual({ ok: true, enabled: false })
  })

  it('never reads a missing or non-boolean value as "off"', () => {
    // The route used Boolean(body.enabled): an empty body silently disabled autofix.
    for (const body of [null, undefined, {}, { enabled: 'true' }, { enabled: 1 }, 'enabled', []]) {
      expect(parseAutofixToggleBody(body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'BAD_BODY' })
      expect(decideAutofixToggle('owner', body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'BAD_BODY' })
    }
  })
})
