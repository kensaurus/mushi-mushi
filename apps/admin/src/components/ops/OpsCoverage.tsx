/**
 * FILE: apps/admin/src/components/ops/OpsCoverage.tsx
 * PURPOSE: The Ops page's top half: today's counts (payments per currency,
 *          releases, open alerts) and the coverage matrix, one row per app
 *          and one heat cell per kind of event, "is everything connected".
 *          Apps that never sent an event come first, hatched, with a link to
 *          connect them. Each cell carries a shape (● ◐ ○ –) as well as colour.
 */

import { docsUrl } from '../../lib/docsUrl'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { OpsApp, OpsCoverageResponse } from '../../lib/opsTypes'
import { OPS_COLUMNS, buildCoverageRows, opsAppName, paymentsToday, splitOpsColumns } from '../../lib/opsView'
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
const STAT_VALUE = 'text-lg font-extrabold text-fg tabular-nums'

/**
 * One strip, split by hairlines (no card inside the Today card). The open count is the length of
 * the "Needs a look" list at the top of the page (lib/opsView needsLookView), so the two always
 * agree; when that list is shown it carries its own counts and this strip leaves it out.
 */
export function OpsTodayStrip({ data, needsLook }: { data: OpsCoverageResponse; needsLook: number | null }) {
  // null = the feed has not loaded: say nothing rather than a calm "nothing open".
  return (
    <dl className={`grid grid-cols-1 divide-y divide-edge-subtle sm:divide-x sm:divide-y-0 ${needsLook === 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} data-testid="ops-today">
      <div className={STAT}>
        <dt className={STAT_LABEL}>💳 Payments today</dt>
        <dd className={STAT_VALUE}>{paymentsToday(data.today.payments)}</dd>
      </div>
      <div className={STAT}>
        <dt className={STAT_LABEL}>🚀 Releases today</dt>
        <dd className={STAT_VALUE}>{data.today.releases}</dd>
      </div>
      {needsLook === 0 && (
        <div className={STAT}>
          <dt className={STAT_LABEL}>Needs a look</dt>
          <dd className={`${STAT_VALUE} inline-flex items-center gap-1.5`} data-testid="ops-needs-look-none">
            <StatusGlyph tone="ok" />
            nothing open
          </dd>
        </div>
      )}
    </dl>
  )
}

export function OpsCoverageMatrix({ data, now }: { data: OpsCoverageResponse; now: number }) {
  const rows = buildCoverageRows(data, now)
  if (rows.length === 0) return <p className="text-xs text-fg-muted">This team has no apps yet.</p>
  // Columns that have data first; a column no app has ever sent is named once, below, instead of
  // "– never" on every row.
  const { shown, empty } = splitOpsColumns(rows)
  const columns = shown.map((id) => OPS_COLUMNS.find((c) => c.id === id)!)
  const emptyLabels = empty.map((id) => OPS_COLUMNS.find((c) => c.id === id)!.label.toLowerCase())
  const cellsOf = (r: (typeof rows)[number]) => shown.map((id) => r.cells.find((c) => c.column === id)!)
  const emptyNote = emptyLabels.length > 0 && (
    <p className="mt-1 text-2xs text-fg-secondary" data-testid="ops-coverage-empty-columns">
      No app has sent {emptyLabels.length > 1 ? `${emptyLabels.slice(0, -1).join(', ')} or ${emptyLabels[emptyLabels.length - 1]}` : emptyLabels[0]} yet.{' '}
      <a href={docsUrl('/integrations/ops-hub#connect-an-app')} target="_blank" rel="noopener noreferrer" className={`font-semibold ${LINK_ACCENT}`}>
        How to send them ↗
      </a>
    </p>
  )
  return (
    <>
      {/* Phone: one card per app, each kind of event on its own labelled line (no 4-up grid of cut cells). */}
      <ul className="space-y-1.5 sm:hidden" data-testid="ops-coverage-stacked">
        {rows.map((r) => (
          <li key={r.app.id} className="rounded-md border border-edge-subtle px-2 py-1.5" data-testid={`ops-coverage-card-${r.app.id}`}>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold text-fg">
              <OpsAppIcon app={r.app} />
              <span className="min-w-0 break-words">{opsAppName(r.app)}</span>
              {r.mutedUntil && <span className="text-2xs font-semibold text-fg-secondary">🔕 muted</span>}
              {r.silent && (
                <a href={docsUrl('/integrations/ops-hub#connect-an-app')} target="_blank" rel="noopener noreferrer" className={`ml-auto shrink-0 text-2xs font-semibold ${LINK_ACCENT}`}>
                  How to connect ↗
                </a>
              )}
            </p>
            <dl
              // mushi-mushi-allowlist: term / definition columns: the term sizes to its words
              className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs">
              {cellsOf(r).map((cell, k) => (
                <div key={cell.column} className="contents">
                  <dt className="font-semibold text-fg-secondary">
                    <span aria-hidden="true">{columns[k].glyph}</span> {columns[k].label}
                  </dt>
                  <dd
                    className={`justify-self-start rounded-xs px-1 tabular-nums ${cell.fresh.className}`}
                    title={`${opsAppName(r.app)} · ${cell.column}: ${cell.lastAt ? `last ${cell.fresh.label}, ${cell.count7d} in 7 days` : 'never reported'}`}
                  >
                    <span aria-hidden="true">{cell.fresh.glyph}</span> {cell.fresh.label}
                    {cell.count7d > 0 && <span className="ml-1 font-bold">×{cell.count7d} in 7d</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        <li className="list-none text-2xs text-fg-secondary">● last day · ◐ this week · ○ older · – never.</li>
      </ul>
      <div className="sm:hidden">{emptyNote}</div>
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
                  className={`rounded-xs px-2 py-1 whitespace-nowrap tabular-nums ${cell.fresh.className}`}
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
      {emptyNote}
    </div>
    </>
  )
}
