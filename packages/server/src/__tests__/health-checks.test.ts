/**
 * FILE: health-checks.test.ts
 * PURPOSE: The Health check registry (plan-simplicity-2026-10 Phase 1, unit A):
 *            - every existing checker's line maps to one registry row with its
 *              id, part, blocks and fix; a line that could not be read is
 *              `unknown`, never `problem`;
 *            - "Fix these first" holds at most three root causes, worst and
 *              most waited-on first;
 *            - a stuck /pipeline group is tagged with the check that explains
 *              it only when that check is a problem for every item's app, and
 *              Home leaves those groups out of Needs you (one cause, once).
 *          The 2026-10-29 outage (the follow-up Cursor key deleted) is the
 *          first case.
 */
import { describe, expect, it } from 'vitest'
import {
  attachAffects,
  bannerCheck,
  CHECK_META,
  countChecks,
  dedupeChecks,
  dropDuplicateNoRepo,
  fromDoctorCheck,
  fromSdkHealth,
  fromSetupGap,
  problemsByProject,
  rootCauses,
  sdkHealthUnreadable,
  sortChecks,
  type HealthCheck,
} from '../../supabase/functions/_shared/health-checks.ts'
import { followupKeyGap, autofixKeyGap, deployGap, noRepoGap, slackGap } from '../../supabase/functions/_shared/setup-gaps.ts'
import { tagRootCauses, type PipelineStage } from '../../supabase/functions/_shared/pipeline-view.ts'
import { buildFixFirst, buildNeedsYou } from '../../supabase/functions/_shared/project-home.ts'

const P = 'p-glot'
const Q = 'p-hhtp'
const NOW = new Date('2026-10-29T05:00:00Z')
const AT = NOW.toISOString()

const deleted = followupKeyGap({ projectId: P, settings: { enabled: false, offReason: 'the Cursor key chosen for review follow-ups was deleted.', keyId: null } })
const noAgent = autofixKeyGap({ projectId: P, dispatcher: { autofixOn: true, server: { agentKeys: 0, offKeys: 1 } } })
const noDeploy = deployGap(P, null, NOW)

describe('setup gaps in the registry', () => {
  it('the 2026-10-29 outage: a deleted follow-up key is one problem that stops follow-ups', () => {
    const c = fromSetupGap(deleted, AT)
    expect(c).toMatchObject({ id: 'review_followup_key', key: 'review_followup_key', status: 'problem', part: 'ai_keys', blocks: ['followups'], source: 'setup_gaps', projectId: P })
    expect(c.detail).toContain('was deleted')
    expect(c.fix).toEqual({ kind: 'one_click', label: 'Pick a Cursor key', to: '/settings?tab=byok#review-followups' })
  })

  it('follow-ups on with a missing or disabled key are problems; off by choice is ok', () => {
    const missing = followupKeyGap({ projectId: P, settings: { enabled: true, offReason: null, keyId: 'k1' }, keyStatus: null })
    const disabled = followupKeyGap({ projectId: P, settings: { enabled: true, offReason: null, keyId: 'k1' }, keyStatus: 'disabled' })
    const choice = followupKeyGap({ projectId: P, settings: { enabled: false, offReason: null, keyId: null } })
    expect(fromSetupGap(missing, AT).status).toBe('problem')
    expect(fromSetupGap(disabled, AT).status).toBe('problem')
    expect(fromSetupGap(choice, AT).status).toBe('ok')
  })

  it('auto-fix with no usable key stops auto-fix; one GitHub line per repo shares the github_access id', () => {
    expect(fromSetupGap(noAgent, AT)).toMatchObject({ id: 'autofix_agent_key', status: 'problem', blocks: ['autofix'] })
    const repo = fromSetupGap({ ...noRepoGap(P), id: 'github_access:kensaurus/glot.it' }, AT)
    expect(repo).toMatchObject({ id: 'github_access', key: 'github_access:kensaurus/glot.it', part: 'github', blocks: ['autofix', 'train'] })
  })

  it('a check that could not be read is unknown, never a problem', () => {
    const unread = followupKeyGap({ projectId: P, settings: null })
    expect(fromSetupGap(unread, AT).status).toBe('unknown')
    const slack = slackGap({ projectId: P, connected: true, latest: null }, NOW)
    expect(fromSetupGap(slack, AT).status).toBe('unknown')
    expect(fromSetupGap(deployGap(P, undefined, NOW), AT).status).toBe('unknown')
  })
})

describe('SDK health and diagnostics in the registry', () => {
  it('maps problems to the plan ids, notes to unknown rows, and every other SDK check to ok', () => {
    const rows = fromSdkHealth(
      P,
      {
        problems: [
          { id: 'never_seen', severity: 'error', title: 'Never seen', detail: 'No check-in yet.', fix: { kind: 'install_task', label: 'File install task' } },
          { id: 'outdated', severity: 'info', title: 'Old SDK', detail: '1.30 → 1.33', fix: null, link: { label: 'Open upgrade PR', href: 'https://github.com/o/r/pull/9' } },
        ],
        notes: [{ check: 'site_csp', detail: 'the site did not answer' }],
        installed: true,
        lastSeenAt: null,
      },
      AT,
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get('never_seen')).toMatchObject({ status: 'problem', severity: 'critical', fix: { kind: 'one_click', label: 'File install task', action: 'install_task' } })
    expect(byId.get('outdated_sdk')).toMatchObject({ status: 'problem', severity: 'info', fix: { to: 'https://github.com/o/r/pull/9' } })
    expect(byId.get('csp_blocks_api')).toMatchObject({ status: 'unknown', detail: 'the site did not answer' })
    expect(byId.get('ci_secrets_missing')?.status).toBe('ok')
    expect(rows).toHaveLength(8)
  })

  it('SDK health that could not run at all: every SDK row unknown, none missing', () => {
    const rows = sdkHealthUnreadable(P, 'took longer than 25s', AT)
    expect(rows).toHaveLength(8)
    expect(rows.every((r) => r.status === 'unknown')).toBe(true)
  })

  it('the report button: hidden or manual is a problem that stops reports; unreadable is unknown', () => {
    expect(bannerCheck(P, { bannerEnabled: true, launcherMode: 'hidden' }, AT)).toMatchObject({ id: 'banner_disabled', status: 'problem', blocks: ['reports'] })
    expect(bannerCheck(P, { bannerEnabled: true, launcherMode: null }, AT).status).toBe('ok')
    expect(bannerCheck(P, null, AT).status).toBe('unknown')
  })
})

describe('server doctor in the registry', () => {
  it('fail and warn are problems, a line that could not read is unknown, platform lines stay platform', () => {
    expect(fromDoctorCheck(P, { name: 'stranded_reports', status: 'warn', summary: '3 report(s) stuck', hint: 'Check fast-filter.' }, AT)).toMatchObject({
      status: 'problem',
      part: 'pipeline',
      blocks: ['triage'],
      fix: { kind: 'guided', steps: ['Check fast-filter.'] },
    })
    expect(fromDoctorCheck(null, { name: 'recovery_token', status: 'warn', summary: 'Could not read mushi_runtime_config: timeout' }, AT)).toMatchObject({ status: 'unknown', audience: 'platform' })
    expect(fromDoctorCheck(null, { name: 'platform_slack_oauth', status: 'fail', summary: 'missing' }, AT)).toMatchObject({ audience: 'platform', blocks: [] })
    expect(fromDoctorCheck(P, { name: 'codebase_index:p', status: 'pass', summary: 'ok' }, AT)).toMatchObject({ id: 'codebase_index', status: 'ok' })
  })
})

describe('lists', () => {
  const rows = (): HealthCheck[] => [
    fromSetupGap(deployGap(P, null, NOW), AT),
    fromSetupGap(slackGap({ projectId: P, connected: false, latest: null }, NOW), AT),
    fromSetupGap(noAgent, AT),
    fromSetupGap(deleted, AT),
    fromSetupGap(followupKeyGap({ projectId: P, settings: null }), AT),
    bannerCheck(P, { bannerEnabled: true, launcherMode: 'manual' }, AT),
  ]

  it('Fix these first: at most three root causes, critical before warn, most waiting first', () => {
    const affected = attachAffects(rows(), [
      { rootCause: { checkId: 'review_followup_key', count: 24 }, count: 24, items: [{ projectId: P }] },
      { rootCause: { checkId: 'autofix_agent_key', count: 1 }, count: 1, items: [{ projectId: P }] },
      { rootCause: { checkId: 'deploy_events', count: 2 }, count: 2, items: [{ projectId: P }] },
    ])
    const top = rootCauses(affected)
    expect(top.map((c) => c.id)).toEqual(['review_followup_key', 'autofix_agent_key', 'deploy_events'])
    expect(top[0].affects).toBe(24)
    expect(top.every((c) => c.status === 'problem')).toBe(true)
  })

  it('a lesser problem is a root cause only while something waits on it; "no repo connected" never is', () => {
    // A new app: no repo, never deployed, nothing merged and waiting to go live.
    const fresh = [fromSetupGap(noRepoGap(P), AT), fromSetupGap(deployGap(P, null, NOW), AT), bannerCheck(P, { bannerEnabled: true, launcherMode: 'hidden' }, AT)]
    expect(rootCauses(fresh)).toEqual([])
    // A connected repo whose access is broken is one.
    const repo = fromSetupGap({ ...noRepoGap(P), id: 'github_access:kensaurus/glot.it' }, AT)
    expect(rootCauses([repo]).map((c) => c.key)).toEqual(['github_access:kensaurus/glot.it'])
  })

  it('an unknown or ok check never becomes a root cause', () => {
    const only = [fromSetupGap(followupKeyGap({ projectId: P, settings: null }), AT), fromSetupGap(deployGap(P, '2026-10-28T00:00:00Z', NOW), AT)]
    expect(rootCauses(only)).toEqual([])
  })

  it('sorts problems, then unknown, then ok, and counts each', () => {
    const sorted = sortChecks(rows())
    expect(sorted.map((c) => c.status)).toEqual(['problem', 'problem', 'problem', 'problem', 'unknown', 'ok'])
    expect(countChecks(sorted)).toEqual({ problem: 4, unknown: 1, ok: 1 })
  })

  it('dedupes by key and keeps one "no repo" line', () => {
    const noRepo = fromSetupGap(noRepoGap(P), AT)
    const sdkNoRepo = fromSdkHealth(P, { problems: [{ id: 'no_repo', severity: 'warn', title: 'No repo', detail: 'x', fix: null }], notes: [], installed: null, lastSeenAt: null }, AT)
    const merged = dropDuplicateNoRepo(dedupeChecks([noRepo, noRepo, ...sdkNoRepo]))
    expect(merged.filter((c) => c.key === 'github_access')).toHaveLength(1)
    expect(merged.some((c) => c.id === 'sdk_no_repo')).toBe(false)
  })

  it('every check the registry knows names its part and stops only known automations', () => {
    for (const [id, meta] of Object.entries(CHECK_META)) {
      expect(meta.part, id).toBeTruthy()
      for (const b of meta.blocks) expect(['autofix', 'followups', 'train', 'reporter_updates', 'reports', 'review', 'triage', 'lane']).toContain(b)
    }
  })
})

const item = (projectId: string, id = `${projectId}-1`) => ({ id, projectId }) as PipelineStage['groups'][number]['items'][number]
const grp = (id: string, items: Array<ReturnType<typeof item>>, tone: 'stuck' | 'moving' = 'stuck', count = items.length) =>
  ({ id, stage: 'review', tone, label: `${count} PRs: ${id}`, count, oldestAt: null, actions: [], settings: null, items }) as PipelineStage['groups'][number]
const stg = (groups: PipelineStage['groups']): PipelineStage => ({ id: 'review', label: 'Reviewed', count: 0, stuck: 0, oldestAt: null, groups })

describe('pipeline root causes (tagRootCauses)', () => {
  const problems = problemsByProject([fromSetupGap(deleted, AT)])

  it('tags fix_first with the follow-up key when it is a problem for every item', () => {
    const [s] = tagRootCauses([stg([grp('fix_first', [item(P, 'a'), item(P, 'b')], 'stuck', 24), grp('hold', [item(P)])])], problems)
    expect(s.groups[0].rootCause).toEqual({ checkId: 'review_followup_key', count: 24 })
    expect(s.groups[1].rootCause).toBeUndefined()
  })

  it('leaves a group of several apps untagged when one of them does not have the problem', () => {
    const [s] = tagRootCauses([stg([grp('fix_first', [item(P), item(Q)])])], problems)
    expect(s.groups[0].rootCause).toBeUndefined()
  })

  it('never tags a moving group, and returns the stages unchanged with no problems', () => {
    const stages = [stg([grp('fix_first', [item(P)], 'moving')])]
    expect(tagRootCauses(stages, problems)[0].groups[0].rootCause).toBeUndefined()
    expect(tagRootCauses(stages, new Map())).toBe(stages)
  })

  it('counts each app once in a mixed group (attachAffects)', () => {
    const tagged = { rootCause: { checkId: 'review_followup_key', count: 3 }, count: 3, items: [item(P, 'a'), item(P, 'b'), item(Q, 'c')] }
    const [p, q] = attachAffects([fromSetupGap(deleted, AT), fromSetupGap({ ...deleted, projectId: Q }, AT)], [tagged])
    expect(p.affects).toBe(2)
    expect(q.affects).toBe(1)
  })
})

describe('Home: Fix these first, then Needs you', () => {
  it('a root cause shows once: the groups it explains leave Needs you', () => {
    const checks = [fromSetupGap(deleted, AT)]
    const stages = tagRootCauses([stg([grp('fix_first', [item(P)], 'stuck', 24), grp('hold', [item(P)], 'stuck', 31)])], problemsByProject(checks))
    const fixFirst = buildFixFirst(attachAffects(checks, stages.flatMap((s) => s.groups)))
    expect(fixFirst).toEqual([
      expect.objectContaining({ id: 'review_followup_key', affects: 24, fix: expect.objectContaining({ kind: 'one_click', label: 'Pick a Cursor key' }) }),
    ])
    const needs = buildNeedsYou({ projectId: P, health: [], criticalWaiting: 0, pipeline: stages, sdk: null, fixFirst })
    expect(needs.map((n) => n.id)).toEqual(['pipeline_hold'])
  })

  it('without fixFirst, Needs you is exactly as before', () => {
    const stages = tagRootCauses([stg([grp('fix_first', [item(P)], 'stuck', 24)])], problemsByProject([fromSetupGap(deleted, AT)]))
    expect(buildNeedsYou({ projectId: P, health: [], criticalWaiting: 0, pipeline: stages, sdk: null }).map((n) => n.id)).toEqual(['pipeline_fix_first'])
  })
})
