/**
 * The grouping behind the Apps tab (2026-11-18): the same per-app sentence across N apps is
 * ONE row with N apps; Fix once rows sort serious first, then by apps affected, with a short
 * problem title and one action word.
 */

import { describe, expect, it } from 'vitest'
import type { FindingGroup, PortfolioFindingsResponse } from './portfolioTypes'
import { clipWords, crossFindingAction, fixOnceRows, groupAcrossApps, groupHoles, groupSdkSkew, normaliseAppSentence, withoutApps } from './groupAppFindings'

type Cross = PortfolioFindingsResponse['crossProject'][number]

const NAMES: Record<string, string> = { yen: 'yen-yen', glot: 'glot.it', twm: 'twm', glotb: 'glot.it beta' }
const nameOf = (id: string) => NAMES[id] ?? id

const probe = (projectId: string, kind = 'app'): Cross => ({
  id: `recipe_incomplete:${projectId}`,
  ruleId: 'recipe_incomplete',
  severity: 'info',
  projectIds: [projectId],
  resourceKey: null,
  message: `${nameOf(projectId)} (${kind}) has no version probe.`,
  suggestedFix: kind === 'app' ? 'Publish a version.json with each build.' : 'Publish a version.json with each deploy.',
})

describe('normaliseAppSentence', () => {
  it('strips the finding’s own app name and its kind, and turns "has no X." into "No X"', () => {
    expect(normaliseAppSentence('yen-yen (app) has no version probe.', ['yen-yen'])).toBe('No version probe')
    // A dot in the name is literal, not "any character".
    expect(normaliseAppSentence('glot.it (site) has no security headers.', ['glot.it'])).toBe('No security headers')
    expect(normaliseAppSentence('glotXit (site) has no security headers.', ['glot.it'])).toBe('GlotXit (site) has no security headers')
    expect(normaliseAppSentence('glot.it: Pricing link has no campaign tag.', ['glot.it'])).toBe('Pricing link has no campaign tag')
  })

  it('keeps names that are not the finding’s own apps', () => {
    expect(normaliseAppSentence('glot.it shares credits with yen-yen, but bills apart.', ['glot.it'])).toBe('Shares credits with yen-yen, but bills apart')
  })

  it('strips the longest name first', () => {
    expect(normaliseAppSentence('glot.it beta (app) has no version probe.', ['glot.it', 'glot.it beta'])).toBe('No version probe')
  })
})

describe('groupAcrossApps', () => {
  it('turns the same finding text across apps into one row with every app', () => {
    const rows = groupAcrossApps([probe('yen'), probe('glot', 'site'), probe('twm')], nameOf)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'No version probe', action: 'Add probe', projectIds: ['yen', 'glot', 'twm'] })
    // The app and site fixes differ by one word: still one row, with a fix to copy.
    expect(rows[0]!.fix).toContain('No version probe')
  })

  it('keeps different findings apart and sorts serious first, then by apps affected', () => {
    const headers: Cross[] = ['yen', 'glot'].map((id) => ({ ...probe(id), id: `h:${id}`, message: `${nameOf(id)} (site) has no security headers.` }))
    const serious: Cross = { id: 's', ruleId: 'auth_redirect_missing', severity: 'error', projectIds: ['twm'], resourceKey: null, message: 'twm has a login redirect that is not allowed.', suggestedFix: null }
    const rows = groupAcrossApps([probe('yen'), ...headers, probe('glot'), probe('twm'), serious], nameOf)
    expect(rows.map((r) => [r.title, r.projectIds.length])).toEqual([
      ['Has a login redirect that is…', 1],
      ['No version probe', 3],
      ['No security headers', 2],
    ])
    expect(rows[2]!.action).toBe('Set headers')
    expect(rows[0]!.fix).toBeNull()
  })

  it('clips a long sentence to six words and keeps the whole one as detail', () => {
    const long: Cross = { ...probe('yen'), message: 'yen-yen uses a price that is not in the billing catalog anywhere.' }
    const [row] = groupAcrossApps([long], nameOf)
    expect(row!.title).toBe('Uses a price that is not…')
    expect(row!.detail).toBe('Uses a price that is not in the billing catalog anywhere')
    expect(clipWords('one two three')).toBe('one two three')
  })

  it('falls back to "Copy fix" for a rule it has no word for', () => {
    expect(crossFindingAction('something_new', 'Odd problem')).toBe('Copy fix')
    expect(crossFindingAction('key_shared_across_apps', 'One key')).toBe('Split keys')
  })
})

describe('groupHoles and groupSdkSkew', () => {
  it('lists a missing integration once, with every app that lacks it', () => {
    const rows = groupHoles([
      { projectId: 'yen', integration: 'sentry', siblingsWith: 3, reason: '3 of your other 4 projects use Sentry; this one does not.' },
      { projectId: 'twm', integration: 'sentry', siblingsWith: 3, reason: '3 of your other 4 projects use Sentry; this one does not.' },
      { projectId: 'twm', integration: 'slack', siblingsWith: 2, reason: '2 of your other 4 projects use Slack; this one does not.' },
    ])
    expect(rows.map((r) => [r.title, r.projectIds])).toEqual([['No Sentry', ['yen', 'twm']], ['No Slack', ['twm']]])
  })

  it('groups SDK skew by package and target, never listing current apps', () => {
    const rows = groupSdkSkew([
      { projectId: 'yen', package: '@mushi-mushi/web', version: '1.30.0', latest: '1.33.0', status: 'behind', reason: 'On 1.30.0; 1.33.0 is out.' },
      { projectId: 'glot', package: '@mushi-mushi/web', version: '1.31.0', latest: '1.33.0', status: 'behind', reason: 'On 1.31.0; 1.33.0 is out.' },
      { projectId: 'twm', package: '@mushi-mushi/web', version: '1.33.0', latest: '1.33.0', status: 'current', reason: 'On the latest version (1.33.0).' },
      { projectId: 'twm', package: null, version: null, latest: null, status: 'unknown', reason: 'No Mushi SDK has reported from this project yet.' },
    ])
    expect(rows.map((r) => [r.pkg, r.title, r.apps.map((a) => a.projectId)])).toEqual([
      ['@mushi-mushi/web', 'Behind → 1.33.0', ['yen', 'glot']],
      [null, 'No Mushi SDK has reported from…', ['twm']],
    ])
  })
})

describe('fixOnceRows', () => {
  const group = (over: Partial<FindingGroup>): FindingGroup => ({
    ruleId: 'x', title: null, gate: 'radar', gateLabel: 'Mushi setup check', severity: 'warn', projectIds: [], findingCount: 1, sampleMessage: '', suggestedFix: 'prompt', ...over,
  })

  it('sorts serious first, then by apps, with a problem title and one action', () => {
    const rows = fixOnceRows(
      [
        group({ ruleId: 'spend_cap_unset', projectIds: ['a', 'b', 'c'] }),
        group({ ruleId: 'byok_key_invalid', severity: 'error', projectIds: ['a', 'b'] }),
        group({ ruleId: 'index_stale', projectIds: ['a', 'b', 'c', 'd'] }),
        group({ ruleId: 'security_headers_missing', title: 'Security headers set', gate: 'portfolio_radar', projectIds: ['a', 'b'] }),
      ],
      (g) => g.title ?? g.sampleMessage,
    )
    expect(rows.map((r) => [r.ruleId, r.title, r.action])).toEqual([
      ['byok_key_invalid', 'AI key rejected', 'Fix key'],
      ['index_stale', 'Code index out of date', 'Re-index'],
      ['spend_cap_unset', 'No AI spend limit', 'Set budget'],
      // The catalog title reads as a pass; the row names the problem.
      ['security_headers_missing', 'Security headers missing', 'Set headers'],
    ])
  })

  it('an unknown rule takes its gate’s action and a six-word clip of its title', () => {
    const [row] = fixOnceRows([group({ ruleId: 'workflow_no_timeout', gate: 'ci_drift', sampleMessage: 'The deploy workflow has no timeout on its build job, so a hang bills.' })], (g) => g.sampleMessage)
    expect(row).toMatchObject({ title: 'The deploy workflow has no timeout…', action: 'Fix CI', explanation: 'The deploy workflow has no timeout on its build job, so a hang bills.' })
  })
})

describe('withoutApps (the public demo, keep-but-hide)', () => {
  const g = (ruleId: string, projectIds: string[]): FindingGroup => ({
    ruleId, title: null, gate: 'radar', gateLabel: null, severity: 'warn', projectIds, findingCount: projectIds.length, sampleMessage: '', suggestedFix: '',
  })
  const data: PortfolioFindingsResponse = {
    organizationId: 'o',
    generatedAt: '',
    groups: [g('spend_cap_unset', ['yen', 'glot', 'demo']), g('index_stale', ['glot', 'demo'])],
    crossProject: [probe('yen'), { ...probe('glot'), id: 'x', projectIds: ['demo'] }],
    sdkSkew: [
      { projectId: 'demo', package: null, version: null, latest: null, status: 'unknown', reason: 'No Mushi SDK has reported from this project yet.' },
      { projectId: 'yen', package: '@mushi-mushi/web', version: '1.0.0', latest: '1.1.0', status: 'behind', reason: '' },
    ],
    holes: [
      { projectId: 'demo', integration: 'supabase', siblingsWith: 3, reason: '' },
      { projectId: 'glot', integration: 'supabase', siblingsWith: 3, reason: '' },
    ],
    readErrors: [],
  }

  it('drops the hidden app from every per-app list, and a Fix once group left in one app', () => {
    const out = withoutApps(data, new Set(['demo']))
    expect(out.groups.map((x) => [x.ruleId, x.projectIds])).toEqual([['spend_cap_unset', ['yen', 'glot']]])
    expect(out.crossProject.map((f) => f.projectIds)).toEqual([['yen']])
    expect(out.sdkSkew.map((e) => e.projectId)).toEqual(['yen'])
    expect(out.holes.map((h) => h.projectId)).toEqual(['glot'])
  })

  it('returns the data as it is when nothing is hidden', () => {
    expect(withoutApps(data, new Set())).toBe(data)
  })
})
