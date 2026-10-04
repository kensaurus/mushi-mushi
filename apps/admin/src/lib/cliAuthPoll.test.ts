import { describe, expect, it } from 'vitest'
import { interpretClaimPoll } from './cliAuthPoll'

// QA bug 268: a poll blip after approval showed "Couldn't approve" + "Retry approve".
describe('interpretClaimPoll', () => {
  it('a network blip or server error keeps waiting', () => {
    expect(interpretClaimPoll(null)).toEqual({ kind: 'keep-waiting', transient: true })
    expect(interpretClaimPoll({ ok: false, error: { code: 'NETWORK_ERROR' } })).toEqual({ kind: 'keep-waiting', transient: true })
    expect(interpretClaimPoll({ ok: false, error: { code: 'INTERNAL_ERROR' } })).toEqual({ kind: 'keep-waiting', transient: true })
  })

  it('claimed connects; pending keeps waiting quietly', () => {
    expect(interpretClaimPoll({ ok: true, data: { status: 'approved', claimed: true } })).toEqual({ kind: 'connected' })
    expect(interpretClaimPoll({ ok: true, data: { status: 'approved', claimed: false } })).toEqual({ kind: 'keep-waiting', transient: false })
  })

  it('expired, denied and missing requests end the wait', () => {
    expect(interpretClaimPoll({ ok: true, data: { status: 'expired' } }).kind).toBe('ended')
    expect(interpretClaimPoll({ ok: true, data: { status: 'rejected' } }).kind).toBe('ended')
    expect(interpretClaimPoll({ ok: false, error: { code: 'NOT_FOUND' } }).kind).toBe('ended')
  })
})
