/**
 * One definition of "how is each integration doing" for the dashboard family
 * (_shared/integration-health-rollup.ts).
 *
 * Regressions pinned here (2026-10-04):
 *   - inbox/stats counted only `red` / `fail` as red, so a `down` probe (what
 *     integration-health-probe writes) never raised the Act flag;
 *   - with several projects in scope a later green probe in one project hid a
 *     red probe in another;
 *   - an unreadable health table read as "0 integrations failing".
 */
import { describe, expect, it, vi } from 'vitest'
import {
  IntegrationHealthReadError,
  countHealthIssues,
  healthSeverity,
  loadIntegrationHealth,
  summarizeHealthByKind,
  type HealthRollupRow,
} from '../../supabase/functions/_shared/integration-health-rollup.ts'

const A = 'aaaaaaaa-0000-4000-8000-000000000000'
const B = 'bbbbbbbb-0000-4000-8000-000000000000'

function row(p: Partial<HealthRollupRow> & Pick<HealthRollupRow, 'kind' | 'last_status'>): HealthRollupRow {
  return { project_id: A, last_at: '2026-10-04T02:00:00Z', ok_count: 10, total_count: 10, ...p }
}

describe('healthSeverity', () => {
  it('reads the prober vocabulary: down is red, degraded is amber, ok is ok', () => {
    expect(healthSeverity('ok')).toBe('ok')
    expect(healthSeverity('down')).toBe('red')
    expect(healthSeverity('degraded')).toBe('amber')
  })
  it('keeps the legacy spellings and never reads an unknown word as healthy', () => {
    expect(healthSeverity('red')).toBe('red')
    expect(healthSeverity('fail')).toBe('red')
    expect(healthSeverity('error')).toBe('red')
    expect(healthSeverity('amber')).toBe('amber')
    expect(healthSeverity('weird')).toBe('amber')
    expect(healthSeverity(null)).toBe('amber')
  })
})

describe('summarizeHealthByKind', () => {
  it('takes the worst project for a kind and sums the probe counts', () => {
    const kinds = summarizeHealthByKind([
      row({ kind: 'github', last_status: 'ok', last_at: '2026-10-04T03:00:00Z', ok_count: 9, total_count: 10 }),
      row({ project_id: B, kind: 'github', last_status: 'down', last_at: '2026-10-04T02:00:00Z', ok_count: 0, total_count: 10 }),
      row({ kind: 'sentry', last_status: 'ok' }),
    ])
    const github = kinds.find((k) => k.kind === 'github')!
    expect(github.severity).toBe('red')
    expect(github.lastStatus).toBe('down')
    expect(github.lastAt).toBe('2026-10-04T03:00:00Z')
    expect(github.uptime).toBeCloseTo(9 / 20)
    expect(kinds.find((k) => k.kind === 'sentry')!.uptime).toBe(1)
  })

  it('reports uptime as not counted when the counts were not read', () => {
    const [k] = summarizeHealthByKind([row({ kind: 'github', last_status: 'ok', ok_count: null, total_count: null })])
    expect(k.uptime).toBeNull()
  })
})

describe('countHealthIssues', () => {
  it('counts a down probe as red and a degraded one as amber', () => {
    const counts = countHealthIssues(
      summarizeHealthByKind([
        row({ kind: 'claude_code_agent', last_status: 'down' }),
        row({ kind: 'openai', last_status: 'degraded' }),
        row({ kind: 'github', last_status: 'ok' }),
      ]),
    )
    expect(counts).toEqual({ issues: 2, red: 1, amber: 1 })
  })
})

describe('loadIntegrationHealth', () => {
  function db(rpcResult: { data: unknown; error: { code?: string; message?: string } | null }, sample: unknown[] = []) {
    const limit = vi.fn(async () => ({ data: sample, error: null }))
    return {
      calls: { limit },
      rpc: vi.fn(async () => rpcResult),
      from: () => ({
        select: () => ({ in: () => ({ gte: () => ({ order: () => ({ limit }) }) }) }),
      }),
    }
  }

  it('returns the rollup rows with numeric counts', async () => {
    const d = db({ data: [{ project_id: A, kind: 'github', last_status: 'ok', last_at: 'x', ok_count: '3', total_count: '4' }], error: null })
    const out = await loadIntegrationHealth(d, [A], '2026-09-21T00:00:00Z')
    expect(out.source).toBe('rollup')
    expect(out.rows[0].ok_count).toBe(3)
    expect(out.rows[0].total_count).toBe(4)
    expect(d.rpc).toHaveBeenCalledWith('integration_health_rollup', { p_project_ids: [A], p_since: '2026-09-21T00:00:00Z' })
  })

  it('falls back to a latest-first sample only when the function is not deployed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = db({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }, [
      { project_id: A, kind: 'github', status: 'down', checked_at: '2026-10-04T03:00:00Z' },
      { project_id: A, kind: 'github', status: 'ok', checked_at: '2026-10-04T02:00:00Z' },
    ])
    const out = await loadIntegrationHealth(d, [A], '2026-09-21T00:00:00Z')
    expect(out.source).toBe('sample')
    expect(out.rows).toEqual([
      { project_id: A, kind: 'github', last_status: 'down', last_at: '2026-10-04T03:00:00Z', ok_count: null, total_count: null },
    ])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('throws on any other read error instead of reporting zero issues', async () => {
    const d = db({ data: null, error: { code: 'XX000', message: 'boom' } })
    await expect(loadIntegrationHealth(d, [A], '2026-09-21T00:00:00Z')).rejects.toBeInstanceOf(IntegrationHealthReadError)
    expect(d.calls.limit).not.toHaveBeenCalled()
  })

  it('reads nothing for an empty scope', async () => {
    const d = db({ data: [], error: null })
    expect(await loadIntegrationHealth(d, [], 'x')).toEqual({ rows: [], source: 'rollup' })
    expect(d.rpc).not.toHaveBeenCalled()
  })
})
