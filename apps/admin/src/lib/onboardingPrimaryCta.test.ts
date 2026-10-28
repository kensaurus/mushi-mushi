/**
 * Pipeline-live card on /onboarding. The "N of N steps" header and this
 * CTA must read the same setup counts (report c016af11).
 */

import { describe, expect, it } from 'vitest'
import { onboardingPrimaryCta } from './onboardingPrimaryCta'

const LIVE = { done: true, complete: 10, total: 10, mergedFixCount: 1 }

describe('onboardingPrimaryCta', () => {
  it('offers no setup CTA when every step is complete', () => {
    const cta = onboardingPrimaryCta(LIVE)
    expect(cta.label).toBe('View fixes')
    expect(cta.to).toBe('/fixes')
    expect(cta.variant).toBe('ghost')
    expect(cta.label).not.toMatch(/connect/i)
  })

  it('stays on View fixes when the loop is closed and the step list is full', () => {
    expect(onboardingPrimaryCta({ ...LIVE, mergedFixCount: 0 }).label).toBe('View fixes')
    expect(onboardingPrimaryCta({ done: true, complete: 8, total: 10, mergedFixCount: 2 }).label).toBe('View fixes')
  })

  it('asks to connect fix agents only while steps remain', () => {
    const cta = onboardingPrimaryCta({ done: true, complete: 8, total: 10, mergedFixCount: 0 })
    expect(cta.label).toBe('Connect fix agents')
    expect(cta.to).toBe('/integrations/config')
    expect(cta.variant).toBe('primary')
  })
})
