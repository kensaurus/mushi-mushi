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
 * Data: the portfolio cards (lib/appSignals.ts ranks them) and the setup
 * list's SDK check-ins; nothing is read here.
 */

import { Link } from 'react-router-dom'
import { HeatGrid, type HeatCellValue, type HeatColumn, type HeatRow } from '../signal/HeatGrid'
import type { SignalTone } from '../signal/StatusGlyph'
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
  return (
    <HeatGrid
      caption="Apps by signal"
      columns={COLUMNS}
      rows={heatRows}
      testId="portfolio-signal-grid"
      renderLabel={(row) => {
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
      }}
    />
  )
}
