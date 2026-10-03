import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerBudgetsCommands } from './budgets.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const PID = '11111111-2222-4333-8444-555555555555'

describe('mushi budgets show: reading the settings row', () => {
  it('reads the four spend limits, coerces numeric strings and treats missing as no limit', async () => {
    const run = await runCli(registerBudgetsCommands, ['budgets', 'show', '--json'], (c) =>
      c.path.startsWith('/v1/admin/settings')
        ? okReply({ monthly_llm_budget_usd: '20', autofix_max_spend_usd: 2, slack_webhook_url: '…' })
        : c.path.startsWith('/v1/admin/billing/stats') ? okReply({ monthlySpendCapUsd: null }) : okReply({ autofix_enabled: false }))
    expect(JSON.parse(run.stdout).limits).toEqual({
      monthly_llm_budget_usd: 20,
      autofix_max_spend_usd: 2,
      autofix_max_dispatches_per_day: null,
      autofix_approval_cost_threshold_usd: null,
    })
  })
})

describe('mushi budgets show', () => {
  function respond(path: string) {
    if (path.startsWith('/v1/admin/settings')) return okReply({ monthly_llm_budget_usd: 20, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null, autofix_approval_cost_threshold_usd: 5 })
    if (path.startsWith('/v1/admin/billing/stats')) return okReply({ monthlySpendCapUsd: 100 })
    return okReply({ autofix_enabled: true })
  }

  it('combines settings, the plan cap and the auto-fix flag', async () => {
    const run = await runCli(registerBudgetsCommands, ['budgets', 'show'], (c) => respond(c.path))
    expect(run.calls.map((c) => c.path).sort()).toEqual([
      `/v1/admin/billing/stats?project_id=${PID}`,
      `/v1/admin/projects/${PID}/autofix`,
      `/v1/admin/settings?project_id=${PID}`,
    ])
    expect(run.stdout).toContain('Monthly AI budget')
    expect(run.stdout).toContain('$20')
    expect(run.stdout).toContain('Plan spend cap (per month)           $100')
    expect(run.stdout).toContain('Auto-fix is on with no cap')
  })

  it('emits one JSON object with --json', async () => {
    const run = await runCli(registerBudgetsCommands, ['budgets', 'show', '--json'], (c) => respond(c.path))
    expect(JSON.parse(run.stdout)).toEqual({
      projectId: PID,
      limits: { monthly_llm_budget_usd: 20, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null, autofix_approval_cost_threshold_usd: 5 },
      monthlySpendCapUsd: 100,
      autofixEnabled: true,
    })
  })

  it('fails instead of showing "no limit" when a read fails', async () => {
    const run = await runCli(registerBudgetsCommands, ['budgets', 'show'], (c) =>
      c.path.startsWith('/v1/admin/settings') ? errorReply(500, 'DB_ERROR', 'down') : respond(c.path))
    expect(run.exitCode).toBe(1)
    expect(run.stdout).not.toContain('no budget')
  })
})

describe('mushi budgets autofix', () => {
  it('toggles auto-fix', async () => {
    const run = await runCli(registerBudgetsCommands, ['budgets', 'autofix', 'off'], () => okReply({ autofix_enabled: false }))
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/projects/${PID}/autofix/toggle`, body: { enabled: false } })
    expect(run.stdout).toContain('Auto-fix is off')
  })

  it('accepts only on or off', async () => {
    const run = await runCli(registerBudgetsCommands, ['budgets', 'autofix', 'maybe'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })
})
