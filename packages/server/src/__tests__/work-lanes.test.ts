/**
 * FILE: work-lanes.test.ts
 * PURPOSE: The pure parts of local workers (ADR 0048, _shared/work-lanes.ts):
 *            - the closed lane settings: the seven verbs, typed, and nothing
 *              else (an unknown key is refused, never dropped);
 *            - host guards and the heartbeat body;
 *            - which reports a lane may take (the CLI's hasLiveAttempt and
 *              inLocalCooldown, with an infra failure starting no cooldown);
 *            - the claim race: two claimers over one list never share a report;
 *            - one automatic requeue per report a week.
 */

import { describe, expect, it } from 'vitest'
import {
  AUTO_REQUEUE_WINDOW_MS,
  claimFirstFree,
  hasLiveAttempt,
  hostGuardsFrom,
  inLocalCooldown,
  laneClaimBlock,
  LANE_VERBS,
  laneConfigFromRow,
  mayAutoRequeue,
  parseClaimDone,
  parseHeartbeat,
  parseHostGuards,
  parseLaneVerbs,
  rankWorkCandidates,
  WORK_INFRA_PREFIX,
  type AttemptLite,
} from '../../supabase/functions/_shared/work-lanes.ts'

const NOW = new Date('2026-10-27T12:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const FULL = { paused: false, concurrency: 2, model: 'grok-4.7-xhigh-fast', mode: 'fix', stop_at: null, drain: false, prune_own: false }

describe('closed lane settings', () => {
  it('accepts exactly the seven verbs', () => {
    const r = parseLaneVerbs(FULL)
    expect(r.ok).toBe(true)
    expect(LANE_VERBS).toHaveLength(7)
  })

  it('refuses any other key, a command or a path included', () => {
    for (const extra of [{ command: 'rm -rf /' }, { repoDir: '/home/x' }, { env: { A: '1' } }, { script: 'curl x | sh' }]) {
      const r = parseLaneVerbs({ ...FULL, ...extra })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/Unknown lane setting/)
    }
  })

  it('refuses wrong types and out-of-range values', () => {
    expect(parseLaneVerbs({ ...FULL, concurrency: 5 }).ok).toBe(false)
    expect(parseLaneVerbs({ ...FULL, concurrency: 1.5 }).ok).toBe(false)
    expect(parseLaneVerbs({ ...FULL, paused: 'yes' }).ok).toBe(false)
    expect(parseLaneVerbs({ ...FULL, mode: 'shell' }).ok).toBe(false)
    expect(parseLaneVerbs({ ...FULL, model: '--yolo; rm -rf ~' }).ok).toBe(false)
    expect(parseLaneVerbs({ ...FULL, stop_at: 'tomorrow' }).ok).toBe(false)
  })

  it('needs all seven for an answer, at least one for a change', () => {
    expect(parseLaneVerbs({ paused: true }).ok).toBe(false)
    expect(parseLaneVerbs({ paused: true }, { partial: true })).toEqual({ ok: true, value: { paused: true } })
    expect(parseLaneVerbs({}, { partial: true }).ok).toBe(false)
  })

  it('a stored row answers with the seven verbs only', () => {
    const cfg = laneConfigFromRow({ paused: false, concurrency: 1, model: null, mode: 'weird', stop_at: '2026-10-31T14:59:00Z', drain: false, prune_own: false })
    expect(Object.keys(cfg).sort()).toEqual([...LANE_VERBS].sort())
    expect(cfg.mode).toBe('fix')
    expect(cfg.stop_at).toBe('2026-10-31T14:59:00.000Z')
  })
})

describe('host guards', () => {
  it('takes lane-v4 defaults for anything missing or out of range', () => {
    expect(hostGuardsFrom({})).toEqual({ max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 })
    expect(hostGuardsFrom({ max_agents: 99, gh_floor: 300 })).toEqual({ max_agents: 6, min_free_mem_gb: 5, gh_floor: 300 })
  })
  it('a change names only known guards', () => {
    expect(parseHostGuards({ max_agents: 3 }, { partial: true }).ok).toBe(true)
    expect(parseHostGuards({ max_agents: 3, shell: 'x' }, { partial: true }).ok).toBe(false)
  })
})

describe('heartbeat body', () => {
  const body = {
    host: { hostId: 'a'.repeat(64), hostname: 'ALIENWARE', platform: 'wsl2', version: '0.31.0' },
    status: { state: 'working', agents: 2, secret: 'x', memAvailableGb: 12.34 },
    lanes: [{ name: 'glot', projectId: P1, status: { state: 'idle', runs: 3, last: 'a\u0007b' }, initial: { model: 'claude-opus-5-5-medium' } }],
    claims: ['not-a-uuid'],
  }
  it('keeps known telemetry and drops the rest', () => {
    const r = parseHeartbeat(body)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.status).toEqual({ state: 'working', agents: 2, memAvailableGb: 12.3 })
    expect(r.value.lanes[0]!.status).toEqual({ state: 'idle', runs: 3, last: 'a b' })
    expect(r.value.lanes[0]!.initial).toEqual({ model: 'claude-opus-5-5-medium' })
    expect(r.value.claims).toEqual([])
  })
  it('refuses a raw machine id and initial settings outside the closed set', () => {
    expect(parseHeartbeat({ ...body, host: { ...body.host, hostId: 'machine-123' } }).ok).toBe(false)
    expect(parseHeartbeat({ ...body, lanes: [{ ...body.lanes[0], initial: { repoDir: '/x' } }] }).ok).toBe(false)
  })
})

describe('which reports a lane may take', () => {
  const a = (over: Partial<AttemptLite>): AttemptLite => ({ report_id: 'r', status: 'failed', agent: 'mcp', pr_url: null, pr_state: null, merged_at: null, error: 'Agent found nothing', created_at: '2026-10-26T12:00:00Z', ...over })

  it('a live run or an open PR holds the report', () => {
    expect(hasLiveAttempt([a({ status: 'running' })])).toBe(true)
    expect(hasLiveAttempt([a({ pr_url: 'https://github.com/o/r/pull/1', pr_state: 'open' })])).toBe(true)
    expect(hasLiveAttempt([a({})])).toBe(false)
  })

  it('a local no-PR run starts a 7-day cooldown, an infra failure does not', () => {
    expect(inLocalCooldown([a({})], NOW)).toBe(true)
    expect(inLocalCooldown([a({ error: `${WORK_INFRA_PREFIX} git fetch: Permission denied` })], NOW)).toBe(false)
    expect(inLocalCooldown([a({ error: 'mushi work stopped by SIGTERM' })], NOW)).toBe(false)
    expect(inLocalCooldown([a({ created_at: '2026-10-10T12:00:00Z' })], NOW)).toBe(false)
  })

  it('ranks worst first, then newest', () => {
    const ranked = rankWorkCandidates([
      { id: 'low', severity: 'low', created_at: '2026-10-27T00:00:00Z' },
      { id: 'crit-old', severity: 'critical', created_at: '2026-10-01T00:00:00Z' },
      { id: 'crit-new', severity: 'critical', created_at: '2026-10-20T00:00:00Z' },
    ])
    expect(ranked.map((r) => r.id)).toEqual(['crit-new', 'crit-old', 'low'])
  })

  it('a paused, draining, stopped, follow-up-only or full lane takes nothing', () => {
    const cfg = laneConfigFromRow({ ...FULL, concurrency: 1, stop_at: null })
    expect(laneClaimBlock(cfg, 0, NOW)).toBeNull()
    expect(laneClaimBlock({ ...cfg, paused: true }, 0, NOW)).toMatch(/paused/)
    expect(laneClaimBlock({ ...cfg, drain: true }, 0, NOW)).toMatch(/draining/)
    expect(laneClaimBlock({ ...cfg, stop_at: '2026-10-27T11:00:00Z' }, 0, NOW)).toMatch(/stop date/)
    expect(laneClaimBlock({ ...cfg, mode: 'followups' }, 0, NOW)).toMatch(/follow-ups/)
    expect(laneClaimBlock(cfg, 1, NOW)).toMatch(/already runs 1 of 1/)
  })
})

describe('the claim race', () => {
  it('two claimers over one list end with different reports', async () => {
    const active = new Set<string>()
    let n = 0
    // An insert is atomic, as the partial unique index makes it; the awaits interleave the claimers.
    const tryClaim = async (c: { id: string }) => {
      await Promise.resolve()
      if (active.has(c.id)) return { won: false as const }
      active.add(c.id)
      return { won: true as const, claimId: `claim-${++n}` }
    }
    const list = [{ id: 'r1' }, { id: 'r2' }]
    const [a, b] = await Promise.all([claimFirstFree(list, tryClaim), claimFirstFree(list, tryClaim)])
    expect(new Set([a?.candidate.id, b?.candidate.id])).toEqual(new Set(['r1', 'r2']))
    const [c] = await Promise.all([claimFirstFree(list, tryClaim)])
    expect(c).toBeNull()
  })
})

describe('how a claim ends', () => {
  it('needs a known outcome; infra or code only with a failure', () => {
    expect(parseClaimDone({ outcome: 'merged' }).ok).toBe(false)
    expect(parseClaimDone({ outcome: 'no_change', failureKind: 'infra' }).ok).toBe(false)
    expect(parseClaimDone({ outcome: 'failed', failureKind: 'infra' }).ok).toBe(true)
    expect(parseClaimDone({ outcome: 'pr_opened' }).ok).toBe(false)
    expect(parseClaimDone({ outcome: 'pr_opened', prUrl: 'https://github.com/o/r/pull/7' }).ok).toBe(true)
  })
  it('requeues an infra failure on its own once a week, never a code failure', () => {
    expect(mayAutoRequeue({ failureKind: 'infra' }, [], NOW)).toBe(true)
    expect(mayAutoRequeue({ failureKind: 'code' }, [], NOW)).toBe(false)
    expect(mayAutoRequeue({ failureKind: 'infra' }, [{ claimed_at: '2026-10-26T12:00:00Z' }], NOW)).toBe(false)
    expect(mayAutoRequeue({ failureKind: 'infra' }, [{ claimed_at: new Date(NOW.getTime() - AUTO_REQUEUE_WINDOW_MS - 1).toISOString() }], NOW)).toBe(true)
  })
})
