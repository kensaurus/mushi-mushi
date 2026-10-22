/**
 * FILE: modernization-dispatch.test.ts
 * PURPOSE: Modernization findings can be dispatched without a pre-made
 *          report (2026-10-22: 214 pending findings, 18 with a report):
 *            - the bump size decides what may be grouped (0.x minor is major);
 *            - LLM-made-up versions ("10.x latest", downgrades) are refused;
 *            - the report names the package, from → to, the changelog and
 *              "build + typecheck + tests pass";
 *            - minor / patch findings of one repo go as one report;
 *            - findings whose report was fixed become `resolved`, once.
 */

import { describe, expect, it } from 'vitest'
import {
  ACCEPTANCE_CHECK,
  buildFindingReport,
  buildGroupReport,
  classifyBump,
  findingsToResolve,
  isGroupableBump,
  repoLabel,
  selectMinorGroup,
  shadowedByGroup,
  targetVersion,
  type ModernizationFindingRow,
} from '../../supabase/functions/_shared/modernization-dispatch.ts'

const P = 'p1'
const R = 'repo1'

function finding(over: Partial<ModernizationFindingRow> = {}): ModernizationFindingRow {
  return {
    id: 'f1',
    project_id: P,
    repo_id: R,
    dep_name: 'left-pad',
    current_version: '^1.2.0',
    suggested_version: '1.3.0',
    manifest_path: 'package.json',
    summary: 'Fixes padding of emoji.',
    severity: 'minor',
    changelog_url: 'https://github.com/o/left-pad/releases',
    related_report_id: null,
    status: 'pending',
    ...over,
  }
}

describe('classifyBump', () => {
  it.each([
    ['^8.1.0', '8.4.0', 'minor'],
    ['^5.2.14', '^5.3.0', 'minor'],
    ['~19.2.8', '19.2.9', 'patch'],
    ['^8.21.3', '9.2.5', 'major'],
    ['^0.4.2', '0.4.3', 'patch'],
    ['^0.2.0', '1.6.0', 'major'],
    ['^0.4.2', '0.5.0', 'major'],
    ['^10.45.0', '10.45.0', 'not_upgrade'],
    ['^15.0.2', '^14.0.4', 'not_upgrade'],
    ['^10.45.0', '10.x latest', 'unknown'],
    ['10.43.0', '9.x (latest 9.x stable)', 'unknown'],
    ['workspace:*', '1.0.0', 'unknown'],
    ['^1.0.0', '2.0.0-beta.1', 'unknown'],
    [null, '1.0.0', 'unknown'],
  ])('%s → %s is %s', (from, to, kind) => {
    expect(classifyBump(from, to)).toBe(kind)
  })

  it('only minor and patch are groupable', () => {
    expect(isGroupableBump('minor')).toBe(true)
    expect(isGroupableBump('patch')).toBe(true)
    expect(isGroupableBump('major')).toBe(false)
    expect(isGroupableBump('unknown')).toBe(false)
    expect(isGroupableBump('not_upgrade')).toBe(false)
  })
})

describe('report text', () => {
  it('names the package, from → to, manifest, changelog, notes and the acceptance check', () => {
    const r = buildFindingReport(finding({ suggested_version: '^1.3.0' }), 'kensaurus/glot.it')
    expect(r.summary).toBe('Update left-pad from ^1.2.0 to 1.3.0')
    expect(r.description).toContain('left-pad in kensaurus/glot.it (package.json) from ^1.2.0 to 1.3.0')
    expect(r.description).toContain('a minor update')
    expect(r.description).toContain('Fixes padding of emoji.')
    expect(r.description).toContain('https://github.com/o/left-pad/releases')
    expect(r.description).toContain(`Done when: ${ACCEPTANCE_CHECK}.`)
    expect(ACCEPTANCE_CHECK).toBe('build + typecheck + tests pass')
    expect(r.severity).toBe('low')
    expect(r.environment).toMatchObject({ dispatch: 'single', findingId: 'f1' })
  })

  it('a major bump warns about breaking changes; security is high severity', () => {
    const r = buildFindingReport(finding({ suggested_version: '2.0.0', severity: 'security' }), 'o/r')
    expect(r.description).toContain('major update (it may have breaking changes)')
    expect(r.severity).toBe('high')
  })

  it('the group report lists every package and says how many', () => {
    const g = [finding(), finding({ id: 'f2', dep_name: 'react-dom', current_version: '~19.2.8', suggested_version: '19.2.9', changelog_url: null })]
    const r = buildGroupReport(g, 'o/app')
    expect(r.summary).toBe('Bump 2 minor dependencies in o/app')
    expect(r.description).toContain('- left-pad in package.json: ^1.2.0 → 1.3.0 (changelog: https://github.com/o/left-pad/releases)')
    expect(r.description).toContain('- react-dom in package.json: ~19.2.8 → 19.2.9')
    expect(r.description).toContain(`Done when: ${ACCEPTANCE_CHECK}.`)
    expect(r.environment).toMatchObject({ dispatch: 'group_minor', findingIds: ['f1', 'f2'] })
    expect(buildGroupReport([finding()], 'o/app').summary).toBe('Bump 1 minor dependency in o/app')
  })

  it('repo labels and target versions', () => {
    expect(repoLabel('https://github.com/kensaurus/glot.it')).toBe('kensaurus/glot.it')
    expect(repoLabel('https://github.com/kensaurus/glot.it.git')).toBe('kensaurus/glot.it')
    expect(repoLabel(null)).toBe('this repository')
    expect(targetVersion('^5.3.0')).toBe('5.3.0')
    expect(targetVersion('v1.0.0')).toBe('1.0.0')
  })
})

describe('selectMinorGroup', () => {
  const rows = [
    finding({ id: 'a', dep_name: 'zod', current_version: '^3.22.0', suggested_version: '3.25.0' }),
    finding({ id: 'b', dep_name: 'react', current_version: '^18.2.0', suggested_version: '19.0.0' }), // major
    finding({ id: 'c', dep_name: 'hono', current_version: '^4.1.0', suggested_version: '4.13.7' }),
    finding({ id: 'd', dep_name: 'hono', current_version: '^4.1.0', suggested_version: '4.5.0' }), // lower target, same package
    finding({ id: 'e', dep_name: 'vite', current_version: '^6.0.0', suggested_version: '6.1.0', repo_id: 'other' }),
    finding({ id: 'f', dep_name: 'yaml', current_version: '^2.0.0', suggested_version: '2.9.0', related_report_id: 'rep' }),
    finding({ id: 'g', dep_name: 'tslib', current_version: '^2.0.0', suggested_version: '2.8.0', status: 'dismissed' }),
    finding({ id: 'h', dep_name: 'sentry', current_version: '^10.45.0', suggested_version: '10.x latest' }),
    finding({ id: 'i', dep_name: 'other-app', current_version: '^1.0.0', suggested_version: '1.1.0', project_id: 'p2' }),
  ]

  it('takes pending, unlinked minor/patch bumps of the same repo, one per package, sorted', () => {
    const group = selectMinorGroup({ project_id: P, repo_id: R }, rows)
    expect(group.map((f) => f.id)).toEqual(['c', 'a'])
    expect(group.find((f) => f.dep_name === 'hono')?.suggested_version).toBe('4.13.7')
  })

  it('the lower-target duplicate rides along on the same report', () => {
    const group = selectMinorGroup({ project_id: P, repo_id: R }, rows)
    expect(shadowedByGroup(group, rows)).toEqual(['d'])
    expect(shadowedByGroup([], rows)).toEqual([])
  })

  it('caps the group size', () => {
    const many = Array.from({ length: 30 }, (_, i) => finding({ id: `m${i}`, dep_name: `pkg-${String(i).padStart(2, '0')}` }))
    expect(selectMinorGroup({ project_id: P, repo_id: R }, many)).toHaveLength(25)
    expect(selectMinorGroup({ project_id: P, repo_id: R }, many, 3).map((f) => f.dep_name)).toEqual(['pkg-00', 'pkg-01', 'pkg-02'])
  })
})

describe('findingsToResolve', () => {
  it('open findings whose report is fixed, resolved or verified; idempotent', () => {
    const status = new Map([
      ['r-fixed', 'fixed'],
      ['r-verified', 'verified'],
      ['r-resolved', 'resolved'],
      ['r-fixing', 'fixing'],
      ['r-dismissed', 'dismissed'],
    ])
    const rows = [
      { id: '1', status: 'pending', related_report_id: 'r-fixed' },
      { id: '2', status: 'dispatched', related_report_id: 'r-verified' },
      { id: '3', status: 'pending', related_report_id: 'r-resolved' },
      { id: '4', status: 'pending', related_report_id: 'r-fixing' },
      { id: '5', status: 'pending', related_report_id: 'r-dismissed' },
      { id: '6', status: 'pending', related_report_id: null },
      { id: '7', status: 'resolved', related_report_id: 'r-fixed' },
      { id: '8', status: 'dismissed', related_report_id: 'r-fixed' },
      { id: '9', status: 'pending', related_report_id: 'r-missing' },
    ]
    expect(findingsToResolve(rows, status)).toEqual(['1', '2', '3'])
    const after = rows.map((r) => (['1', '2', '3'].includes(r.id) ? { ...r, status: 'resolved' } : r))
    expect(findingsToResolve(after, status)).toEqual([])
  })
})
