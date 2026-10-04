import { describe, expect, it } from 'vitest'
import { reporterLabel } from './reporterLabel'

describe('reporterLabel', () => {
  it('never shows the host app user id as the name (glot.it 2026-10-04)', () => {
    const id = 'a076d7d9-9eea-41db-9ab5-40bc874f9a5d'
    expect(reporterLabel({ reporter_display_name: id, reporter_identity: null }, 'tok123')).toEqual({
      text: 'Signed-in user',
      shortId: 'a076d7d9',
      title: `App user id ${id}`,
    })
  })

  it('uses a real display name', () => {
    expect(reporterLabel({ reporter_display_name: 'Mika', reporter_identity: null }, 'tok123').text).toBe('Mika')
  })

  it('falls back to an anonymous label with the short token', () => {
    expect(reporterLabel({}, 'tok123')).toEqual({ text: 'Anonymous reporter', shortId: 'tok123', title: null })
  })
})
