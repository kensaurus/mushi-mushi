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

  it('does not tell you to open the Design system page when the banner is already on it', () => {
    const out = reconcileDesignState(
      {
        state: 'drift',
        reason: '3 hard-coded styles to swap for your design tokens (off-system score 42/100). Open the Design system page for each one.',
      },
      0,
    )
    expect(out.state).toBe('drift')
    expect(out.reason).toBe(
      '3 hard-coded styles to swap for your design tokens (off-system score 42/100). See each one under Deviance on this page.',
    )
    expect(out.reason).not.toContain('Open the Design system page')
  })

  it('points a not-yet-run check at this page instead of the Design system page', () => {
    const out = reconcileDesignState(
      { state: 'unknown', reason: 'Design tokens are read, but the design check has not run yet. Run it from the Design system page.' },
      0,
    )
    expect(out.reason).toBe(
      'Design tokens are read, but the design check has not run yet. Run the deviance check on this page.',
    )
  })
})
