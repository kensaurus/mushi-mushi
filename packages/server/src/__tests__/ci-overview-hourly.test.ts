/**
 * `hourlySeries`: the per-hour job counts behind the CI page's week heatmap and
 * daily pass rate. Every hour of the window is present (zeros too), jobs land in
 * the hour they started, and hours older than a capped read are marked partial.
 */
import { describe, expect, it } from 'vitest'
import { hourlySeries } from '../../supabase/functions/_shared/ci-overview.ts'

const job = (at: string, ci_kind: 'passed' | 'code_failure' | 'runner_lost' | 'running', infra = false) => ({
  gh_created_at: at,
  ci_kind,
  infra,
  status: ci_kind === 'running' ? 'in_progress' : 'completed',
})

describe('hourlySeries', () => {
  const from = new Date('2026-11-10T00:30:00Z')
  const now = new Date('2026-11-10T03:10:00Z')

  it('has one entry per hour from the window start to now, zeros included', () => {
    const { hourly } = hourlySeries([], from, now, from)
    expect(hourly.map((h) => h.at)).toEqual(['2026-11-10T00:00:00.000Z', '2026-11-10T01:00:00.000Z', '2026-11-10T02:00:00.000Z', '2026-11-10T03:00:00.000Z'])
    expect(hourly.every((h) => h.jobs === 0)).toBe(true)
  })

  it('counts each job in the hour it started, by outcome', () => {
    const { hourly } = hourlySeries(
      [
        job('2026-11-10T01:05:00Z', 'passed'),
        job('2026-11-10T01:59:59Z', 'code_failure'),
        job('2026-11-10T01:20:00Z', 'runner_lost', true),
        job('2026-11-10T03:01:00Z', 'running'),
        job('2026-11-09T12:00:00Z', 'passed'), // before the window: dropped
      ],
      from,
      now,
      from,
    )
    expect(hourly[1]).toEqual({
      at: '2026-11-10T01:00:00.000Z',
      jobs: 3,
      passed: 1,
      codeFailures: 1,
      infraFailures: 1,
    })
    expect(hourly[3]).toMatchObject({ jobs: 1, passed: 0, codeFailures: 0, infraFailures: 0 })
    expect(hourly.reduce((n, h) => n + h.jobs, 0)).toBe(4)
  })

  it('marks hours before a capped read as partial', () => {
    // The window starts 00:30, so the 00:00 hour is half outside it: 01:00 is the first full hour.
    expect(hourlySeries([], from, now, from).hourlyFrom).toBe('2026-11-10T01:00:00.000Z')
    expect(hourlySeries([], new Date('2026-11-10T00:00:00Z'), now, new Date('2026-11-10T00:00:00Z')).hourlyFrom).toBe('2026-11-10T00:00:00.000Z')
    // The read's oldest job started 01:40: the 01:00 hour is incomplete, 02:00 is the first full one.
    expect(hourlySeries([], from, now, new Date('2026-11-10T01:40:00Z')).hourlyFrom).toBe('2026-11-10T02:00:00.000Z')
  })

  it('keeps at most 31 days of hours', () => {
    const { hourly } = hourlySeries([], new Date('2026-01-01T00:00:00Z'), now, new Date('2026-01-01T00:00:00Z'))
    expect(hourly).toHaveLength(31 * 24)
    expect(hourly.at(-1)!.at).toBe('2026-11-10T03:00:00.000Z')
  })
})
