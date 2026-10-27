/**
 * FILE: apps/admin/src/components/releases/ReleaseTimeline.tsx
 * PURPOSE: What did I ship, and were the reporters told? (console journeys
 *          2026-10-27). The page opened on tiles and a form; it now leads
 *          with the app's releases as a timeline, newest first: version,
 *          when it shipped (or that it is still a draft), the fixes in it,
 *          and "N of M reporters told".
 *
 *          "Told" comes from GET /v1/admin/releases?credits=1, which counts
 *          only delivered messages. When the server leaves the summary out
 *          (an older server, or a failed read) the row says so instead of
 *          showing a zero.
 */

import { usePageData } from '../../lib/usePageData'
import { pluralizeWithCount } from '../../lib/format'
import { CHIP_TONE } from '../../lib/chipTone'
import { Badge, Card, ErrorAlert, RelativeTime, Skeleton } from '../ui'

/** @public The list row the timeline reads; the drawer takes the same row. */
export interface TimelineRelease {
  id: string
  version: string
  title: string
  status: 'draft' | 'published'
  published_at: string | null
  created_at: string
  fixed_report_ids: string[]
  credited_reporter_ids: string[]
  credit_summary?: { credited: number; told: number }
}

export const RELEASE_TIMELINE_PATH = '/v1/admin/releases?limit=8&credits=1'

/** @internal Exported for tests. How many reporters heard about this release. */
export function toldText(r: Pick<TimelineRelease, 'status' | 'credit_summary' | 'credited_reporter_ids'>): { text: string; tone: keyof typeof CHIP_TONE } {
  if (r.status === 'draft') {
    const n = r.credited_reporter_ids.length
    return { text: n > 0 ? `${pluralizeWithCount(n, 'reporter')} to tell` : 'No reporters to tell', tone: 'neutral' }
  }
  const s = r.credit_summary
  if (!s) return { text: 'Reporters told: unknown', tone: 'neutral' }
  if (s.credited === 0) return { text: 'No reporters to tell', tone: 'neutral' }
  if (s.told >= s.credited) return { text: `All ${pluralizeWithCount(s.credited, 'reporter')} told`, tone: 'okSubtle' }
  return { text: `${s.told} of ${pluralizeWithCount(s.credited, 'reporter')} told`, tone: 'warnSubtle' }
}

interface Props {
  /** Opens a release in the page's drawer. */
  onOpen: (release: TimelineRelease) => void
}

export function ReleaseTimeline({ onOpen }: Props) {
  const { data, loading, error } = usePageData<TimelineRelease[] | { data: TimelineRelease[] }>(RELEASE_TIMELINE_PATH)
  const releases = !data ? [] : Array.isArray(data) ? data : (data.data ?? [])

  if (error) return <ErrorAlert message={error} />
  if (loading && releases.length === 0) {
    return (
      <Card className="space-y-2 p-4" aria-busy="true" aria-label="Loading releases">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </Card>
    )
  }
  if (releases.length === 0) return null

  return (
    <Card className="p-4" data-testid="release-timeline">
      <h2 className="mb-3 text-sm font-semibold text-fg">What you shipped</h2>
      <ol className="relative ml-1.5 border-l border-edge-subtle">
        {releases.map((r) => {
          const told = toldText(r)
          const fixes = r.fixed_report_ids.length
          const draft = r.status === 'draft'
          return (
            <li key={r.id} className="relative pb-3 pl-4 last:pb-0">
              <span
                aria-hidden="true"
                className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${draft ? 'bg-warn' : 'bg-ok'}`}
              />
              <button
                type="button"
                onClick={() => onOpen(r)}
                className="flex w-full min-w-0 flex-col gap-1 rounded-sm text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-fg">v{r.version.replace(/^v/, '')}</span>
                  <span className="min-w-0 truncate text-xs text-fg-secondary">{r.title}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto sm:shrink-0">
                  <span className="text-2xs text-fg-muted">
                    {draft ? (
                      <>
                        Draft, written <RelativeTime value={r.created_at} />
                      </>
                    ) : (
                      <>
                        Shipped <RelativeTime value={r.published_at ?? r.created_at} />
                      </>
                    )}
                  </span>
                  <Badge tone={fixes > 0 ? 'infoSubtle' : 'neutral'}>{pluralizeWithCount(fixes, 'fix', 'fixes')}</Badge>
                  <Badge tone={told.tone}>{told.text}</Badge>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
