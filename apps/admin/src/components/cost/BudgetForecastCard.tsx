/**
 * FILE: apps/admin/src/components/cost/BudgetForecastCard.tsx
 * PURPOSE: Month-end spend forecast + optional budget alert.
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
 * PUT /v1/admin/org/budget. The user can edit inline.
 *
 * Phase E5, Round 9 (2026-05-21).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, Btn } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
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
  const inputRef = useRef<HTMLInputElement>(null)

  // Load existing budget
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    apiFetch<{ monthly_llm_budget_usd: number | null }>(
      `/v1/admin/org/budget?projectId=${projectId}`,
    ).then((res) => {
      if (cancelled) return
      if (res.ok && res.data) {
        setBudget(res.data.monthly_llm_budget_usd)
        if (res.data.monthly_llm_budget_usd !== null) {
          setBudgetInput(String(res.data.monthly_llm_budget_usd))
        }
      }
    })
    return () => { cancelled = true }
  }, [projectId])

  const handleSave = useCallback(async () => {
    if (!projectId) return
    const val = parseFloat(budgetInput)
    const budgetToSave = !budgetInput.trim() ? null : isNaN(val) || val <= 0 ? null : val
    setSaving(true)
    const res = await apiFetch('/v1/admin/org/budget', {
      method: 'PUT',
      body: JSON.stringify({ projectId, monthly_llm_budget_usd: budgetToSave }),
    })
    setSaving(false)
    if (res.ok) {
      setBudget(budgetToSave)
      setEditing(false)
      toast.success('Budget saved', budgetToSave ? `Monthly budget set to ${fmtSpend(budgetToSave)}` : 'Budget cleared.')
    } else {
      toast.error('Save failed', 'Could not update the budget. Try again.')
    }
  }, [projectId, budgetInput, fmtSpend, toast])

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
        {projectId && (
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
                  onChange={(e) => setBudgetInput(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-20 rounded border border-edge px-2 py-0.5 text-2xs text-fg bg-surface focus:outline-none focus:ring-1 focus:ring-brand"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
                  autoFocus
                />
                <Btn size="sm" variant="primary" onClick={handleSave} loading={saving}>Save</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
              </>
            ) : (
              <Btn size="sm" variant="ghost" onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 50) }}>
                {budget !== null ? `Budget: ${fmtSpend(budget)} / mo` : 'Set budget'}
              </Btn>
            )}
          </div>
        )}
      </div>

      {/* Budget alert banner */}
      {isOverBudget80 && (
        <div
          role="alert"
          className={`mb-3 flex items-start gap-2 rounded-md px-3 py-2 text-2xs ${
            isOverBudget100
              ? 'bg-red-50 border border-red-300/60 text-red-800 dark:bg-red-950/30 dark:border-red-700/50 dark:text-red-300'
              : 'bg-amber-50 border border-amber-300/60 text-amber-800 dark:bg-amber-950/30 dark:border-amber-700/50 dark:text-amber-300'
          }`}
        >
          <span aria-hidden="true">{isOverBudget100 ? '🚨' : '⚠️'}</span>
          <span>
            Projected to {isOverBudget100 ? 'exceed' : 'reach ≥80% of'} your{' '}
            {fmtSpend(budget!)} budget — forecast is{' '}
            <strong>{fmtSpend(linearForecast)}</strong> ({Math.round(pctOfBudget!)}%).
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
            className={`h-full rounded-full motion-safe:transition-all ${
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
