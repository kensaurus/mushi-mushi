/**
 * `_shared/portfolio.ts` — the pure portfolio rules (Plan 019 Phase P1):
 * semver "latest" per package, SDK skew per package (never across packages),
 * repeated-finding groups, integration holes and the inferred kind.
 */
import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  groupRepeatedFindings,
  inferKind,
  integrationHoles,
  latestSdkVersions,
  mapBounded,
  sdkSkew,
  type IntegrationKey,
} from '../../supabase/functions/_shared/portfolio.ts'

describe('semver', () => {
  it('orders numerically, not as strings, and puts a pre-release below its release', () => {
    expect(compareSemver('1.10.0', '1.9.3')).toBeGreaterThan(0)
    expect(compareSemver('1.29.0-beta.1', '1.29.0')).toBeLessThan(0)
    expect(compareSemver('v2.0', '2.0.0')).toBe(0)
    expect(compareSemver('not-a-version', '0.0.1')).toBeLessThan(0)
  })

  it('latest is the highest non-deprecated stable version per package, not the newest row', () => {
    const latest = latestSdkVersions([
      { package: '@mushi-mushi/web', version: '1.29.0', deprecated: false },
      { package: '@mushi-mushi/web', version: '1.9.9', deprecated: false },
      { package: '@mushi-mushi/web', version: '1.30.0', deprecated: true },
      { package: '@mushi-mushi/web', version: '1.31.0-beta.0', deprecated: false },
      { package: '@mushi-mushi/react-native', version: '0.21.0', deprecated: null },
    ])
    expect(latest.get('@mushi-mushi/web')).toBe('1.29.0')
    expect(latest.get('@mushi-mushi/react-native')).toBe('0.21.0')
  })
})

describe('sdkSkew', () => {
  const latest = new Map([['@mushi-mushi/web', '1.29.0'], ['@mushi-mushi/react-native', '0.21.0']])

  it('compares each package to its own latest and marks a project with no observation unknown', () => {
    const out = sdkSkew(['p1', 'p2', 'demo'], [
      { project_id: 'p1', sdk_package: '@mushi-mushi/web', sdk_version: '1.28.2' },
      { project_id: 'p1', sdk_package: '@mushi-mushi/react-native', sdk_version: '0.21.0' },
      { project_id: 'p2', sdk_package: '@mushi-mushi/web', sdk_version: '1.29.0' },
    ], latest)
    expect(out.filter((e) => e.projectId === 'p1').map((e) => [e.package, e.status])).toEqual([
      ['@mushi-mushi/web', 'behind'],
      ['@mushi-mushi/react-native', 'current'],
    ])
    expect(out.find((e) => e.projectId === 'p2')?.status).toBe('current')
    const demo = out.filter((e) => e.projectId === 'demo')
    expect(demo).toHaveLength(1)
    expect(demo[0]).toMatchObject({ package: null, status: 'unknown' })
  })

  it('never reports current for an unreadable version or a package missing from the catalog', () => {
    const out = sdkSkew(['p'], [
      { project_id: 'p', sdk_package: '@mushi-mushi/web', sdk_version: null },
      { project_id: 'p', sdk_package: '@mushi-mushi/vue', sdk_version: '1.0.0' },
    ], latest)
    expect(out.map((e) => e.status)).toEqual(['unknown', 'unknown'])
  })
})

describe('groupRepeatedFindings', () => {
  it('groups a rule open in 2+ projects, keeps the highest severity, and leaves out info and single-project rules', () => {
    const groups = groupRepeatedFindings([
      { project_id: 'a', gate: 'code_health', rule_id: 'god_file', severity: 'warn', message: 'a big' },
      { project_id: 'b', gate: 'code_health', rule_id: 'god_file', severity: 'error', message: 'b huge' },
      { project_id: 'b', gate: 'code_health', rule_id: 'god_file', severity: 'warn', message: 'b big' },
      { project_id: 'a', gate: 'crawl', rule_id: 'crawl-missing-in-app', severity: 'warn', message: 'x' },
      { project_id: 'a', gate: 'design_drift', rule_id: 'token_nonconformant', severity: 'info', message: 'i' },
      { project_id: 'b', gate: 'design_drift', rule_id: 'token_nonconformant', severity: 'info', message: 'i' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ ruleId: 'god_file', severity: 'error', projectIds: ['a', 'b'], findingCount: 3, sampleMessage: 'b huge' })
    expect(groups[0].suggestedFix).toContain('code_health')
  })

  it('returns an empty list, not an error, when nothing repeats', () => {
    expect(groupRepeatedFindings([])).toEqual([])
  })
})

describe('integrationHoles', () => {
  const p = (...k: IntegrationKey[]) => new Set<IntegrationKey>(k)

  it('flags a project missing what most of its siblings have', () => {
    const holes = integrationHoles(new Map([
      ['a', p('sentry', 'github')],
      ['b', p('sentry', 'github')],
      ['c', p('sentry', 'github', 'linear')],
      ['d', p('github')],
    ]))
    expect(holes.map((h) => [h.projectId, h.integration])).toEqual([['d', 'sentry']])
    expect(holes[0].siblingsWith).toBe(3)
  })

  it('does not flag when only one sibling has it', () => {
    expect(integrationHoles(new Map([['a', p('linear')], ['b', p()], ['c', p()]]))).toEqual([])
  })
})

describe('inferKind', () => {
  it('prefers the declared kind, then a native SDK, then any SDK; nothing observed is unknown', () => {
    expect(inferKind('library', ['@mushi-mushi/react-native'])).toEqual({ kind: 'library', source: 'declared' })
    expect(inferKind(undefined, ['@mushi-mushi/react-native'])).toEqual({ kind: 'app', source: 'inferred' })
    expect(inferKind('bogus', ['@mushi-mushi/web'])).toEqual({ kind: 'site', source: 'inferred' })
    expect(inferKind(null, [])).toEqual({ kind: null, source: 'unknown' })
  })
})

describe('mapBounded', () => {
  it('keeps input order and never runs more than the limit at once', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapBounded([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, n))
      inFlight--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBeLessThanOrEqual(2)
  })
})
