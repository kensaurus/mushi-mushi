/**
 * FILE: apps/admin/src/components/ops/OpsCoverage.tsx
 * PURPOSE: The Ops page's top half: today's counts (payments per currency,
 *          releases, open alerts) and the coverage matrix, one row per app
 *          and one heat cell per kind of event, "is everything connected".
 *          Apps that never sent an event come first, hatched, with a link to
 *          connect them. Each cell carries a shape (● ◐ ○ –) as well as colour.
 */

import { Card } from '../ui'
import { docsUrl } from '../../lib/docsUrl'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { OpsApp, OpsCoverageResponse } from '../../lib/opsTypes'
import { OPS_COLUMNS, buildCoverageRows, opsAppName, paymentsToday } from '../../lib/opsView'

export function OpsAppIcon({ app, size = 'sm' }: { app: OpsApp | undefined; size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'h-6 w-6 text-xs' : 'h-4 w-4 text-3xs'
  if (app?.icon_url && /^https:\/\//.test(app.icon_url)) {
    return <img src={app.icon_url} alt="" className={`${box} shrink-0 rounded-xs object-cover`} loading="lazy" />
  }
  return (
    <span aria-hidden="true" className={`${box} inline-flex shrink-0 items-center justify-center rounded-xs bg-surface-overlay font-bold text-fg-secondary`}>
      {opsAppName(app).charAt(0)}
    </span>
  )
}

export function OpsTodayStrip({ data }: { data: OpsCoverageResponse }) {
  const open = data.today.openAlerts
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="ops-today">
      <Card variant="flat" className="ci-rise px-3 py-2">
        <dt className="text-2xs font-bold tracking-wider text-fg-secondary uppercase">💳 Payments today</dt>
        <dd className="font-mono text-lg font-extrabold text-fg tabular-nums">{paymentsToday(data.today.payments)}</dd>
      </Card>
      <Card variant="flat" className="ci-rise px-3 py-2">
        <dt className="text-2xs font-bold tracking-wider text-fg-secondary uppercase">🚀 Releases today</dt>
        <dd className="font-mono text-lg font-extrabold text-fg tabular-nums">{data.today.releases}</dd>
      </Card>
      <Card variant="flat" className="ci-rise px-3 py-2">
        <dt className="text-2xs font-bold tracking-wider text-fg-secondary uppercase">Open alerts</dt>
        <dd className={`font-mono text-lg font-extrabold tabular-nums ${open > 0 ? 'text-danger-foreground' : 'text-fg'}`}>
          {open > 0 ? `■ ${open} need a look` : '✓ none open'}
        </dd>
      </Card>
    </dl>
  )
}

export function OpsCoverageMatrix({ data, now }: { data: OpsCoverageResponse; now: number }) {
  const rows = buildCoverageRows(data, now)
  if (rows.length === 0) return <p className="text-xs text-fg-muted">This team has no apps yet.</p>
  return (
    <div className="overflow-x-auto" data-testid="ops-coverage">
      <table className="w-full min-w-0 border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">When each app last sent each kind of event, and how many in 7 days</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left text-2xs font-bold tracking-wider text-fg-secondary uppercase">App</th>
            {OPS_COLUMNS.map((c) => (
              <th key={c.id} scope="col" className="px-2 py-1 text-left text-2xs font-bold tracking-wider text-fg-secondary uppercase">
                <span aria-hidden="true">{c.glyph}</span> {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.app.id} data-testid={`ops-coverage-row-${r.app.id}`}>
              <th scope="row" className="px-2 py-1 text-left font-semibold text-fg">
                <span className="flex items-center gap-1.5">
                  <OpsAppIcon app={r.app} />
                  <span className="truncate">{opsAppName(r.app)}</span>
                  {r.mutedUntil && (
                    <span className="text-2xs font-semibold text-fg-secondary" title={`Slack messages muted until ${new Date(r.mutedUntil).toLocaleString()}`}>
                      🔕 muted
                    </span>
                  )}
                  {r.silent && (
                    <a href={docsUrl('/integrations/ops-hub#connect-an-app')} target="_blank" rel="noopener noreferrer" className={`text-2xs font-semibold ${LINK_ACCENT}`}>
                      How to connect ↗
                    </a>
                  )}
                </span>
              </th>
              {r.cells.map((cell) => (
                <td
                  key={cell.column}
                  className={`rounded-xs px-2 py-1 font-mono whitespace-nowrap tabular-nums ${cell.fresh.className}`}
                  title={`${opsAppName(r.app)} · ${cell.column}: ${cell.lastAt ? `last ${cell.fresh.label}, ${cell.count7d} in 7 days` : 'never reported'}`}
                >
                  <span aria-hidden="true">{cell.fresh.glyph}</span> {cell.fresh.label}
                  {cell.count7d > 0 && <span className="ml-1 font-bold">×{cell.count7d}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-2xs text-fg-secondary">● in the last day · ◐ this week · ○ older · – never (hatched). ×n = events in 7 days.</p>
    </div>
  )
}
