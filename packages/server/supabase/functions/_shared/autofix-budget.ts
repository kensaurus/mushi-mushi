import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface AutofixBudgetSettings {
  autofix_max_spend_usd: number | null
  autofix_max_dispatches_per_day: number | null
  autofix_approval_cost_threshold_usd: number | null
}

export interface AutofixBudgetCheck {
  allowed: boolean
  reason?: string
  requiresApproval?: boolean
  spendUsd30d?: number
  dispatchesToday?: number
}

export async function checkAutofixBudget(
  db: SupabaseClient,
  projectId: string,
  settings: AutofixBudgetSettings,
  opts?: { severity?: string | null; estimatedCostUsd?: number },
): Promise<AutofixBudgetCheck> {
  const maxSpend = settings.autofix_max_spend_usd
  const maxDaily = settings.autofix_max_dispatches_per_day
  const approvalThreshold = settings.autofix_approval_cost_threshold_usd

  let spendUsd30d = 0
  if (maxSpend != null) {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { data } = await db
      .from('llm_invocations')
      .select('cost_usd')
      .eq('project_id', projectId)
      .gte('created_at', since)
      .eq('function_name', 'fix-worker')
    spendUsd30d = (data ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
    if (spendUsd30d >= maxSpend) {
      return {
        allowed: false,
        reason: `Auto-fix spend ceiling reached ($${spendUsd30d.toFixed(2)} / $${maxSpend.toFixed(2)} per 30d).`,
        spendUsd30d,
      }
    }
  }

  let dispatchesToday = 0
  if (maxDaily != null) {
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const { count } = await db
      .from('fix_dispatch_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gte('created_at', dayStart.toISOString())
      .neq('status', 'skipped')
    dispatchesToday = count ?? 0
    if (dispatchesToday >= maxDaily) {
      return {
        allowed: false,
        reason: `Daily auto-fix dispatch quota reached (${dispatchesToday}/${maxDaily}).`,
        dispatchesToday,
      }
    }
  }

  const est = opts?.estimatedCostUsd ?? 0
  const sev = (opts?.severity ?? '').toLowerCase()
  const requiresApproval =
    approvalThreshold != null &&
    est >= approvalThreshold &&
    (sev === 'high' || sev === 'critical')

  return {
    allowed: true,
    spendUsd30d,
    dispatchesToday,
    requiresApproval,
  }
}
