/**
 * FILE: apps/admin/src/components/release/ReleaseStations.tsx
 * PURPOSE: The release-train picture shared by Home and Fixes: five stations
 *          (fix ready → CI → in train → merged → deployed) with the count at
 *          each and how many are stuck, then the train on the tracks (or the
 *          last one). The same stages and counts as /pipeline.
 */

import { Link } from 'react-router-dom'
import type { ReleaseStation, ReleaseTrainNow } from '../../lib/releaseStations'

const TRAIN_STATE: Record<string, string> = {
  building: 'is being built',
  testing: 'is running CI',
  merged: 'merged',
  failed: 'failed CI',
}

/**
 * A station's `stuck` counts items waiting on a person (a review hold, a
 * failed agent, red CI), the same items Home's Needs you lists, so it says
 * "need you": "82 stuck" read as broken machinery (console sweep 2026-10-29).
 * "all" when every one is: "39" over "39" said the number twice.
 */
function stuckLabel(s: Pick<ReleaseStation, 'count' | 'stuck'>): string {
  return s.stuck >= s.count ? 'all need you' : `${s.stuck} need you`
}

export function ReleaseStations({ stations, href, testId = 'home-release-stations' }: { stations: ReleaseStation[]; href: string; testId?: string }) {
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Fixes on their way to a release" data-testid={testId}>
      {stations.map((s) => (
        // One line per station (2026-11-16, owner: keep it dense): the count,
        // then the name and how many need you. The tall circles-on-a-track
        // took 80px for five numbers. Stations wrap on narrow screens.
        <li key={s.id} className="flex items-center gap-1.5">
          <Link
            to={href}
            aria-label={`${s.label}: ${s.count}${s.stuck ? `, ${stuckLabel(s)}` : ''}`}
            className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm px-1 text-xs font-semibold tabular-nums ${
              s.stuck > 0
                ? 'bg-danger-muted text-danger-foreground'
                : s.count === 0
                  ? 'bg-surface-overlay text-fg-faint'
                  : s.id === 'merged' || s.id === 'deployed'
                    ? 'bg-ok-muted text-ok-foreground'
                    : 'bg-surface-overlay text-fg'
            }`}
          >
            {s.count}
          </Link>
          <span className="leading-tight">
            <span className="block whitespace-nowrap text-2xs font-medium text-fg-secondary">{s.label}</span>
            {s.stuck > 0 && <span className="block whitespace-nowrap text-2xs font-semibold text-danger-foreground">{stuckLabel(s)}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** "Train (PR 902) with 3 fixes is running CI", or the last one, or none this week. */
export function ReleaseTrainLine({ train, href }: { train: ReleaseTrainNow | null; href: string }) {
  if (!train) return <span className="text-fg-muted">No release train this week.</span>
  return (
    <Link to={href} className="hover:underline">
      {train.active ? 'Train' : 'Last train'}
      {train.prNumber ? ` #${train.prNumber}` : ''} with {train.members} {train.members === 1 ? 'fix' : 'fixes'} {TRAIN_STATE[train.state] ?? train.state}
    </Link>
  )
}
