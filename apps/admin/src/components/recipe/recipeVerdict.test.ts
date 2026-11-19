import { describe, expect, it } from 'vitest'
import { problemPhrase, rankProblems, recipeVerdict, type VerdictDetector } from './recipeVerdict'
import { checkFixPrompt } from '../portfolio/RadarPanel'

const det = (over: Partial<VerdictDetector>): VerdictDetector => ({ ruleId: 'x', title: 'A check passes', state: 'ok', findings: [], ...over })

describe('recipeVerdict', () => {
  it('leads with the worst risk check and offers the fix-all prompt for dependency holes', () => {
    const v = recipeVerdict({
      detectors: [
        det({ ruleId: 'privacy_link', title: 'Privacy link works', state: 'finding', findings: [{ severity: 'warn', fix: 'Fix the link.' }] }),
        det({ ruleId: 'known_vulnerable_dependency', title: 'No known holes in your dependencies', state: 'finding', findings: [{ severity: 'error', fix: 'Upgrade next to 16.5.0.' }] }),
        det({ ruleId: 'domain', title: 'Domain renews', state: 'error' }),
        det({ ruleId: 'ok1', state: 'ok' }),
      ],
      holes: 15,
      behind: [],
    })
    expect(v.tone).toBe('danger')
    expect(v.sentence).toBe('3 risk checks need you. Start here: 15 dependencies have known security holes (and 2 more below).')
    expect(v.metrics.map((m) => [m.label, m.value])).toEqual([
      ['Risk checks not met', 2],
      ['Dependencies with holes', 15],
    ])
    expect(v.next).toEqual({ kind: 'fix-holes' })
  })

  it('offers the check prompt when the worst check has fixes, and a re-run when every problem could not finish', () => {
    expect(recipeVerdict({ detectors: [det({ ruleId: 'p', state: 'finding', findings: [{ severity: 'warn', fix: 'do it' }] })], holes: 0, behind: [] }).next).toEqual({ kind: 'fix-check', ruleId: 'p' })
    const rerun = recipeVerdict({ detectors: [det({ ruleId: 'd', title: 'Domain renews', state: 'error' })], holes: 0, behind: [] })
    expect(rerun.next).toEqual({ kind: 'rerun' })
    expect(rerun.tone).toBe('warn')
    expect(rerun.sentence).toContain('Domain renews could not be checked')
  })

  it('names the blueprint cards when no check found anything, and is never green without a result', () => {
    const behind = recipeVerdict({ detectors: [det({ state: 'ok' })], holes: 0, behind: [{ key: 'ci', label: 'CI builds' }] })
    expect(behind.sentence).toBe('No risk check found a problem, but CI builds needs a look.')
    expect(behind.next).toEqual({ kind: 'element', key: 'ci', label: 'CI builds' })
    const none = recipeVerdict({ detectors: [det({ state: 'unknown' })], holes: 0, behind: [] })
    expect(none.tone).toBe('neutral')
    expect(none.next).toEqual({ kind: 'run' })
    expect(recipeVerdict({ detectors: null, holes: 0, behind: [] }).tone).toBe('neutral')
    const ok = recipeVerdict({ detectors: [det({ state: 'ok' })], holes: 0, behind: [] })
    expect(ok.tone).toBe('ok')
    expect(ok.next).toBeNull()
    expect(ok.metrics).toEqual([])
  })
})

describe('rankProblems / problemPhrase', () => {
  it('puts serious findings first and checks that could not finish last', () => {
    const order = rankProblems([
      det({ ruleId: 'e', state: 'error' }),
      det({ ruleId: 'w', state: 'finding', findings: [{ severity: 'warn' }] }),
      det({ ruleId: 's', state: 'finding', findings: [{ severity: 'high' }] }),
    ]).map((d) => d.ruleId)
    expect(order).toEqual(['s', 'w', 'e'])
    expect(problemPhrase(det({ title: 'Store names match.', state: 'finding' }), 0)).toBe('not met: Store names match')
    expect(problemPhrase(det({ ruleId: 'known_vulnerable_dependency', state: 'finding' }), 1)).toBe('1 dependency has known security holes')
  })
})

describe('checkFixPrompt', () => {
  it('lists each finding with its place and fix', () => {
    const text = checkFixPrompt({
      title: 'Privacy link works',
      reason: '1 broken link.',
      findings: [{ id: 'f', severity: 'warn', message: 'The privacy link 404s', filePath: 'app/layout.tsx', line: 12, fix: 'Point it at /privacy.', target: null }],
    })
    expect(text).toContain('"Privacy link works" is not met: 1 broken link.')
    expect(text).toContain('- The privacy link 404s (app/layout.tsx:12)\n  Fix: Point it at /privacy.')
  })
})
