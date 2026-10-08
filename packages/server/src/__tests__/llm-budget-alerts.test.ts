/**
 * Monthly AI budget alerts: one alert per threshold per month, the highest
 * new tier only, recorded even when one channel fails, never when all do.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  budgetAlertTier,
  budgetAlertText,
  runLlmBudgetAlerts,
  tierToSend,
} from '../../supabase/functions/_shared/llm-budget-alerts.ts'

describe('budgetAlertTier / tierToSend', () => {
  it('maps spend to the highest crossed threshold', () => {
    expect(budgetAlertTier(10, 50)).toBe(0)
    expect(budgetAlertTier(25, 50)).toBe(50)
    expect(budgetAlertTier(40, 50)).toBe(80)
    expect(budgetAlertTier(50, 50)).toBe(100)
    expect(budgetAlertTier(5, 0)).toBe(0)
  })

  it('sends only a tier above the one already sent this month', () => {
    expect(tierToSend(80, { month: '2026-10', tier: 50 }, '2026-10')).toBe(80)
    expect(tierToSend(80, { month: '2026-10', tier: 80 }, '2026-10')).toBe(0)
    expect(tierToSend(50, { month: '2026-09', tier: 100 }, '2026-10')).toBe(50)
    expect(tierToSend(50, null, '2026-10')).toBe(50)
  })

  it('says what stops at 100%', () => {
    const text = budgetAlertText({ projectId: 'p', projectName: 'glot.it', tier: 100, spendUsd: 50.2, budgetUsd: 50, resetsAt: '2026-11-01T00:00:00Z', consoleUrl: 'x' })
    expect(text).toContain('stopped AI triage, fixes and chat')
    expect(text).toContain('2026-11-01')
  })
})

function fakeDb(rows: unknown[]) {
  const updates: unknown[] = []
  const db = {
    updates,
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        not: () => Promise.resolve({ data: rows, error: null }),
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: { name: 'glot.it' }, error: null }),
        update: (v: unknown) => {
          updates.push({ table, v })
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
      return chain
    },
  }
  return db
}

describe('runLlmBudgetAlerts', () => {
  const now = new Date('2026-10-20T00:00:00Z')
  const state = (spendUsd: number) => async () => ({ budgetUsd: 50, spendUsd, over: spendUsd >= 50, resetsAt: '2026-11-01T00:00:00.000Z' })

  it('alerts every channel once and records the tier', async () => {
    const db = fakeDb([{ project_id: 'p1', llm_budget_alert_state: { month: '2026-10', tier: 50 }, slack_channel_id: 'C1', alert_email: 'a@x.dev' }])
    const deps = { email: vi.fn(async () => {}), slack: vi.fn(async () => {}), operator: vi.fn(async () => {}), ownerEmail: vi.fn(async () => null), readState: state(42) }
    const r = await runLlmBudgetAlerts(db as never, deps, { now, consoleUrl: 'https://c' })
    expect(r).toEqual({ checked: 1, sent: 1, errors: 0 })
    expect(deps.email).toHaveBeenCalledWith('a@x.dev', expect.stringContaining('80%'), expect.any(String))
    expect(deps.slack).toHaveBeenCalledWith('p1', 'C1', expect.any(String))
    expect(db.updates).toEqual([{ table: 'project_settings', v: { llm_budget_alert_state: { month: '2026-10', tier: 80 } } }])
  })

  it('stays quiet below the next tier', async () => {
    const db = fakeDb([{ project_id: 'p1', llm_budget_alert_state: { month: '2026-10', tier: 80 }, slack_channel_id: null, alert_email: null }])
    const deps = { email: vi.fn(async () => {}), slack: vi.fn(async () => {}), operator: vi.fn(async () => {}), ownerEmail: vi.fn(async () => 'o@x.dev'), readState: state(45) }
    expect(await runLlmBudgetAlerts(db as never, deps, { now, consoleUrl: 'https://c' })).toEqual({ checked: 1, sent: 0, errors: 0 })
    expect(deps.operator).not.toHaveBeenCalled()
  })

  it('does not record the tier when every channel failed, so the next hour retries', async () => {
    const db = fakeDb([{ project_id: 'p1', llm_budget_alert_state: null, slack_channel_id: 'C1', alert_email: 'a@x.dev' }])
    const fail = vi.fn(async () => { throw new Error('down') })
    const deps = { email: fail, slack: fail, operator: fail, ownerEmail: vi.fn(async () => null), readState: state(30) }
    expect(await runLlmBudgetAlerts(db as never, deps, { now, consoleUrl: 'https://c' })).toEqual({ checked: 1, sent: 0, errors: 1 })
    expect(db.updates).toEqual([])
  })
})
