/**
 * FILE: ProjectsSnapshotStrip.tsx
 * PURPOSE: Workspace KPI strip for the Projects hub: one flat row of figures (fresh-eyes review
 *          2026-11-18; it was six tiles inside a card, one of them "Viewing <app>", which is not
 *          a number). Figures wrap as a row, so a phone never shows an empty grid cell. The
 *          app being viewed is the header switcher's job.
 */

import { Card, InfoHint } from '../ui'
import type { ProjectsStats } from './types'

interface Props {
  stats: ProjectsStats
}

interface Figure {
  label: string
  value: string | number
  accent?: string
  hint: string
}

/** @internal Exported for tests. */
export function projectsSnapshotFigures(stats: ProjectsStats): Figure[] {
  return [
    { label: 'Projects', value: stats.projectCount, hint: 'Apps or environments tracked' },
    {
      label: 'Ingesting',
      value: stats.projectsWithReports,
      accent: stats.projectsWithReports > 0 ? 'text-ok-foreground' : 'text-warn-foreground',
      hint: `${stats.neverIngestedCount} never received a report`,
    },
    {
      label: 'SDK connected',
      value: stats.projectCount > 0 ? `${stats.sdkConnectedCount}/${stats.projectCount}` : stats.sdkConnectedCount,
      accent:
        stats.sdkConnectedCount > 0 && stats.sdkConnectedCount === stats.projectCount
          ? 'text-ok-foreground'
          : stats.sdkConnectedCount > 0 || stats.projectsWithReports > 0
            ? 'text-warn-foreground'
            : undefined,
      hint: 'Projects whose SDK key checked in',
    },
    { label: 'Active keys', value: stats.activeKeyCount, hint: `${stats.staleKeyCount} never seen` },
    { label: 'Reports · 24h', value: stats.reportsLast24h, hint: `${stats.reportsLast30d} in 30 days` },
  ]
}

export function ProjectsSnapshotStrip({ stats }: Props) {
  return (
    <Card className="px-3 py-2" data-testid="projects-snapshot">
      <dl className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Projects snapshot">
        {projectsSnapshotFigures(stats).map((f) => (
          <div key={f.label} className="min-w-0" data-testid={`projects-snapshot-${f.label}`}>
            <dt className="flex items-center gap-1 text-2xs whitespace-nowrap text-fg-muted">
              {f.label}
              <InfoHint content={f.hint} />
            </dt>
            <dd className={`font-mono text-lg font-bold tabular-nums ${f.accent ?? 'text-fg'}`}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
