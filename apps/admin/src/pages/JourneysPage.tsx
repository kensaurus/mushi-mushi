/**
 * FILE: apps/admin/src/pages/JourneysPage.tsx
 * PURPOSE: /journeys — the Journey optimizer (ADR 0058). How people move
 *          through the app and what in the site map gets in their way:
 *          a flow map from real visits and a scan of the live site, with
 *          findings (dead ends, back-and-forth, pages people leave from,
 *          duplicates, orphan and deep pages), each with a suggestion and a
 *          prompt to paste into the coding agent.
 *
 * Data: GET /v1/admin/projects/:id/journeys?days=, POST …/journeys/scan
 *       (api/routes/journeys.ts, served by api-ext).
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { JourneyCanvas } from '../components/journeys/JourneyCanvas'
import { RecordingCard, ScanBar } from '../components/journeys/JourneyControls'
import { FindingsSection, FlowsSection } from '../components/journeys/JourneyFindings'
import { Btn, Callout, Card, EmptyState, ErrorAlert, Section, SegmentedControl, Skeleton, StatCard } from '../components/ui'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageData } from '../lib/usePageData'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { JOURNEY_DAYS, journeyScoreStat, journeySdkState, journeyStartHints, journeysPath, percent, type JourneyDays, type JourneysData } from '../lib/journeys'

const SCAN_POLL_MS = 4_000
const SCORE_ACCENT = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', off: 'text-fg-secondary' } as const
/** Keep checking a scan this long after starting it, even if a refresh fails. */
const SCAN_WATCH_MS = 25 * 60_000

export function JourneysPage() {
  const projectId = useActiveProjectId()
  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="Journey optimizer"
        helpTitle="What is the Journey optimizer?"
        helpWhatIsIt="A map of how people move through your app, built from real visits (the Mushi Mushi SDK) and a scan of your live site. It points out where people get stuck or leave, pages that say the same thing twice, pages nothing links to and pages buried too deep, and tells you what to change."
        helpUseCases={[
          'See the paths people really take from your start page',
          'Find dead ends and pages people leave from',
          'Find duplicate pages and pages nothing links to',
          'Hand each fix to your coding agent as a ready prompt',
        ]}
        helpHowToUse="Install the SDK to see where real people go: that map needs no key. Press Scan my site to also map pages nobody has visited yet (this one needs your own Firecrawl key). Click a page on the map to see its problems. Copy a prompt into Cursor, Claude Code, Lovable or Bolt, or copy them all at once."
        helpFlowPath="/journeys"
      />
      {projectId ? <JourneysBody key={projectId} projectId={projectId} /> : <EmptyState title="No app selected" description="Pick an app at the top to see its journeys." />}
    </div>
  )
}

function JourneysBody({ projectId }: { projectId: string }) {
  const [days, setDays] = useState<JourneyDays>('30')
  const { data, loading, error, reload } = usePageData<JourneysData>(journeysPath(projectId, days), { deps: [days] })
  const [selected, setSelected] = useState<string | null>(null)
  // Whether the SDK is installed, and where it checks in from (shared /setup read).
  const setup = useSetupStatus(projectId)
  const sdk = journeySdkState(setup.data?.projects.find((p) => p.project_id === projectId)?.steps)
  const scanRunning = data?.scan?.status === 'running'
  // When this tab started a scan: polling continues until a scan created
  // after that time has finished, so one failed refresh (which keeps the old
  // data, scan 'done') cannot stop it (seen on Solo Boss Cloud, 2026-11-13).
  const [watchingSince, setWatchingSince] = useState<number | null>(null)
  const ownScanDone =
    watchingSince != null && data?.scan != null && data.scan.status !== 'running' && Date.parse(data.scan.createdAt) >= watchingSince - 60_000
  const watching = watchingSince != null && !ownScanDone
  const onScanStarted = useCallback(() => {
    setWatchingSince(Date.now())
    reload()
  }, [reload])
  useEffect(() => {
    if (watchingSince == null) return
    const t = setTimeout(() => setWatchingSince(null), SCAN_WATCH_MS)
    return () => clearTimeout(t)
  }, [watchingSince])

  // While a scan runs, refresh until it lands.
  useEffect(() => {
    if (!scanRunning && !watching) return
    const t = setInterval(reload, SCAN_POLL_MS)
    return () => clearInterval(t)
  }, [scanRunning, watching, reload])

  if (loading && !data) return <JourneysSkeleton />
  if (error && !data) return <ErrorAlert title="Couldn't load journeys" message={error} onRetry={reload} />
  if (!data) return null

  const { map } = data
  const hasVisits = map.stats.sessions > 0
  const hasScan = data.mapScan != null
  const hasAnything = map.nodes.length > 0
  const score = journeyScoreStat(map.score, map.findings.length, hasScan)

  return (
    <>
      {/* grid-cols-1 + min-w-0 cards: at 390 the one-line hints sized the
          implicit column to their full width and the page scrolled sideways.
          items-start: the collapsed recording card kept its own height instead
          of stretching to the scan card's (round-3 sweep 2026-11-19). */}
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <ScanBar data={data} projectId={projectId} onStarted={onScanStarted} fallbackUrl={sdk.origin} />
        <RecordingCard data={data} projectId={projectId} onChanged={reload} />
      </div>
      {!hasAnything ? (
        <GettingStarted hasVisits={hasVisits} hasScan={hasScan} sdkInstalled={sdk.installed} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <StatCard label="Journey score" value={score.value} detail={score.detail} accent={SCORE_ACCENT[score.tone]} hint="100 means no problems found. Each problem lowers it: fix-first ones the most. It needs a site scan first." />
            <StatCard label="Visits" value={map.stats.sessions} detail={hasVisits ? `last ${data.days} days${map.stats.sampled ? ' (latest 20,000 page views)' : ''}` : 'SDK not sending visits'} />
            <StatCard label="Pages per visit" value={map.stats.avgPagesPerSession ?? '—'} detail={`${map.stats.pageViews} page views`} />
            <StatCard label="Leave after one page" value={percent(map.stats.bounceRate)} detail="visits that saw one page" />
            <StatCard label="Pages" value={map.stats.pages} detail={hasScan ? `${data.mapScan!.pageCount} scanned` : 'from visits only'} />
          </div>

          {!hasVisits && (
            <Callout tone="info" label="Map from the site scan only">
              {sdk.installed ? (
                <>Without visits the map shows your links, not what people do. Your SDK is installed: turn on session tracking (trackSessions: true) to see real paths, dead ends and pages people leave from.</>
              ) : (
                <>
                  Without visits the map shows your links, not what people do. Install the SDK with session tracking on to see real paths, dead ends and pages people leave from.{' '}
                  <Link className="text-brand underline" to="/connect">Set up the SDK</Link>
                </>
              )}
            </Callout>
          )}
          {/* "Not scanned yet" is said by the score tile and by What to improve; no third banner (fresh-eyes 2026-11-18). */}

          {/* The map's labels are small at normal width, so the top paths sit
              beside it as a ranked list (owner, 2026-11-18). */}
          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
              <div className="min-w-0 @4xl:col-span-2">
                <Section
                  title="Flow map"
                  action={<SegmentedControl<JourneyDays> size="sm" value={days} onChange={setDays} ariaLabel="Period" options={JOURNEY_DAYS.map((d) => ({ id: d, label: `${d} days` }))} />}
                >
                  <JourneyCanvas map={map} hasScan={hasScan} findings={map.findings} selected={selected} onSelect={setSelected} />
                  <MapLegend hasScan={hasScan} />
                </Section>
              </div>
              <div className="min-w-0">
                <FlowsSection flows={map.flows} totalSessions={map.stats.sessions} />
              </div>
            </div>
          </div>

          <FindingsSection findings={map.findings} selected={selected} onClear={() => setSelected(null)} appUrl={data.liveUrl} hasScan={hasScan} />
        </>
      )}
    </>
  )
}

/**
 * One plain card (round-2 review): the editorial EmptyState drew a dashed box
 * with a monospace "/"-slash list, and told an app whose SDK was installed to
 * install it.
 */
function GettingStarted({ hasVisits, hasScan, sdkInstalled }: { hasVisits: boolean; hasScan: boolean; sdkInstalled: boolean }) {
  const hints = journeyStartHints({ hasScan, hasVisits, sdkInstalled })
  return (
    <Card className="min-w-0 p-4" data-testid="journeys-getting-started">
      <h2 className="text-sm font-semibold text-fg">No journeys to show yet</h2>
      <p className="mt-0.5 text-xs text-fg-muted">The map needs real visits, a site scan, or both.</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-fg-secondary">
        {hints.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ol>
      {!sdkInstalled && !hasVisits && (
        <Btn variant="ghost" size="sm" className="mt-3" to="/connect">
          Set up the SDK
        </Btn>
      )}
    </Card>
  )
}

function MapLegend({ hasScan }: { hasScan: boolean }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted" aria-label="Map legend">
      <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-1 w-6 rounded-full bg-viz-flow-info" />People moving (thicker = more)</li>
      {hasScan && <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block w-6 border-t-2 border-dashed border-viz-flow-info" />Moved without a link on the page</li>}
      {hasScan && <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block w-6 border-t border-dotted border-fg-faint" />Link nobody used</li>}
      <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-3 rounded-sm border-2 border-danger/70" />Fix first</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-3 rounded-sm border-2 border-warn/70" />Worth fixing</li>
      <li>Click a page to see its problems</li>
    </ul>
  )
}

function JourneysSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading journeys">
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  )
}
