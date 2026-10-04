/**
 * FILE: apps/admin/src/components/cost/BudgetForecastCard.tsx
 * PURPOSE: Month-end spend forecast + optional monthly LLM budget. The budget
 *          is enforced server-side (_shared/llm-budget.ts): at 100% of this
 *          month's spend, LLM calls stop until the 1st (UTC).
 *
 * Takes the 14-day daily spend series and computes two forward projections:
 *   (1) Linear — total14d / 14 * daysInMonth
 *   (2) 7d EMA — exponentially weighted average of last 7 days * daysInMonth
 *
 * When a monthly_llm_budget_usd is set for the project and the linear
 * forecast exceeds 80%, shows a yellow/red warning banner so the user
 * can act before the month ends.
 *
 * Budget is stored in project_settings.monthly_llm_budget_usd via
 * PATCH /v1/admin/settings (owner-only, the same field Settings → Spend edits). The user can edit inline.
 *
 * Phase E5, Round 9 (2026-05-21).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, Btn } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { describeApiError } from '../../lib/humanizeApiError'
import { useActiveOrgRole } from '../../lib/useActiveOrgRole'
import { ConfirmDialog } from '../ConfirmDialog'
import { parseBudgetInput } from './budgetInput'
import type { DailySpendSeries } from './dailySpendSeries'

interface Props {
  projectId: string | null | undefined
  series: DailySpendSeries
  /** UTC calendar month spend (from GET /v1/admin/costs/stats spendMonthUsd). */
  monthToDateUsd: number
  fmtSpend: (usd: number) => string
}

function daysInCurrentMonth(): number {
  const now = new Date()
  return new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate()
}

function daysElapsedInMonth(): number {
  return new Date().getUTCDate()
}

/** 7-day Exponential Moving Average (α = 2 / (N+1), N=7). */
function ema7(values: number[]): number {
  const last7 = values.slice(-7)
  if (last7.length === 0) return 0
  const alpha = 2 / (last7.length + 1)
  let ema = last7[0]
  for (let i = 1; i < last7.length; i++) {
    ema = alpha * last7[i] + (1 - alpha) * ema
  }
  return ema
}

export function BudgetForecastCard({ projectId, series, monthToDateUsd, fmtSpend }: Props) {
  const toast = useToast()
  const [budget, setBudget] = useState<number | null>(null)
  const [budgetInput, setBudgetInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Spend limits are owner/admin-only on the server; members and viewers see
  // the budget but not an editor that can only fail.
  const { canManage } = useActiveOrgRole()

  // Load existing budget
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    apiFetch<{ monthly_llm_budget_usd?: number | string | null }>(
      `/v1/admin/settings?project_id=${encodeURIComponent(projectId)}`,
    ).then((res) => {
      if (cancelled) return
      if (res.ok && res.data) {
        // numeric columns arrive as strings from PostgREST
        const raw = res.data.monthly_llm_budget_usd
        const value = raw == null ? null : Number(raw)
        setBudget(value)
        if (value !== null) setBudgetInput(String(value))
      }
    })
    return () => { cancelled = true }
  }, [projectId])

  const saveBudget = useCallback(async (budgetToSave: number | null) => {
    if (!projectId) return
    setSaving(true)
    const res = await apiFetchMutate(`/v1/admin/settings?project_id=${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ monthly_llm_budget_usd: budgetToSave }),
    })
    setSaving(false)
    setConfirmClear(false)
    if (res.ok) {
      setBudget(budgetToSave)
      setEditing(false)
      toast.success(
        budgetToSave ? 'Budget saved' : 'Budget removed',
        budgetToSave ? `Monthly budget set to ${fmtSpend(budgetToSave)}` : 'AI calls are no longer capped by a monthly budget.',
      )
    } else if (res.error?.code === 'FORBIDDEN') {
      toast.error('Could not change the budget', 'Only team owners and admins can change the monthly budget. Ask one of them to set it.')
    } else {
      const e = describeApiError(res.error, 'Could not change the budget')
      toast.error(e.title, e.hint)
    }
  }, [projectId, fmtSpend, toast])

  // A typo used to clear the budget (and with it the spend cap) behind a
  // success toast. Invalid input now stays in the editor with a reason, and
  // removing the budget asks first.
  const handleSave = useCallback(() => {
    const parsed = parseBudgetInput(budgetInput)
    if (parsed.kind === 'invalid') {
      setInputError(parsed.message)
      return
    }
    setInputError(null)
    if (parsed.kind === 'clear') {
      if (budget === null) {
        setEditing(false)
        return
      }
      setConfirmClear(true)
      return
    }
    void saveBudget(parsed.value)
  }, [budgetInput, budget, saveBudget])

  // Compute forecasts
  const daysTotal = daysInCurrentMonth()
  const daysElapsed = daysElapsedInMonth()

  const avg14dDaily = series.activeDays > 0 ? series.totalUsd / 14 : 0
  const linearForecast = avg14dDaily * daysTotal

  const emaDaily = ema7(series.values)
  const emaForecast = emaDaily * daysTotal

  const pctOfBudget = budget && budget > 0 ? (linearForecast / budget) * 100 : null
  const isOverBudget80 = pctOfBudget !== null && pctOfBudget >= 80
  const isOverBudget100 = pctOfBudget !== null && pctOfBudget >= 100

  if (series.activeDays === 0) return null

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">Month-end forecast</p>
        {projectId && !canManage && (
          <span className="text-2xs text-fg-muted" title="Only team owners and admins can change the monthly budget.">
            {budget !== null ? `Budget: ${fmtSpend(budget)} / mo` : 'No budget set'}
          </span>
        )}
        {projectId && canManage && (
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <span className="text-2xs text-fg-muted">Budget: $</span>
                <input
                  ref={inputRef}
                  type="number"
                  min="0"
                  step="0.01"
                  value={budgetInput}
                  onChange={(e) => { setBudgetInput(e.target.value); setInputError(null) }}
                  aria-invalid={inputError != null}
                  aria-describedby={inputError ? 'budget-input-error' : undefined}
                  placeholder="e.g. 50"
                  className="w-20 rounded border border-edge px-2 py-0.5 text-2xs text-fg bg-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
                  autoFocus
                />
                <Btn size="sm" variant="primary" onClick={handleSave} loading={saving}>Save</Btn>
                <Btn size="sm" variant="cancel" onClick={() => { setEditing(false); setInputError(null) }}>Cancel</Btn>
              </>
            ) : (
              <Btn size="sm" variant="ghost" onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 50) }}>
                {budget !== null ? `Budget: ${fmtSpend(budget)} / mo` : 'Set budget'}
              </Btn>
            )}
          </div>
        )}
      </div>

      {inputError && (
        <p id="budget-input-error" role="alert" className="mb-2 text-2xs text-danger">{inputError}</p>
      )}

      {confirmClear && budget !== null && (
        <ConfirmDialog
          title="Remove the monthly budget?"
          body={`Mushi stops AI calls when this month's spend reaches the budget. Without one (now ${fmtSpend(budget)} / month), AI spend is not capped until you set a budget again.`}
          confirmLabel="Remove budget"
          tone="danger"
          loading={saving}
          onConfirm={() => saveBudget(null)}
          onCancel={() => (saving ? undefined : setConfirmClear(false))}
        />
      )}

      {/* Budget alert banner */}
      {isOverBudget80 && (
        <div
          role="alert"
          className={`mb-3 flex items-start gap-2 rounded-md px-3 py-2 text-2xs ${
            isOverBudget100 ? CHIP_TONE.dangerSubtle : CHIP_TONE.warnSubtle
          }`}
        >
          <span aria-hidden="true">{isOverBudget100 ? '🚨' : '⚠️'}</span>
          <span>
            Projected to {isOverBudget100 ? 'exceed' : 'reach ≥80% of'} your{' '}
            {fmtSpend(budget!)} budget — forecast is{' '}
            <strong>{fmtSpend(linearForecast)}</strong> ({Math.round(pctOfBudget!)}%). When this
            month&apos;s spend reaches the budget, Mushi stops AI calls until next month.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <ForecastCell
          label="Month-to-date"
          value={fmtSpend(monthToDateUsd)}
          hint={`${daysElapsed} of ${daysTotal} days (UTC)`}
        />
        <ForecastCell
          label="Linear forecast"
          value={fmtSpend(linearForecast)}
          hint={`$${avg14dDaily.toFixed(3)}/day · last ${series.days.length}d`}
          accent={isOverBudget80 ? (isOverBudget100 ? 'text-critical' : 'text-warn') : undefined}
        />
        <ForecastCell
          label="7d EMA forecast"
          value={fmtSpend(emaForecast)}
          hint="Weighted towards recent days"
        />
        <ForecastCell
          label="Peak day (14d)"
          value={fmtSpend(series.peakUsd)}
          hint={series.peakDayLabel ?? '—'}
        />
      </div>

      {budget !== null && (
        <div className="mt-3 h-1.5 rounded-full bg-surface-raised/30 overflow-hidden">
          <div
            className={`h-full rounded-full motion-safe:transition-[transform,opacity] ${
              isOverBudget100 ? 'bg-critical' : isOverBudget80 ? 'bg-warn' : 'bg-ok'
            }`}
            style={{ width: `${Math.min(pctOfBudget ?? 0, 100).toFixed(1)}%` }}
          />
        </div>
      )}
    </Card>
  )
}

interface ForecastCellProps {
  label: string
  value: string
  hint: string
  accent?: string
}

function ForecastCell({ label, value, hint, accent }: ForecastCellProps) {
  return (
    <div>
      <p className="text-3xs text-fg-muted uppercase tracking-wider">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent ?? 'text-fg'}`}>{value}</p>
      <p className="mt-0.5 text-3xs text-fg-faint">{hint}</p>
    </div>
  )
}
