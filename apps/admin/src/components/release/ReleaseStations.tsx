/**
 * FILE: apps/admin/src/components/release/ReleaseStations.tsx
 * PURPOSE: The release-train picture shared by Home and Fixes: five stations
 *          (fix ready → CI → in train → merged → deployed) with the count at
 *          each and how many are stuck, then the train on the tracks (or the
 *          last one). The same stages and counts as /pipeline.
 */

import { Link } from 'react-router-dom'
import { Badge } from '../ui'
import type { ReleaseStation, ReleaseTrainNow } from '../../lib/releaseStations'

const TRAIN_STATE: Record<string, string> = {
  building: 'is being built',
  testing: 'is running CI',
  merged: 'merged',
  failed: 'failed CI',
}

/** "all stuck" when every one is: "39" over "39 stuck" said the number twice (console sweep). */
function stuckLabel(s: Pick<ReleaseStation, 'count' | 'stuck'>): string {
  return s.stuck >= s.count ? 'all stuck' : `${s.stuck} stuck`
}

export function ReleaseStations({ stations, href, testId = 'home-release-stations' }: { stations: ReleaseStation[]; href: string; testId?: string }) {
  return (
    <ol className="grid grid-cols-5" aria-label="Fixes on their way to a release" data-testid={testId}>
      {stations.map((s, i) => (
        <li key={s.id} className="relative flex min-w-0 flex-col items-center gap-1 px-0.5 text-center">
          {/* The track to the next station, from this circle's centre to the next one's. */}
          {i < stations.length - 1 && <span aria-hidden className="absolute left-1/2 top-4 h-px w-full bg-edge" />}
          <Link
            to={href}
            aria-label={`${s.label}: ${s.count}${s.stuck ? `, ${stuckLabel(s)}` : ''}`}
            className={`relative flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${
              s.stuck > 0
                ? 'border-danger/50 bg-danger-muted text-danger-foreground'
                : s.count === 0
                  ? 'border-edge-subtle bg-surface text-fg-faint'
                  : s.id === 'merged' || s.id === 'deployed'
                    ? 'border-ok/40 bg-ok-muted text-ok-foreground'
                    : 'border-edge bg-surface-overlay text-fg'
            }`}
          >
            {s.count}
          </Link>
          <span className="w-full truncate text-2xs text-fg-secondary">{s.label}</span>
          {s.stuck > 0 && <Badge tone="dangerSubtle">{stuckLabel(s)}</Badge>}
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
