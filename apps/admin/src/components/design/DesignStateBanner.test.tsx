import { describe, expect, it } from 'vitest'
import { reconcileDesignState } from './DesignStateBanner'

describe('reconcileDesignState (audit 2026-10-20, B7)', () => {
  it('an OK scan above token issues reads as drift and names the count', () => {
    const out = reconcileDesignState({ state: 'ok', reason: 'Code follows your design tokens (off-system score 0/100).' }, 200)
    expect(out.state).toBe('drift')
    expect(out.reason).toContain('200 token issues')
  })

  it('an OK scan with no token issues stays OK with the server wording', () => {
    const out = reconcileDesignState({ state: 'ok', reason: 'Code follows your design tokens.' }, 0)
    expect(out).toEqual({ state: 'ok', reason: 'Code follows your design tokens.' })
  })

  it('a non-OK state is never upgraded', () => {
    const out = reconcileDesignState({ state: 'error', reason: 'Scan failed.' }, 5)
    expect(out).toEqual({ state: 'error', reason: 'Scan failed.' })
  })
})
