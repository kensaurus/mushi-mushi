/**
 * FILE: packages/cli/src/commands/budgets.ts
 * PURPOSE: `mushi budgets show|autofix` — every limit on what Mushi may spend
 *          for a project, in one place: the monthly AI budget and the
 *          auto-fix caps (GET /v1/admin/settings), the plan's hard spend cap
 *          (GET /v1/admin/billing/stats) and whether auto-fix is on
 *          (GET/POST /v1/admin/projects/:id/autofix[/toggle]).
 *          The spend cap is set with `mushi billing cap`. The four spend
 *          limits are edited in the console (Settings → General → Spend
 *          limits): that route takes a signed-in session, not an API key.
 */

import type { Command } from 'commander'
import { apiCall, die, outputIsJson, requireConfig } from '../cli-shared.js'
import { resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

const SPEND_LIMIT_FIELDS = [
  'monthly_llm_budget_usd',
  'autofix_max_spend_usd',
  'autofix_max_dispatches_per_day',
  'autofix_approval_cost_threshold_usd',
] as const

type SpendLimitField = (typeof SPEND_LIMIT_FIELDS)[number]

interface BudgetsView {
  projectId: string
  limits: Record<SpendLimitField, number | null>
  monthlySpendCapUsd: number | null
  autofixEnabled: boolean
}

const LABELS: Record<SpendLimitField, { label: string; unit: 'usd' | 'count'; none: string }> = {
  monthly_llm_budget_usd: { label: 'Monthly AI budget', unit: 'usd', none: 'no budget' },
  autofix_max_spend_usd: { label: 'Auto-fix spend limit, last 30 days', unit: 'usd', none: 'no limit' },
  autofix_max_dispatches_per_day: { label: 'Automatic fixes per day', unit: 'count', none: 'no limit' },
  autofix_approval_cost_threshold_usd: { label: 'Ask before fixes costing more than', unit: 'usd', none: 'never ask' },
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pickLimits(settings: Record<string, unknown>): Record<SpendLimitField, number | null> {
  return Object.fromEntries(SPEND_LIMIT_FIELDS.map((f) => [f, numberOrNull(settings[f])])) as Record<SpendLimitField, number | null>
}

function renderBudgets(view: BudgetsView): string[] {
  const lines = [`Spend limits for project ${view.projectId}`]
  for (const f of SPEND_LIMIT_FIELDS) {
    const meta = LABELS[f]
    const v = view.limits[f]
    const shown = v === null ? meta.none : meta.unit === 'usd' ? `$${v}` : String(v)
    lines.push(`  ${meta.label.padEnd(36)} ${shown}`)
  }
  lines.push(`  ${'Plan spend cap (per month)'.padEnd(36)} ${view.monthlySpendCapUsd == null ? 'no cap' : `$${view.monthlySpendCapUsd}`}`)
  lines.push(`  ${'Auto-fix'.padEnd(36)} ${view.autofixEnabled ? 'on' : 'off'}`)
  if (view.autofixEnabled && view.limits.autofix_max_spend_usd === null && view.limits.autofix_max_dispatches_per_day === null) {
    lines.push('  Auto-fix is on with no cap. Set one in the console: Settings → General → Spend limits.')
  }
  lines.push('Change the plan cap: mushi billing cap <usd>. Change the other limits: console Settings → General → Spend limits.')
  return lines
}

export function registerBudgetsCommands(program: Command): void {
  const budgets = program
    .command('budgets')
    .description('What Mushi may spend for a project: AI budget, auto-fix caps, plan spend cap')

  budgets
    .command('show')
    .description('Every spend limit and whether auto-fix is on')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const qs = new URLSearchParams({ project_id: projectId })
      const [settings, billing, autofix] = await Promise.all([
        apiCall<Record<string, unknown>>(`/v1/admin/settings?${qs}`, config),
        apiCall<{ monthlySpendCapUsd: number | null }>(`/v1/admin/billing/stats?${qs}`, config),
        apiCall<{ autofix_enabled: boolean }>(`/v1/admin/projects/${projectId}/autofix`, config),
      ])
      if (!settings.ok) die(settings)
      if (!billing.ok) die(billing)
      if (!autofix.ok) die(autofix)
      const view: BudgetsView = {
        projectId,
        limits: pickLimits(settings.data),
        monthlySpendCapUsd: billing.data.monthlySpendCapUsd ?? null,
        autofixEnabled: autofix.data.autofix_enabled,
      }
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(view, null, 2))
        return
      }
      for (const line of renderBudgets(view)) console.log(line)
    })

  budgets
    .command('autofix <state>')
    .description('Turn auto-fix on or off (on | off). Fixes you start yourself always run.')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .action(async (state: string, opts: { projectId?: string }) => {
      if (state !== 'on' && state !== 'off') {
        throw new MushiCliError('E_INVALID_INPUT', 'Pass on or off.', 'e.g. mushi budgets autofix off')
      }
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<{ autofix_enabled: boolean }>(
        `/v1/admin/projects/${projectId}/autofix/toggle`,
        config,
        { method: 'POST', body: JSON.stringify({ enabled: state === 'on' }) },
      )
      if (!result.ok) die(result)
      console.log(`Auto-fix is ${result.data.autofix_enabled ? 'on' : 'off'} for project ${projectId}.`)
    })
}
