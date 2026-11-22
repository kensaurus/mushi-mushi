/**
 * FILE: apps/admin/src/components/portfolio/AppSignalGrid.tsx
 * PURPOSE: Apps × signals on one table, worst first (2026-11-18; owner: "i like
 *          the visual enhancement of ci runner — why arent all other pages
 *          enhanced like this?"). Ten cards that all said "Bugs to fix" become
 *          ten rows where the worst cell of each app is the darkest one:
 *          open bugs, risks, SDK behind, release age, CI failures today, last
 *          SDK check-in. Every cell has its number or state in text and a
 *          title, unknown cells are hatched "no data" (never 0), and each row
 *          carries the app's highlight key, so its alert card and app card
 *          light with it.
 *
 * Round 2 (2026-11-18): a column that is unknown on (nearly) every app is not drawn; one
 * line under the grid says so and names the apps that do have a value ("Release age: no
 * release data for 8 of 9 apps · mushi-mushi 182d"). Below 672 px of room each app is a
 * stacked block of labelled cells instead of a table that scrolls sideways and hides
 * "CI fails today" and "Last check-in" off the right edge of a phone.
 *
 * Data: the portfolio cards (lib/appSignals.ts ranks them) and the setup
 * list's SDK check-ins; nothing is read here.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { HeatGrid, columnMax, heatCellClass, type HeatCellValue, type HeatColumn, type HeatRow } from '../signal/HeatGrid'
import { StatusGlyph, type SignalTone } from '../signal/StatusGlyph'
import { useLinked } from '../signal/linkedHighlight'
import { appKey, shortAge, type AppSignals } from '../../lib/appSignals'
import { appLink, openApp } from '../../lib/openApp'

/** Top reasons that no column of the grid shows, so the row names them under the app. */
const NO_COLUMN: ReadonlySet<string> = new Set(['broken', 'fix'])

/** Release age past this many days is the darkest step. */
const RELEASE_AGE_TOP_DAYS = 60

const COLUMNS: HeatColumn[] = [
  { id: 'bugs', label: 'Open bugs', scale: 'bad', hint: 'Open bug reports. A count cut short shows "+".' },
  { id: 'risks', label: 'Risks', scale: 'bad', hint: 'Open risks from the daily checks: serious plus to look at.' },
  { id: 'sdk', label: 'SDK', scale: 'state', hint: 'The Mushi Mushi SDK against its latest release.' },
  { id: 'release', label: 'Release age', scale: 'bad', max: RELEASE_AGE_TOP_DAYS, hint: `Days since the latest release shipped; darkest at ${RELEASE_AGE_TOP_DAYS} days.` },
  { id: 'ci', label: 'CI fails today', scale: 'bad', hint: 'CI job failures since midnight UTC. A lost machine or an expired queue is not counted.' },
  { id: 'checkin', label: 'Last check-in', scale: 'state', hint: 'When the SDK last called Mushi Mushi: under 1 hour live, up to 7 days quiet, then silent.' },
]

const CHECKIN_TONE: Record<AppSignals['checkIn']['freshness'], SignalTone | undefined> = {
  healthy: 'ok',
  stale: 'warn',
  cold: 'danger',
  never: 'off',
  unknown: undefined,
}

/** The grid cells of one app. */
function signalCells(r: AppSignals, now: number): Record<string, HeatCellValue> {
  const bugs = `${r.openBugs.value}${r.openBugs.atLeast ? '+' : ''}`
  const risks: HeatCellValue = r.risks
    ? { value: r.risks.error + r.risks.warn, title: `Risks: ${r.risks.error} serious, ${r.risks.warn} to look at` }
    : { value: null, display: r.card.radar.status === 'error' ? 'failed' : '–', title: `Risks: unknown. ${r.risksNote ?? ''}`.trim() }
  const sdk: HeatCellValue =
    r.sdk === 'behind'
      ? { value: 1, tone: 'warn', display: 'behind', title: `SDK behind: ${r.sdkNote}` }
      : r.sdk === 'current'
        ? { value: 0, tone: 'ok', display: 'latest', title: `SDK: ${r.sdkNote}` }
        : { value: null, tone: 'off', display: '?', title: `SDK unknown: ${r.sdkNote}` }
  const release: HeatCellValue =
    r.releaseAgeDays == null
      ? { value: null, display: 'none', title: r.card.latestRelease ? `Release ${r.card.latestRelease.version}: no ship date` : 'No release recorded' }
      : { value: r.releaseAgeDays, display: `${r.releaseAgeDays}d`, title: `Latest release ${r.card.latestRelease?.version ?? ''} shipped ${r.releaseAgeDays} days ago` }
  const ci: HeatCellValue = r.ciFailsToday
    ? { value: r.ciFailsToday.value, display: `${r.ciFailsToday.value}${r.ciFailsToday.atLeast ? '+' : ''}`, title: `CI failures today: ${r.ciFailsToday.value}${r.ciFailsToday.atLeast ? ' or more' : ''}` }
    : { value: null, title: r.card.unreadable.includes('ci') ? "CI failures today: could not be read" : 'CI failures today: no repo connected, or not known yet' }
  const tone = CHECKIN_TONE[r.checkIn.freshness]
  const checkin: HeatCellValue =
    tone == null
      ? { value: null, title: 'Last SDK check-in: not known' }
      : { value: r.checkIn.at ? 1 : 0, tone, display: shortAge(r.checkIn.at, now), title: r.checkIn.at ? `Last SDK check-in ${shortAge(r.checkIn.at, now)} ago` : 'The SDK has never checked in' }
  return { bugs: { value: r.openBugs.value, display: bugs, title: `Open bugs: ${bugs}` }, risks, sdk, release, ci, checkin }
}

/** A column the grid leaves out because (nearly) no app has a value in it. */
interface SparseColumn {
  id: string
  label: string
  unknown: number
  total: number
  /** The few apps that do have a value: name and what the cell shows. */
  known: Array<{ name: string; shown: string }>
}

const NO_DATA_WORD: Record<string, string> = { release: 'release data', ci: 'CI data', checkin: 'check-in data', sdk: 'SDK data', risks: 'risk data', bugs: 'bug data' }

/**
 * @internal Columns unknown on (nearly) every row: from three apps up, a column with a value
 * on at most a fifth of them (8 of 9 "none" release ages). Exported for tests.
 */
export function sparseColumns(columns: readonly HeatColumn[], rows: readonly HeatRow[]): SparseColumn[] {
  if (rows.length < 3) return []
  const out: SparseColumn[] = []
  for (const col of columns) {
    const known = rows.filter((r) => r.cells[col.id]?.value != null)
    if (known.length > Math.floor(rows.length / 5)) continue
    out.push({
      id: col.id,
      label: col.label,
      unknown: rows.length - known.length,
      total: rows.length,
      known: known.map((r) => ({ name: typeof r.label === 'string' ? r.label : r.id, shown: String(r.cells[col.id]?.display ?? r.cells[col.id]?.value ?? '') })),
    })
  }
  return out
}

/** One app as a stacked block on a narrow screen: the name, then every signal as a labelled cell. */
function StackedApp({ row, columns, maxes, renderLabel }: { row: HeatRow; columns: readonly HeatColumn[]; maxes: number[]; renderLabel: (row: HeatRow) => ReactNode }) {
  const keys = row.keys ?? []
  const link = useLinked(keys, keys[0] ?? row.id, keys.length > 0)
  return (
    <li {...link} className={`${link.className} py-1.5`} data-testid={`signal-stack-${row.id}`}>
      <p className="truncate text-xs font-bold text-fg">{renderLabel(row)}</p>
      {row.sub && <p className="truncate text-3xs text-fg-secondary">{row.sub}</p>}
      <dl className="mt-1 grid grid-cols-3 gap-1">
        {columns.map((col, ci) => {
          const cell = row.cells[col.id]
          const shown = cell?.display ?? (cell?.value == null ? '–' : String(cell.value))
          return (
            <div key={col.id} className="min-w-0">
              <dt className="truncate text-3xs text-fg-secondary">{col.label}</dt>
              <dd
                className={`sig-cell flex h-6 items-center justify-center gap-1 rounded-xs px-1 font-mono text-2xs font-bold tabular-nums ${heatCellClass(col, cell, maxes[ci] ?? 0)}`}
                title={cell?.title}
                data-col={col.id}
              >
                {col.scale === 'state' && cell?.tone && <StatusGlyph tone={cell.tone} className="h-2.5 w-2.5" />}
                {shown}
              </dd>
            </div>
          )
        })}
      </dl>
    </li>
  )
}

export function AppSignalGrid({ rows, now }: { rows: readonly AppSignals[]; now: number }) {
  const byId = new Map(rows.map((r) => [r.card.projectId, r]))
  const heatRows: HeatRow[] = rows.map((r) => ({
    id: r.card.projectId,
    label: r.card.name,
    // No subtitle that repeats a column ("448 open bugs" over the Open bugs cell, 2026-11-18).
    // Only a top problem no column shows (a failing part, a part to fix) is named under the app.
    sub: r.reasons[0] && NO_COLUMN.has(r.reasons[0].id) ? r.reasons[0].title : undefined,
    keys: [appKey(r.card.projectId)],
    cells: signalCells(r, now),
  }))
  const sparse = sparseColumns(COLUMNS, heatRows)
  const hidden = new Set(sparse.map((c) => c.id))
  const columns = COLUMNS.filter((c) => !hidden.has(c.id))
  const maxes = columns.map((c) => columnMax(c, heatRows))
  const renderLabel = (row: HeatRow) => {
    const r = byId.get(row.id)
    return (
      <Link
        to={appLink(r?.reasons[0]?.to ?? '/recipe', row.id)}
        onClick={(e) => {
          // Opening the app is the link's job; the row's click pins it.
          e.stopPropagation()
          openApp(row.id)
        }}
        className="hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {row.label}
      </Link>
    )
  }
  return (
    <div className="@container flex min-w-0 flex-col gap-1.5" data-testid="portfolio-signal">
      <div className="hidden @2xl:block">
        <HeatGrid caption="Apps by signal" columns={columns} rows={heatRows} testId="portfolio-signal-grid" renderLabel={renderLabel} />
      </div>
      <div className="@2xl:hidden">
        <p className="pb-1 text-3xs font-bold tracking-wider text-fg uppercase">Apps by signal</p>
        <ul className="divide-y divide-edge-subtle" data-testid="portfolio-signal-stack">
          {heatRows.map((row) => (
            <StackedApp key={row.id} row={row} columns={columns} maxes={maxes} renderLabel={renderLabel} />
          ))}
        </ul>
      </div>
      {sparse.map((c) => (
        <p key={c.id} className="flex flex-wrap items-center gap-x-1.5 text-2xs text-fg-secondary" data-testid={`portfolio-signal-sparse-${c.id}`}>
          <span className="ci-nodata inline-block h-2 w-3 rounded-xs border border-edge-subtle" aria-hidden="true" />
          <span>
            <span className="font-semibold text-fg">{c.label}:</span> no {NO_DATA_WORD[c.id] ?? 'data'} for {c.unknown} of {c.total} apps
          </span>
          {c.known.map((k) => (
            <span key={k.name} className="font-mono tabular-nums">
              · {k.name} {k.shown}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}
