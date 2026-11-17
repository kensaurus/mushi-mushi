/**
 * FILE: apps/admin/src/components/ci/CiWeekHeat.tsx
 * PURPOSE: The week in colour (2026-11-17): jobs started per hour as a day × hour heatmap (one
 *          teal hue, darker = busier) and each day's pass rate against the 80% target (red
 *          below, blue above, grey on target, with ▼/▲ so colour is never the only cue). Hours
 *          the data does not cover are hatched. Pointing at a cell names it.
 */

import { useMemo, useState } from 'react'
import type { CiHourly } from '../../lib/ciTypes'
import { PASS_TARGET, buildWeekGrid, divergeClass, heatClass } from '../../lib/ciWeek'

const LEGEND_STEPS = ['ci-heat-1', 'ci-heat-2', 'ci-heat-3', 'ci-heat-4', 'ci-heat-5', 'ci-heat-6']
const HOUR_LABELS = [0, 6, 12, 18, 23]

function hourText(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

export function CiWeekHeat({ hourly, hourlyFrom, now }: { hourly: CiHourly[] | undefined; hourlyFrom: string | undefined; now: number }) {
  const grid = useMemo(() => buildWeekGrid(hourly, hourlyFrom, now), [hourly, hourlyFrom, now])
  const [point, setPoint] = useState<string | null>(null)
  if (!grid) return null
  const target = Math.round(PASS_TARGET * 100)

  return (
    <div className="flex flex-col gap-3" data-testid="ci-week-heat">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-3xs font-bold tracking-wider text-fg uppercase">Jobs per hour</h3>
          <span className="flex items-center gap-3">
            <span className="min-w-40 text-right font-mono text-2xs font-semibold text-fg tabular-nums" aria-live="polite">
              {point ?? 'Point at an hour'}
            </span>
            <span className="flex items-center gap-0.5" aria-hidden="true">
              <span className="mr-1 text-3xs text-fg-secondary">0</span>
              {LEGEND_STEPS.map((c) => (
                <span key={c} className={`h-2 w-3.5 rounded-xs ${c}`} />
              ))}
              <span className="ml-1 font-mono text-3xs text-fg-secondary tabular-nums">{grid.max}</span>
            </span>
          </span>
        </div>
        <div
          className="flex flex-col"
          role="img"
          aria-label={`Jobs started per hour over the last ${grid.days.length} days. Busiest hour: ${grid.max} jobs.`}
          onMouseLeave={() => setPoint(null)}
        >
          <div className="flex gap-1.5">
            <div className="grid w-8 shrink-0 gap-0.5 text-3xs font-semibold text-fg-secondary">
              {grid.days.map((d) => (
                <span key={d.start} className="flex h-5 items-center">
                  {d.label}
                </span>
              ))}
            </div>
            <div className="grid min-w-0 flex-1 gap-0.5">
              {grid.days.map((d, di) => (
                <div key={d.start} className="grid grid-cols-24 gap-0.5">
                  {d.hours.map((v, h) => (
                    <span
                      key={h}
                      className={`ci-heatcell ci-pop h-5 rounded-xs ${heatClass(v, grid.max)}`}
                      style={{ animationDelay: `${(di * 24 + h) * 3}ms` }}
                      title={`${d.label} ${hourText(h)}: ${v == null ? 'no data' : `${v} job${v === 1 ? '' : 's'}`}`}
                      onMouseEnter={() => setPoint(`${d.label} ${hourText(h)} · ${v == null ? 'no data' : `${v} job${v === 1 ? '' : 's'}`}`)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex gap-1.5">
            <span className="w-8 shrink-0" />
            <div className="relative h-3 flex-1 font-mono text-3xs text-fg-secondary tabular-nums" aria-hidden="true">
              {HOUR_LABELS.map((h) => (
                <span
                  key={h}
                  className={`absolute ${h === 0 ? '' : h === 23 ? '-translate-x-full' : '-translate-x-1/2'}`}
                  style={{ left: `${(h / 23) * 100}%` }}
                >
                  {String(h).padStart(2, '0')}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-3xs font-bold tracking-wider text-fg uppercase">Pass rate per day</h3>
          <span className="text-2xs text-fg-secondary">
            target <span className="font-mono font-bold text-fg">{target}%</span> · <span className="font-bold text-danger-foreground">▼ below</span> ·{' '}
            <span className="font-bold text-info-foreground">▲ above</span>
          </span>
        </div>
        <ul className="grid grid-cols-7 gap-1">
          {grid.days.map((d, i) => {
            const pct = d.passRate == null ? null : Math.round(d.passRate * 100)
            return (
              <li
                key={d.start}
                className={`ci-pop flex flex-col items-center rounded-sm py-1.5 ${divergeClass(d.passRate)}`}
                style={{ animationDelay: `${300 + i * 50}ms` }}
                title={
                  pct == null
                    ? `${d.label}: nothing finished testing`
                    : `${d.label}: ${pct}% passed (${d.passed} passed, ${d.codeFailures} failed), target ${target}%`
                }
              >
                <span className="text-3xs font-semibold">{d.label}</span>
                <span className="font-mono text-sm font-extrabold tabular-nums">{pct == null ? '–' : `${pct < target ? '▼' : '▲'} ${pct}%`}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
