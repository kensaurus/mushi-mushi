/**
 * Pipeline-live card on /onboarding. The "N of N steps" header and this
 * CTA must read the same setup counts (report c016af11).
 */

import { describe, expect, it } from 'vitest'
import type { SetupProject } from './useSetupStatus'
import { onboardingPrimaryCta, onboardingSetupComplete } from './onboardingPrimaryCta'

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

  it('shows the pipeline-live hero only when required steps are done and the counter is full', () => {
    expect(onboardingSetupComplete({ done: true, complete: 10, total: 10 })).toBe(true)
    // A merged fix changes the button. It does not bring the hero up while steps remain.
    expect(onboardingSetupComplete({ done: true, complete: 8, total: 10 })).toBe(false)
    expect(onboardingPrimaryCta({ done: true, complete: 8, total: 10, mergedFixCount: 1 }).label).toBe('View fixes')
    // A full counter with required steps still open keeps the hero down.
    expect(onboardingSetupComplete({ done: false, complete: 10, total: 10 })).toBe(false)
  })

  it('never asks to connect agents when the hero is up', () => {
    const full = { done: true, complete: 10, total: 10, mergedFixCount: 0 }
    expect(onboardingSetupComplete(full)).toBe(true)
    expect(onboardingPrimaryCta(full).label).toBe('View fixes')
  })

  it('closes the loop from SetupProject.merged_fix_count', () => {
    const mergedFixCount = 1 satisfies SetupProject['merged_fix_count']
    expect(onboardingPrimaryCta({ done: true, complete: 8, total: 10, mergedFixCount }).label).toBe('View fixes')
    const none = 0 satisfies SetupProject['merged_fix_count']
    expect(onboardingPrimaryCta({ done: true, complete: 8, total: 10, mergedFixCount: none }).label).toBe('Connect fix agents')
  })
})
