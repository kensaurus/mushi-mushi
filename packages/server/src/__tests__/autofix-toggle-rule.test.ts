/**
 * The body rule behind POST /v1/admin/projects/:id/autofix/toggle
 * (_shared/autofix-toggle.ts), now that an API key can call it (gap #28).
 * autofix-toggle-contract.test.ts describes the wider contract on an
 * in-memory model; this one runs the function the route uses.
 */
import { describe, expect, it } from 'vitest'
import { parseAutofixToggleBody } from '../../supabase/functions/_shared/autofix-toggle.ts'

describe('parseAutofixToggleBody', () => {
  it('accepts an explicit true or false', () => {
    expect(parseAutofixToggleBody({ enabled: true })).toEqual({ ok: true, enabled: true })
    expect(parseAutofixToggleBody({ enabled: false })).toEqual({ ok: true, enabled: false })
  })

  it('never reads a missing or non-boolean value as "off"', () => {
    // The route used Boolean(body.enabled): an empty body silently disabled autofix.
    for (const body of [null, undefined, {}, { enabled: 'true' }, { enabled: 1 }, 'enabled', []]) {
      expect(parseAutofixToggleBody(body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'BAD_BODY' })
    }
  })
})
