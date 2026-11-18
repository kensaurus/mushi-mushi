/**
 * FILE: apps/admin/src/components/providers/SpendPanel.tsx
 * PURPOSE: The Spend tab. KPI tiles (cost, sold, margin, credits users
 *          hold), an app × provider heat grid of cost for 24 h or 30 d with
 *          a red outline where cost beat what was sold and the margin as a
 *          ▲/▼ chip, a totals row, and a 48 h hourly stacked bar per
 *          provider with errors as red ticks.
 */

import { useMemo, useState } from 'react'
import type { OpsSnapshot } from '../../lib/kensaurusOpsTypes'
import { buildHourlyBars, buildSpendGrid, cellKey, formatMicroUsd } from '../../lib/providersView'
import { heatClass } from '../../lib/ciWeek'
import { SegmentedControl } from '../ui'
import { ChangeChip, Chip } from './providerMarks'

type Window = '24h' | '30d'
const WINDOWS = [
  { id: '24h', label: '24 h' },
  { id: '30d', label: '30 d' },
] as const

/** Stack colours per app: the validated teal ramp, darkest last. */
const APP_FILL = ['bg-viz-heat-3', 'bg-viz-heat-5', 'bg-viz-heat-2', 'bg-viz-heat-6', 'bg-viz-heat-4', 'bg-viz-heat-1']

function Kpi({ label, value, tone = 'plain', testId }: { label: string; value: string; tone?: 'plain' | 'bad'; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-edge bg-surface px-2.5 py-1.5" data-testid={testId}>
      <span className="text-3xs font-bold tracking-wider text-fg-secondary uppercase">{label}</span>
      <span className={`font-mono text-lg leading-none font-extrabold tabular-nums ${tone === 'bad' ? 'text-danger-foreground' : 'text-fg'}`}>{value}</span>
    </div>
  )
}

export function SpendPanel({ snapshot }: { snapshot: OpsSnapshot }) {
  const [win, setWin] = useState<Window>('24h')
  const digest = win === '24h' ? snapshot.spend.last_24h : snapshot.spend.last_30d
  const grid = useMemo(() => buildSpendGrid(digest), [digest])
  const hourly = useMemo(() => buildHourlyBars(snapshot.spend_hourly, snapshot.generated_at), [snapshot.spend_hourly, snapshot.generated_at])
  const t = grid.totals
  return (
    <div className="flex flex-col gap-3" data-testid="providers-spend">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<Window> value={win} options={WINDOWS} onChange={setWin} ariaLabel="Spend window" size="sm" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="Cost" value={formatMicroUsd(t.cost)} tone={t.cost > t.sell && t.sell > 0 ? 'bad' : 'plain'} />
        <Kpi label="Sold" value={formatMicroUsd(t.sell)} />
        <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-edge bg-surface px-2.5 py-1.5">
          <span className="text-3xs font-bold tracking-wider text-fg-secondary uppercase">Margin</span>
          <span className="text-lg leading-none">
            <ChangeChip value={t.margin} />
          </span>
        </div>
        <Kpi label="Credits held" value={formatMicroUsd(digest?.liability_micro ?? 0)} testId="spend-liability" />
      </div>

      {grid.apps.length === 0 ? (
        <p className="text-xs text-fg-muted">No AI calls in this window.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-edge">
          <table className="w-full border-collapse text-2xs" data-testid="spend-grid">
            <thead>
              <tr className="bg-surface-overlay">
                <th className="px-2 py-1 text-left font-bold text-fg-secondary" scope="col">
                  App
                </th>
                {grid.providers.map((p) => (
                  <th key={p} className="px-2 py-1 text-left font-bold text-fg-secondary" scope="col">
                    {p}
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-bold text-fg-secondary" scope="col">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.apps.map((app) => {
                const a = grid.byApp.get(app)!
                return (
                  <tr key={app} className="border-t border-edge-subtle">
                    <th scope="row" className="px-2 py-1 text-left font-bold text-fg">
                      {app}
                    </th>
                    {grid.providers.map((p) => {
                      const c = grid.cells.get(cellKey(app, p))
                      if (!c) return <td key={p} className="px-1 py-0.5" />
                      return (
                        <td key={p} className="px-1 py-0.5">
                          <span
                            className={`ci-heatcell flex items-center justify-between gap-1 rounded-xs px-1.5 py-0.5 ${heatClass(c.cost, grid.maxCost)} ${c.loss ? 'ring-2 ring-danger ring-inset' : ''}`}
                            title={`${c.calls} calls · ${c.errors} errors · cost ${formatMicroUsd(c.cost)} · sold ${formatMicroUsd(c.sell)}`}
                            data-testid={`spend-cell-${app}-${p}`}
                            data-loss={c.loss ? 'true' : undefined}
                          >
                            <span className="font-mono font-bold tabular-nums">{formatMicroUsd(c.cost)}</span>
                            {c.loss && (
                              <span className="font-bold" aria-label="loss">
                                ▼
                              </span>
                            )}
                          </span>
                          <span className="block px-1.5">
                            <ChangeChip value={c.margin} />
                          </span>
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-right font-mono font-bold text-fg tabular-nums">{formatMicroUsd(a.cost)}</td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-edge bg-surface-overlay" data-testid="spend-totals">
                <th scope="row" className="px-2 py-1 text-left font-bold text-fg">
                  Total
                </th>
                {grid.providers.map((p) => (
                  <td key={p} className="px-2 py-1 font-mono font-bold text-fg tabular-nums">
                    {formatMicroUsd(grid.byProvider.get(p)?.cost ?? 0)}
                  </td>
                ))}
                <td className="px-2 py-1 text-right font-mono font-extrabold text-fg tabular-nums">{formatMicroUsd(t.cost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <section aria-label="Cost per hour, last 48 hours" className="flex flex-col gap-1.5" data-testid="spend-hourly">
        <div className="flex flex-wrap items-center gap-2 text-3xs text-fg-secondary">
          <span className="font-bold tracking-wider uppercase">48 h per hour</span>
          {hourly.apps.map((a, i) => (
            <span key={a} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-xs ${APP_FILL[i % APP_FILL.length]}`} aria-hidden="true" />
              {a}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-0.5 bg-danger" aria-hidden="true" />
            errors
          </span>
        </div>
        {hourly.providers.length === 0 && <p className="text-xs text-fg-muted">No calls in the last 48 hours.</p>}
        {hourly.providers.map((p) => (
          <div key={p} className="grid grid-cols-[6rem_1fr] items-end gap-2">
            <Chip>{p}</Chip>
            <div className="flex h-8 items-end gap-px" role="img" aria-label={`${p}: cost per hour`}>
              {hourly.bars.get(p)!.map((b) => (
                <span key={b.hour} className="relative flex h-full flex-1 flex-col-reverse" title={`${b.hour.slice(5, 13)}h · ${formatMicroUsd(b.cost)} · ${b.calls} calls · ${b.errors} errors`}>
                  {b.segments.map((s) => (
                    <span
                      key={s.app}
                      className={`w-full ${APP_FILL[hourly.apps.indexOf(s.app) % APP_FILL.length]}`}
                      style={{ height: hourly.max > 0 ? `${(s.cost / hourly.max) * 100}%` : '0%' }}
                    />
                  ))}
                  {b.errors > 0 && <span className="absolute inset-x-0 top-0 h-1 bg-danger" data-testid="hour-error-tick" />}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
