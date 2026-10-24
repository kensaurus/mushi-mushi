// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { isRequestAllowed } from './guard.js'
import {
  AUDIT_DEFAULT_ALLOW,
  auditMarker,
  blankScreenFinding,
  blockedSummary,
  dropGuardErrors,
  filedRecently,
  findingsFromProbes,
  fingerprintOf,
  groupSharedCauses,
  mergeFindings,
  pagePath,
  pickScreens,
  reportBodyFor,
  screenName,
  visualFindingsFrom,
} from './audit.js'
import type { ProbeResult } from './types.js'

const screen = { key: 'reports', path: '/mushi-mushi/admin/reports', label: 'Bugs' }
const desktop = { name: 'desktop' as const, width: 1440, height: 900 }
const mobile = { name: 'mobile' as const, width: 390, height: 844 }
const clean: ProbeResult = { axe: [], overflowX: false, smallTargets: 0, consoleErrors: [], cls: 0 }

describe('findingsFromProbes', () => {
  it('finds nothing on a clean screen', () => {
    expect(findingsFromProbes(screen, desktop, clean)).toEqual([])
  })

  it('keeps serious and critical axe rules only, and names the rule and elements', () => {
    const out = findingsFromProbes(screen, desktop, {
      ...clean,
      axe: [
        { id: 'color-contrast', impact: 'serious', help: 'Elements must meet contrast', count: 3, targets: ['.chip', '.tab'] },
        { id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', count: 1, targets: ['#more'] },
        { id: 'region', impact: 'moderate', help: 'Content in landmarks', count: 9, targets: [] },
      ],
    })
    expect(out.map((f) => [f.rule, f.severity])).toEqual([
      ['color-contrast', 'medium'],
      ['button-name', 'high'],
    ])
    expect(out[0].evidence[0]).toContain('.chip | .tab')
    expect(out[0].doneWhen).toContain('color-contrast')
  })

  it('reports sideways scrolling, console errors and layout shift past the good line', () => {
    const out = findingsFromProbes(screen, mobile, {
      ...clean,
      overflowX: true,
      consoleErrors: ['TypeError: x is undefined', 'TypeError: x is undefined'],
      cls: 0.31,
    })
    expect(out.map((f) => f.rule)).toEqual(['horizontal-overflow', 'console-error', 'layout-shift'])
    expect(out[1].summary).toBe('1 console error while the screen loads')
    expect(out[2].severity).toBe('medium')
    expect(findingsFromProbes(screen, mobile, { ...clean, cls: 0.12 })[0].severity).toBe('low')
  })
})

describe('mergeFindings and fingerprints', () => {
  it('folds the same rule on the same screen across viewports into one finding', () => {
    const a = findingsFromProbes(screen, desktop, { ...clean, overflowX: true })
    const b = findingsFromProbes(screen, mobile, { ...clean, overflowX: true })
    const merged = mergeFindings([...a, ...b])
    expect(merged).toHaveLength(1)
    expect(merged[0].viewports).toEqual(['desktop', 'mobile'])
    expect(merged[0].evidence).toHaveLength(2)
  })

  it('is one finding per page and rule: a dialog on the page and another query string are the same page', () => {
    const page = findingsFromProbes({ key: 'p', path: '/a/reports?project=1', label: 'Bugs · app · 95 reports' }, desktop, { ...clean, cls: 0.4 })
    const dialog = findingsFromProbes({ key: 'p-fix', path: '/a/reports?project=2', label: 'Bugs · app · 95 reports › Fix →' }, desktop, { ...clean, cls: 0.3 })
    const merged = mergeFindings([...page, ...dialog])
    expect(merged).toHaveLength(1)
    expect(merged[0].screen).toBe('Bugs')
  })

  it('names a screen without the counts in its title, keeping the clicks that reached it', () => {
    expect(screenName('Bugs · solo-boss-cloud · 95 reports · 1 critical')).toBe('Bugs')
    expect(screenName('Bugs · solo-boss-cloud · 95 reports › Fix →')).toBe('Bugs › Fix →')
    expect(pagePath('/a/reports?apps=all#x')).toBe('/a/reports')
  })

  it('is stable per (screen, kind, rule) and differs across screens', () => {
    expect(fingerprintOf(screen, 'axe', 'color-contrast')).toBe(fingerprintOf(screen, 'axe', 'color-contrast'))
    expect(fingerprintOf(screen, 'axe', 'color-contrast')).not.toBe(fingerprintOf({ path: '/x/fixes' }, 'axe', 'color-contrast'))
    expect(fingerprintOf(screen, 'axe', 'color-contrast')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('skips a fingerprint filed in the last 14 days, not an older one', () => {
    const now = new Date('2026-10-24T12:00:00Z')
    expect(filedRecently({ abc: '2026-10-20T00:00:00Z' }, 'abc', now)).toBe(true)
    expect(filedRecently({ abc: '2026-10-01T00:00:00Z' }, 'abc', now)).toBe(false)
    expect(filedRecently({}, 'abc', now)).toBe(false)
  })
})

describe('groupSharedCauses', () => {
  const contrast = (path: string, label: string, target: string) =>
    findingsFromProbes({ key: path, path, label }, desktop, {
      ...clean,
      axe: [{ id: 'color-contrast', impact: 'serious', help: 'Elements must meet contrast', count: 1, targets: [target] }],
    })

  it('files one finding for the same rule on the same element across pages', () => {
    const out = groupSharedCauses([
      ...contrast('/admin/reports', 'Bugs', '.text-danger'),
      ...contrast('/admin/fixes', 'Fixes', '.text-danger'),
      ...contrast('/admin/team', 'Team', '.chip'),
    ])
    expect(out).toHaveLength(2)
    const shared = out.find((f) => f.screen === '2 screens')!
    expect(shared.summary).toContain('`.text-danger`')
    expect(shared.summary).toContain('Fixes, Bugs')
    expect(shared.evidence.join('\n')).toContain('Bugs (/admin/reports)')
    expect(shared.fingerprint).not.toBe(fingerprintOf({ path: '/admin/fixes' }, 'axe', 'color-contrast'))
    expect(out.find((f) => f.screen === 'Team')?.fingerprint).toBe(fingerprintOf({ path: '/admin/team' }, 'axe', 'color-contrast'))
  })

  it('leaves a rule seen on one page alone', () => {
    const one = contrast('/admin/reports', 'Bugs', '.text-danger')
    expect(groupSharedCauses(one)).toEqual(one)
  })
})

describe('guard side effects', () => {
  it('drops "Failed to fetch" only when the guard blocked a request during that capture', () => {
    const probes = { ...clean, consoleErrors: ['TypeError: Failed to fetch (api.example.com)', 'TypeError: x is undefined'] }
    expect(dropGuardErrors(probes, true).consoleErrors).toEqual(['TypeError: x is undefined'])
    expect(dropGuardErrors(probes, false).consoleErrors).toHaveLength(2)
  })

  it('lets a Supabase session refresh through by default, nothing else', () => {
    expect(isRequestAllowed('POST', 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token', [...AUDIT_DEFAULT_ALLOW])).toBe(true)
    expect(isRequestAllowed('POST', 'https://x.supabase.co/auth/v1/token?grant_type=password', [...AUDIT_DEFAULT_ALLOW])).toBe(false)
    expect(isRequestAllowed('POST', 'https://x.supabase.co/rest/v1/reports', [...AUDIT_DEFAULT_ALLOW])).toBe(false)
  })

  it('counts blocked requests by method and path, query dropped', () => {
    expect(
      blockedSummary([
        { method: 'post', url: 'https://x.co/auth/v1/token?grant_type=refresh_token' },
        { method: 'POST', url: 'https://x.co/auth/v1/token?a=1' },
        { method: 'PATCH', url: 'https://x.co/rest/v1/reports?id=eq.1' },
      ]),
    ).toEqual([
      { request: 'POST /auth/v1/token', count: 2 },
      { request: 'PATCH /rest/v1/reports', count: 1 },
    ])
  })
})

describe('blankScreenFinding', () => {
  it('files a screen that settled with nothing drawn as high, and leaves a drawn one alone', () => {
    const [f] = blankScreenFinding(screen, desktop, 0.0001)
    expect([f.rule, f.severity, f.summary]).toEqual(['blank-screen', 'high', 'The screen loads blank'])
    expect(blankScreenFinding(screen, desktop, 0.2)).toEqual([])
  })
})

describe('pickScreens', () => {
  it('takes every page before any tab or dialog, up to the cap', () => {
    const list = [
      { kind: 'page' as const, key: 'a' },
      { kind: 'dialog' as const, key: 'a-d' },
      { kind: 'page' as const, key: 'b' },
      { kind: 'tab' as const, key: 'b-t' },
    ]
    expect(pickScreens(list, 3).map((s) => s.key)).toEqual(['a', 'b', 'a-d'])
    expect(pickScreens(list, 0).map((s) => s.key)).toEqual(['a'])
  })
})

describe('reportBodyFor', () => {
  it('builds a report with the page, viewports, evidence, expected, done-when and the dedupe marker', () => {
    const [f] = mergeFindings([
      ...findingsFromProbes(screen, desktop, { ...clean, overflowX: true }),
      ...findingsFromProbes(screen, mobile, { ...clean, overflowX: true }),
    ])
    const body = reportBodyFor(f, 'https://kensaur.us/mushi-mushi/admin')
    expect(body.title).toBe('Bugs: The page scrolls sideways at 1440px wide')
    expect(body.description).toContain('Page: https://kensaur.us/mushi-mushi/admin/reports')
    expect(body.description).toContain('desktop 1440x900, phone 390x844')
    expect(body.description).toContain('Done when:')
    expect(body.description).toContain(auditMarker(f.fingerprint))
    expect(body.component).toBe('/mushi-mushi/admin/reports')
    expect(body.severity).toBe('medium')
  })
})

describe('visualFindingsFrom', () => {
  it('keeps concrete defects with an element and a done-when, drops taste notes and unknown kinds', () => {
    const answer = `Here you go: {"defects":[
      {"kind":"overlap","viewport":"mobile","element":"Release pill","where":"header right","problem":"overlaps the bell icon","severity":"medium","done_when":"The pill and the bell do not overlap at 390px"},
      {"kind":"layout","viewport":"both","element":"KPI tiles","where":"top","problem":"could be a bit more balanced","severity":"low","done_when":"Balanced"},
      {"kind":"vibes","viewport":"desktop","element":"Page","where":"all","problem":"bad","severity":"high","done_when":"Good"},
      {"kind":"clipping","viewport":"desktop","element":"Table","where":"","problem":"","severity":"low","done_when":"x"}
    ]}`
    const out = visualFindingsFrom(answer, screen)
    expect(out).toHaveLength(1)
    expect(out[0].rule).toBe('overlap:release-pill')
    expect(out[0].viewports).toEqual(['mobile'])
    expect(out[0].doneWhen).toBe('The pill and the bell do not overlap at 390px')
  })

  it('reads no findings from an empty, malformed or missing answer', () => {
    expect(visualFindingsFrom('{"defects":[]}', screen)).toEqual([])
    expect(visualFindingsFrom('not json', screen)).toEqual([])
    expect(visualFindingsFrom(null, screen)).toEqual([])
  })
})
