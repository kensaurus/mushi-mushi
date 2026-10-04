import { describe, expect, it } from 'vitest'
import { isOwnPresenceEcho } from './reportPresence'

// REPORT C (2026-10-04): every heartbeat upsert echoed back over realtime and
// re-read report_presence, although the viewer's own row never shows.
describe('isOwnPresenceEcho', () => {
  it('skips the echo of our own heartbeat', () => {
    expect(isOwnPresenceEcho({ new: { user_id: 'me' } }, 'me')).toBe(true)
    expect(isOwnPresenceEcho({ new: null, old: { user_id: 'me' } }, 'me')).toBe(true)
  })

  it('refreshes for anyone else, and when the author is unknown', () => {
    expect(isOwnPresenceEcho({ new: { user_id: 'teammate' } }, 'me')).toBe(false)
    // A DELETE payload may carry only the primary key.
    expect(isOwnPresenceEcho({ old: { id: 7 } }, 'me')).toBe(false)
    expect(isOwnPresenceEcho({ new: { user_id: 'me' } }, null)).toBe(false)
    expect(isOwnPresenceEcho(undefined, 'me')).toBe(false)
  })
})
