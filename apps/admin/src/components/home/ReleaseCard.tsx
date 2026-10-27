/**
 * FILE: apps/admin/src/components/home/ReleaseCard.tsx
 * PURPOSE: What is shipping and what is waiting, as pictures:
 *            - the release stations and the train on the tracks
 *              (components/release/ReleaseStations, shared with Fixes) and
 *              the version last seen live;
 *            - open bugs waiting for a fix as one bar by severity.
 */

import { Link } from 'react-router-dom'
import { RelativeTime, Section, Skeleton } from '../ui'
import { ReleaseStations, ReleaseTrainLine } from '../release/ReleaseStations'
import { SEVERITIES, SEVERITY_LABEL, type HomeRelease, type HomeSection, type SeverityKey } from '../../lib/projectHome'
import { severityTrafficBg } from '../../lib/severityTraffic'
import { HomeSectionBody } from './HomeSectionBody'

/** The traffic-light fill for a severity ("not rated yet" is the palette's unscored grey). */
function severityBar(s: SeverityKey): string {
  return severityTrafficBg(s === 'unrated' ? 'unscored' : s) ?? 'bg-fg-faint'
}

function severityHref(s: SeverityKey): string {
  return s === 'unrated' ? '/reports?status=open' : `/reports?status=open&severity=${s}`
}

export function ReleaseCard({ section, projectId }: { section: HomeSection<HomeRelease>; projectId: string }) {
  const pipelineHref = `/pipeline?project=${encodeURIComponent(projectId)}`
  return (
    <Section title="Release" id="home-release" action={<Link to={pipelineHref} className="text-xs text-link">Pipeline →</Link>}>
      <HomeSectionBody section={section} what="the release" notConnectedText="Connect your GitHub repo to see fixes move toward a release.">
        {(r) => (
          <div className="space-y-4">
            <ReleaseStations stations={r.stations} href={pipelineHref} />
            <div className="grid gap-2 text-xs text-fg-secondary sm:grid-cols-2">
              <p>
                <ReleaseTrainLine train={r.train} href={pipelineHref} />
              </p>
              <p className="sm:text-right">
                {r.lastDeploy ? (
                  <Link to="/releases" className="hover:underline">
                    {r.lastDeploy.ok ? (r.lastDeploy.version ?? 'A deploy') : 'A deploy check failed'} seen live <RelativeTime value={r.lastDeploy.at} />
                  </Link>
                ) : (
                  <span className="text-fg-muted">No deploy seen yet.</span>
                )}
              </p>
            </div>
            <WaitingBar waiting={r.waiting} error={r.waitingError} />
          </div>
        )}
      </HomeSectionBody>
    </Section>
  )
}

function WaitingBar({ waiting, error }: { waiting: HomeRelease['waiting']; error: string | null }) {
  if (!waiting) {
    return <p className="text-xs text-danger-foreground">Could not count the bugs waiting{error ? `: ${error}` : ''}.</p>
  }
  const parts = SEVERITIES.filter((s) => waiting.counts[s] > 0)
  return (
    <div data-testid="home-release-waiting">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Link to="/reports?status=open" className="text-xs font-medium text-fg hover:underline">
          {waiting.total} {waiting.total === 1 ? 'bug' : 'bugs'} waiting for a fix
        </Link>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-overlay" role="img" aria-label={parts.map((s) => `${SEVERITY_LABEL[s]} ${waiting.counts[s]}`).join(', ') || 'None waiting'}>
        {parts.map((s) => (
          <span key={s} className={severityBar(s)} style={{ width: `${(waiting.counts[s] / waiting.total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {SEVERITIES.map((s) => (
          <li key={s}>
            <Link to={severityHref(s)} className="inline-flex items-center gap-1.5 text-2xs text-fg-secondary hover:text-fg">
              <span aria-hidden className={`h-2 w-2 rounded-full ${severityBar(s)}`} />
              {SEVERITY_LABEL[s]} <span className="tabular-nums font-medium text-fg">{waiting.counts[s]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ReleaseSkeleton() {
  return (
    <Section title="Release">
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-full" />
      </div>
    </Section>
  )
}
