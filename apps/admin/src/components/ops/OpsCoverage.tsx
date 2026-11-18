/**
 * FILE: apps/admin/src/components/ops/OpsCoverage.tsx
 * PURPOSE: The Ops page's top half: today's counts (payments per currency,
 *          releases, open alerts) and the coverage matrix, one row per app
 *          and one heat cell per kind of event, "is everything connected".
 *          Apps that never sent an event come first, hatched, with a link to
 *          connect them. Each cell carries a shape (● ◐ ○ –) as well as colour.
 */

import { Link } from 'react-router-dom'
import { docsUrl } from '../../lib/docsUrl'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { OpsApp, OpsCoverageResponse } from '../../lib/opsTypes'
import { OPS_COLUMNS, buildCoverageRows, opsAppName, orderOpsColumns, paymentsToday } from '../../lib/opsView'
import { StatusGlyph } from '../signal/StatusGlyph'

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

const STAT = 'ci-rise px-3 py-1.5'
const STAT_LABEL = 'text-2xs font-bold tracking-wider text-fg-secondary uppercase'
const STAT_VALUE = 'font-mono text-lg font-extrabold text-fg tabular-nums'

/** One strip, three stats split by hairlines (no card inside the Today card). */
export function OpsTodayStrip({ data }: { data: OpsCoverageResponse }) {
  const open = data.today.openAlerts
  return (
    <dl className="grid grid-cols-1 divide-y divide-edge-subtle sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-testid="ops-today">
      <div className={STAT}>
        <dt className={STAT_LABEL}>💳 Payments today</dt>
        <dd className={STAT_VALUE}>{paymentsToday(data.today.payments)}</dd>
      </div>
      <div className={STAT}>
        <dt className={STAT_LABEL}>🚀 Releases today</dt>
        <dd className={STAT_VALUE}>{data.today.releases}</dd>
      </div>
      <div className={STAT}>
        <dt className={STAT_LABEL}>Open alerts</dt>
        <dd className={`${STAT_VALUE} ${open > 0 ? 'text-danger-foreground' : ''}`}>
          {open > 0 ? (
            <Link
              to="/ops?category=alerts&unacked=1#ops-feed"
              className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
              title="Show only the alerts nobody has acknowledged"
              data-testid="ops-open-alerts-link"
            >
              <StatusGlyph tone="danger" />
              {open} need a look
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <StatusGlyph tone="ok" />
              none open
            </span>
          )}
        </dd>
      </div>
    </dl>
  )
}

export function OpsCoverageMatrix({ data, now }: { data: OpsCoverageResponse; now: number }) {
  const rows = buildCoverageRows(data, now)
  if (rows.length === 0) return <p className="text-xs text-fg-muted">This team has no apps yet.</p>
  // Columns that have data first: a narrow screen never opens on a column of "never".
  const order = orderOpsColumns(rows)
  const columns = order.map((id) => OPS_COLUMNS.find((c) => c.id === id)!)
  const cellsOf = (r: (typeof rows)[number]) => order.map((id) => r.cells.find((c) => c.column === id)!)
  return (
    <>
      {/* Phone: one block per app, its four cells side by side under the name. */}
      <div className="space-y-1.5 sm:hidden" data-testid="ops-coverage-stacked">
        <div className="grid grid-cols-4 gap-0.5 text-3xs font-bold tracking-wider text-fg-secondary uppercase" aria-hidden="true">
          {columns.map((c) => (
            <span key={c.id} className="truncate px-1">
              {c.glyph} {c.label}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.app.id} data-testid={`ops-coverage-card-${r.app.id}`}>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
              <OpsAppIcon app={r.app} />
              <span className="truncate">{opsAppName(r.app)}</span>
              {r.mutedUntil && <span className="text-2xs font-semibold text-fg-secondary">🔕 muted</span>}
              {r.silent && (
                <a href={docsUrl('/integrations/ops-hub#connect-an-app')} target="_blank" rel="noopener noreferrer" className={`ml-auto shrink-0 text-2xs font-semibold ${LINK_ACCENT}`}>
                  How to connect ↗
                </a>
              )}
            </p>
            <div className="mt-0.5 grid grid-cols-4 gap-0.5">
              {cellsOf(r).map((cell) => (
                <span
                  key={cell.column}
                  className={`truncate rounded-xs px-1 py-0.5 font-mono text-2xs tabular-nums ${cell.fresh.className}`}
                  title={`${opsAppName(r.app)} · ${cell.column}: ${cell.lastAt ? `last ${cell.fresh.label}, ${cell.count7d} in 7 days` : 'never reported'}`}
                >
                  <span aria-hidden="true">{cell.fresh.glyph}</span> {cell.fresh.label}
                  {cell.count7d > 0 && <span className="ml-0.5 font-bold">×{cell.count7d}</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
        <p className="text-2xs text-fg-secondary">● last day · ◐ this week · ○ older · – never. ×n = events in 7 days.</p>
      </div>
    <div className="hidden overflow-x-auto sm:block" data-testid="ops-coverage">
      <table className="w-full min-w-0 border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">When each app last sent each kind of event, and how many in 7 days</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left text-2xs font-bold tracking-wider text-fg-secondary uppercase">App</th>
            {columns.map((c) => (
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
              {cellsOf(r).map((cell) => (
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
    </>
  )
}
