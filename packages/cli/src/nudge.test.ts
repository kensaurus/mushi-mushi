import { describe, expect, it } from 'vitest'
import { getPreset, renderNudgeExplainer, renderNudgeSnippet } from './nudge.js'

describe('nudge presets', () => {
  it('returns conservative cadence for beta phase', () => {
    const p = getPreset('beta')
    expect(p.maxProactivePerSession).toBe(2)
    expect(p.dismissCooldownHours).toBe(24)
    expect(p.featureRequestCard).toBe(true)
    expect(p.betaMode).toBe(true)
  })

  it('strips beta-only triggers for ga phase', () => {
    const p = getPreset('ga')
    expect(p.pageDwellMinutes).toBe(0)
    expect(p.firstSessionSeconds).toBe(0)
    expect(p.betaMode).toBe(false)
    // GA still keeps technical signals — they catch real bugs even on
    // mature apps and don't feel like nagging.
    expect(p.rageClick).toBe(true)
    expect(p.apiCascade).toBe(true)
    expect(p.errorBoundary).toBe(true)
  })

  it('is most aggressive for alpha phase', () => {
    const p = getPreset('alpha')
    expect(p.maxProactivePerSession).toBeGreaterThan(getPreset('beta').maxProactivePerSession)
    expect(p.dismissCooldownHours).toBeLessThan(getPreset('beta').dismissCooldownHours)
    expect(p.pageDwellMinutes).toBeLessThan(getPreset('beta').pageDwellMinutes)
  })
})

describe('renderNudgeSnippet', () => {
  it('produces compilable TypeScript with pageDwell + firstSession on beta', () => {
    const snippet = renderNudgeSnippet({ phase: 'beta' })
    expect(snippet).toContain('Mushi.init({')
    expect(snippet).toContain('pageDwell: { thresholdMs: 5 * 60 * 1000 }')
    expect(snippet).toContain('firstSession: { delayMs: 45 * 1000 }')
    expect(snippet).toContain('featureRequestCard: true')
    expect(snippet).toContain('betaMode: {')
  })

  it('omits pageDwell + firstSession + betaMode on ga', () => {
    const snippet = renderNudgeSnippet({ phase: 'ga' })
    expect(snippet).not.toContain('pageDwell')
    expect(snippet).not.toContain('firstSession')
    expect(snippet).not.toContain('betaMode')
    expect(snippet).toContain('featureRequestCard: true')
  })

  it('respects --max and --dwell overrides', () => {
    const snippet = renderNudgeSnippet({
      phase: 'beta',
      overrides: { maxProactivePerSession: 5, pageDwellMinutes: 10 },
    })
    expect(snippet).toContain('maxProactivePerSession: 5')
    expect(snippet).toContain('pageDwell: { thresholdMs: 10 * 60 * 1000 }')
  })

  it('disables a trigger when override sets it to 0', () => {
    const snippet = renderNudgeSnippet({
      phase: 'beta',
      overrides: { firstSessionSeconds: 0 },
    })
    expect(snippet).not.toContain('firstSession')
    expect(snippet).toContain('pageDwell')
  })
})

describe('renderNudgeExplainer', () => {
  it('mentions both cadence + each enabled signal', () => {
    const out = renderNudgeExplainer('beta')
    expect(out).toContain('2 proactive prompts per session')
    expect(out).toContain('24h cooldown')
    expect(out).toContain('rage-click')
    expect(out).toContain('feature-request card: shown')
  })
})
