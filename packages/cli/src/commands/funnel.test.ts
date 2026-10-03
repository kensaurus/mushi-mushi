import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerFunnelCommands } from './funnel.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

describe('mushi funnel set: step validation', () => {
  it('trims 2-8 distinct event names', async () => {
    const run = await runCli(registerFunnelCommands, ['funnel', 'set', '--steps', 'signup, first_report ,fix_merged'], () =>
      okReply({ steps: ['signup', 'first_report', 'fix_merged'], window: '7d', lookbackDays: 30, updatedAt: 'now' }))
    expect(run.calls[0]!.body).toEqual({ steps: ['signup', 'first_report', 'fix_merged'], window: '7d', lookbackDays: 30 })
  })

  it.each([
    ['signup', /2 to 8/],
    ['signup,First-Report', /Not an event name/],
    ['signup,signup', /different event/],
  ])('rejects %s before calling the API', async (steps, message) => {
    const run = await runCli(registerFunnelCommands, ['funnel', 'set', '--steps', steps])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.message).toMatch(message)
  })
})

describe('mushi funnel show', () => {
  it('says how to set one up when the team has no funnel', async () => {
    const run = await runCli(registerFunnelCommands, ['funnel', 'show'], () => okReply({ state: 'not_set_up', definition: null, rows: [] }))
    expect(run.calls[0]!.path).toBe('/v1/admin/orgs/current/funnel')
    expect(run.stdout).toContain('mushi funnel set --steps')
  })

  it('prints each app with its state', async () => {
    const run = await runCli(registerFunnelCommands, ['funnel', 'show'], () => okReply({
      state: 'ok',
      definition: { steps: ['signup', 'paid'], window: '7d', lookbackDays: 30, updatedAt: '2026-10-01' },
      rows: [
        { projectId: 'p1', name: 'Habit app', state: 'ok', overallPct: 12.5, steps: [{ name: 'signup', entered: 8, converted: 8, pct: 100 }, { name: 'paid', entered: 8, converted: 1, pct: 12.5 }] },
        { projectId: 'p2', name: 'Notes', state: 'off', overallPct: null, steps: [] },
      ],
    }))
    expect(run.stdout).toContain('Funnel: signup → paid')
    expect(run.stdout).toContain('12.5%')
    expect(run.stdout).toContain('product events are off')
  })
})

describe('mushi funnel set', () => {
  it('PUTs the validated definition', async () => {
    const run = await runCli(
      registerFunnelCommands,
      ['funnel', 'set', '--steps', 'signup,paid', '--window', '30d', '--lookback', '90'],
      () => okReply({ steps: ['signup', 'paid'], window: '30d', lookbackDays: 90, updatedAt: 'now' }),
    )
    expect(run.calls[0]).toMatchObject({ method: 'PUT', path: '/v1/admin/orgs/current/funnel', body: { steps: ['signup', 'paid'], window: '30d', lookbackDays: 90 } })
    expect(run.stdout).toContain('Saved: signup → paid')
  })

  it('refuses a bad window without calling the API', async () => {
    const run = await runCli(registerFunnelCommands, ['funnel', 'set', '--steps', 'signup,paid', '--window', '2d'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })
})

describe('mushi funnel growth', () => {
  it('reads the operator funnel with weeks and source', async () => {
    const run = await runCli(registerFunnelCommands, ['funnel', 'growth', '--weeks', '4', '--source', 'hn'], () => okReply({
      weeks: [{ week_start: '2026-09-28', signups: 9, activated: 2 }],
      by_source: [],
      window_start: '2026-09-07',
      window_end: '2026-10-05',
      source: 'hn',
      self_project_configured: true,
    }))
    expect(run.calls[0]!.path).toBe('/v1/admin/growth/funnel?weeks=4&source=hn')
    expect(run.stdout).toContain('2026-09-28')
    expect(run.stdout).toContain('signups 9 · activated 2')
  })

  it('points a project-bound key at the account key', async () => {
    const run = await runCli(registerFunnelCommands, ['funnel', 'growth'], () => errorReply(403, 'GROWTH_NEEDS_ACCOUNT_KEY', 'bound key'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('account-level key')
  })
})
