/**
 * The real rule behind POST /v1/admin/projects/:id/autofix/toggle
 * (_shared/autofix-toggle.ts), now that an API key can call it (gap #28).
 * autofix-toggle-contract.test.ts describes the contract on an in-memory
 * model; this one runs the function the route uses.
 */
import { describe, expect, it } from 'vitest'
import { decideAutofixToggle } from '../../supabase/functions/_shared/autofix-toggle.ts'

describe('decideAutofixToggle', () => {
  it('lets an owner or admin set either value', () => {
    expect(decideAutofixToggle('owner', { enabled: true })).toEqual({ ok: true, enabled: true })
    expect(decideAutofixToggle('admin', { enabled: false })).toEqual({ ok: true, enabled: false })
  })

  it('refuses members, viewers and callers without access', () => {
    for (const role of ['member', 'viewer', null, undefined]) {
      expect(decideAutofixToggle(role, { enabled: true }), String(role)).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' })
    }
  })

  it('never reads a missing or non-boolean value as "off"', () => {
    // The route used Boolean(body.enabled): an empty body silently disabled autofix.
    for (const body of [null, undefined, {}, { enabled: 'true' }, { enabled: 1 }, 'enabled', []]) {
      expect(decideAutofixToggle('owner', body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'BAD_BODY' })
    }
  })

  it('checks the role before the body, so a stranger learns nothing about the shape', () => {
    expect(decideAutofixToggle('viewer', {})).toMatchObject({ status: 403 })
  })
})
