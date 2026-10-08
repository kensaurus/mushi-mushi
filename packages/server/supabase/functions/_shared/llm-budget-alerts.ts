/**
 * FILE: packages/server/supabase/functions/_shared/llm-budget-alerts.ts
 * PURPOSE: Warn before the monthly AI budget stops AI calls.
 *
 * `project_settings.monthly_llm_budget_usd` stops every AI call once this
 * month's spend reaches it (`llm-budget.ts`), but nothing said so beforehand:
 * triage, fixes and chat just stopped. This sends one alert per threshold
 * (50 %, 80 %, 100 %) per UTC month, to the project's alert email or owner,
 * the project's Slack channel and the operator channel. Run hourly from
 * `usage-alerts`. The tier already sent is kept in
 * `project_settings.llm_budget_alert_state` = `{ month: 'YYYY-MM', tier }`.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { readLlmBudgetState } from './llm-budget.ts'

export type BudgetTier = 0 | 50 | 80 | 100

/** The highest threshold this spend has crossed. */
export function budgetAlertTier(spendUsd: number, budgetUsd: number): BudgetTier {
  if (!(budgetUsd > 0)) return 0
  const share = spendUsd / budgetUsd
  return share >= 1 ? 100 : share >= 0.8 ? 80 : share >= 0.5 ? 50 : 0
}

/** The tier to send now, or 0: only a tier above the one already sent this month. */
export function tierToSend(tier: BudgetTier, state: unknown, month: string): BudgetTier {
  const s = state as { month?: unknown; tier?: unknown } | null
  const sent = s && s.month === month && typeof s.tier === 'number' ? s.tier : 0
  return tier > sent ? tier : 0
}

export interface BudgetAlert {
  projectId: string
  projectName: string
  tier: Exclude<BudgetTier, 0>
  spendUsd: number
  budgetUsd: number
  resetsAt: string
  consoleUrl: string
}

/** One sentence that says what happens next. */
export function budgetAlertText(a: BudgetAlert): string {
  const spent = `$${a.spendUsd.toFixed(2)} of the $${a.budgetUsd.toFixed(0)} monthly AI budget`
  const reset = a.resetsAt.slice(0, 10)
  if (a.tier === 100) {
    return `${a.projectName} has used ${spent}. Mushi has stopped AI triage, fixes and chat for this app until ${reset} (UTC). Fixes you start yourself still run. Raise the budget in Settings to resume now.`
  }
  return `${a.projectName} has used ${spent} (${a.tier}%). At 100% Mushi stops AI triage, fixes and chat until ${reset} (UTC).`
}

export interface BudgetAlertDeps {
  email: (to: string, subject: string, text: string) => Promise<void>
  slack: (projectId: string, channel: string, text: string) => Promise<void>
  operator: (a: BudgetAlert, text: string) => Promise<void>
  ownerEmail: (projectId: string) => Promise<string | null>
  readState?: typeof readLlmBudgetState
}

/**
 * Check every project with a monthly AI budget and send the alerts due now.
 * Each channel is best effort; the tier is recorded once any channel ran, so a
 * Slack outage cannot turn into an hourly email.
 */
export async function runLlmBudgetAlerts(
  db: SupabaseClient,
  deps: BudgetAlertDeps,
  opts: { now?: Date; consoleUrl: string },
): Promise<{ checked: number; sent: number; errors: number }> {
  const now = opts.now ?? new Date()
  const month = now.toISOString().slice(0, 7)
  const readState = deps.readState ?? readLlmBudgetState
  const { data, error } = await db
    .from('project_settings')
    .select('project_id, monthly_llm_budget_usd, llm_budget_alert_state, slack_channel_id, alert_email')
    .not('monthly_llm_budget_usd', 'is', null)
  if (error) throw new Error(`budget settings read failed: ${error.message}`)
  const rows = (data ?? []) as Array<{
    project_id: string
    llm_budget_alert_state: unknown
    slack_channel_id: string | null
    alert_email: string | null
  }>
  let sent = 0
  let errors = 0
  for (const row of rows) {
    try {
      const state = await readState(db, row.project_id, now)
      if (state.budgetUsd == null) continue
      const tier = tierToSend(budgetAlertTier(state.spendUsd, state.budgetUsd), row.llm_budget_alert_state, month)
      if (tier === 0) continue
      const { data: project } = await db.from('projects').select('name').eq('id', row.project_id).maybeSingle()
      const alert: BudgetAlert = {
        projectId: row.project_id,
        projectName: (project as { name?: string } | null)?.name ?? row.project_id,
        tier,
        spendUsd: state.spendUsd,
        budgetUsd: state.budgetUsd,
        resetsAt: state.resetsAt,
        consoleUrl: `${opts.consoleUrl}/settings?project=${row.project_id}`,
      }
      const text = budgetAlertText(alert)
      const subject = tier === 100 ? `AI paused: ${alert.projectName} reached its monthly AI budget` : `${alert.projectName} is at ${tier}% of its monthly AI budget`
      const to = row.alert_email ?? (await deps.ownerEmail(row.project_id))
      const results = await Promise.allSettled([
        to ? deps.email(to, subject, `${text}\n\n${alert.consoleUrl}`) : Promise.resolve(),
        row.slack_channel_id ? deps.slack(row.project_id, row.slack_channel_id, `${text} <${alert.consoleUrl}|Open settings>`) : Promise.resolve(),
        deps.operator(alert, text),
      ])
      if (results.every((r) => r.status === 'rejected')) throw new Error('every alert channel failed')
      const { error: stampErr } = await db
        .from('project_settings')
        .update({ llm_budget_alert_state: { month, tier } })
        .eq('project_id', row.project_id)
      if (stampErr) throw new Error(`alert state write failed: ${stampErr.message}`)
      sent++
    } catch (err) {
      errors++
      console.warn(JSON.stringify({ scope: 'llm-budget-alerts', projectId: row.project_id, err: err instanceof Error ? err.message : String(err) }))
    }
  }
  return { checked: rows.length, sent, errors }
}
