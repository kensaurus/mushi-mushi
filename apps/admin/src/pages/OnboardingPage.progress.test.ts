/**
 * Set up tracked progress four ways on one screen: the rail ("Your app is
 * wired up"), an "all steps done" card saying "the loop runs automatically",
 * a "You are here" stage strip, and setup gaps; its tabs read Steps, Verify,
 * SDK, Diagnose (2026-10-28, console sweep and the integrator's new-user
 * walk). The page is too heavy to render here, so the layout is pinned in
 * source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'OnboardingPage.tsx'), 'utf8')

describe('Set up page progress', () => {
  it('has no second "all done" card or stage strip beside the rail', () => {
    expect(src).not.toContain('Pipeline live')
    expect(src).not.toContain('the loop runs automatically')
    expect(src).not.toContain('<ProjectNarrativeStrip')
  })

  it('keeps the rail and the setup gaps', () => {
    expect(src).toContain('<SetupProgressRail')
    expect(src).toContain('<SetupGapsSection')
  })

  it('names its tabs in plain words', () => {
    const tabs = src.slice(src.indexOf('const ONBOARDING_TABS'), src.indexOf('function isOnboardingTab'))
    const labels = [...tabs.matchAll(/label: '([^']+)'/g)].map((m) => m[1])
    expect(labels).toEqual(['Overview', 'All steps', 'Test it', 'Install', 'Fix a problem'])
    // Page copy overrides these names; the base copy used to put the old
    // jargon back ("Steps", "Verify", "SDK"), so the page still showed it.
    const copy = readFileSync(join(__dirname, '../lib/copy.ts'), 'utf8')
    expect(copy).not.toMatch(/steps: 'Steps'|verify: 'Verify'|sdk: 'SDK'/)
    expect(copy).not.toContain('see the loop run')
  })

  // "Heartbeat", "loop", "pipeline" and "report key" were jargon on the
  // new-user path (integrator's walk, 2026-10-28).
  it('says what happens in plain words on the new-user path', () => {
    for (const phrase of ['evolution loop', 'Watch the loop', 'pipeline live', 'generate a report key']) {
      expect(src, phrase).not.toContain(phrase)
    }
    const checklist = readFileSync(join(__dirname, '../components/SetupChecklist.tsx'), 'utf8')
    expect(checklist).not.toMatch(/'(SDK heartbeat|Heartbeat|Backend mismatch)'/)
    const readout = readFileSync(join(__dirname, '../components/onboarding/OnboardingSetupReadout.tsx'), 'utf8')
    expect(readout).not.toContain('No heartbeat yet')
  })
})
