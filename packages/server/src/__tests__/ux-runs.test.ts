/**
 * FILE: ux-runs.test.ts
 * PURPOSE: Plan 021 console mirror of `mushi-ux` runs — storage paths stay
 *          inside the caller's project and run, and "File as bug" files a
 *          pre-classified ux_loop report without any LLM call.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildUxLoopReport,
  countStatuses,
  uxCapturePath,
  uxShotPaths,
  type UxSurfaceForReport,
} from '../../supabase/functions/_shared/ux-runs.ts'

const P = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const R = '11111111-2222-4333-8444-555555555555'

describe('uxShotPaths', () => {
  it('maps slots to paths in this screen’s folder only', () => {
    expect(uxShotPaths(P, R, 'home-1a', { 'before-mobile': 'home-1a/before-mobile.png', 'after-desktop': 'other-2b/after-desktop.png', 'iter1-after-mobile': 'home-1a/iter1-after-mobile.png' }, 'surface')).toEqual({ 'before-mobile': `${P}/${R}/home-1a/before-mobile.png` })
    expect(uxShotPaths(P, R, 'home-1a', { 'after-mobile': 'home-1a/iter2-after-mobile.png', 'before-mobile': 'home-1a/before-mobile.png' }, 'iteration')).toEqual({ 'after-mobile': `${P}/${R}/home-1a/iter2-after-mobile.png` })
    expect(uxCapturePath(P, R, 'home-1a/iter21-after-mobile.png')).toBeNull()
  })
})

describe('uxCapturePath', () => {
  it('builds paths under <project>/<run>/ for well-formed names only', () => {
    expect(uxCapturePath(P, R, 'settings-ab12cd/before-desktop.png')).toBe(`${P}/${R}/settings-ab12cd/before-desktop.png`)
    expect(uxCapturePath(P, R, 'root-42099b/diff-mobile.png')).toBe(`${P}/${R}/root-42099b/diff-mobile.png`)
  })

  it.each([
    '../other-project/x/before-desktop.png',
    'settings/../../x/before-desktop.png',
    'settings-ab12cd/before-desktop.svg',
    'settings-ab12cd/notes.png',
    '/abs/before-desktop.png',
    'Settings/before-desktop.png',
  ])('refuses %s', (name) => expect(uxCapturePath(P, R, name)).toBeNull())
})

const surface = (over: Partial<UxSurfaceForReport> = {}): UxSurfaceForReport => ({
  surface_key: 'settings-ab12cd',
  kind: 'tab',
  path: '/settings?tab=keys',
  label: 'Settings › AI keys',
  status: 'reverted',
  note: 'Rolled back: mobile: the page now scrolls sideways.',
  penalty_before: 12,
  penalty_after: null,
  probe_before: {
    axe: [{ id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast', count: 3 }],
    overflowX: false,
    smallTargets: 2,
    consoleErrors: 0,
    cls: 0,
  },
  probe_after: null,
  judge: null,
  ...over,
})

describe('buildUxLoopReport', () => {
  it('files a pre-classified visual report with the measured problems, never touching a model', () => {
    const r = buildUxLoopReport(P, R, surface(), new Date('2026-10-06T00:00:00Z'))
    expect(r).toMatchObject({
      project_id: P,
      source: 'ux_loop',
      category: 'visual',
      status: 'classified',
      severity: 'medium',
      reporter_token_hash: 'ux-loop',
      summary: '2 UX problems on "Settings › AI keys"',
    })
    const text = String(r.description)
    expect(text).toContain('Screen: /settings?tab=keys (tab)')
    expect(text).toContain('color-contrast, serious, 3 elements')
    expect(text).toContain('2 tap target(s)')
    expect(text).toContain('Problem score: 12')
    expect(r.environment).toMatchObject({ uxRunId: R, surfaceKey: 'settings-ab12cd' })
  })

  it('describes a screen another fix moved, and keeps reviewer notes', () => {
    const r = buildUxLoopReport(
      P,
      R,
      surface({
        status: 'regressed',
        probe_before: { axe: [], overflowX: false, smallTargets: 0, consoleErrors: 0, cls: 0 },
        judge: [{ viewport: 'desktop', preferred: 'before', confidence: 'high', summary: 's', worse: [{ what: 'CTA lost', why: 'grey on grey' }] }],
      }),
      new Date(),
    )
    expect(r.summary).toBe('"Settings › AI keys" changed after another screen\'s fix')
    expect(r.severity).toBe('low')
    expect(String(r.description)).toContain('[desktop] CTA lost: grey on grey')
  })
})

describe('countStatuses', () => {
  it('counts each status', () => {
    expect(countStatuses(['accepted', 'accepted', 'regressed'])).toEqual({ accepted: 2, regressed: 1 })
  })
})

describe('migrations', () => {
  const dir = resolve(__dirname, '../../supabase/migrations')
  it('keep groups inside one organization and add ux_loop to reports.source without restating it', () => {
    const groups = readFileSync(resolve(dir, '20261006100000_project_groups.sql'), 'utf8')
    expect(groups).toMatch(/foreign key \(project_id, organization_id\)\s+references public\.projects \(id, organization_id\)/)
    expect(groups).toMatch(/revoke all on table public\.project_groups, public\.project_group_members from anon/)
    const source = readFileSync(resolve(dir, '20261006100200_reports_source_ux_loop.sql'), 'utf8')
    expect(source).toContain("v_add  text[] := ARRAY['ux_loop']")
    expect(source).not.toMatch(/CHECK \(source IN \('api'/)
    const runs = readFileSync(resolve(dir, '20261006100100_ux_runs.sql'), 'utf8')
    expect(runs).toMatch(/'ux-captures', 'ux-captures', false/)
  })
})
