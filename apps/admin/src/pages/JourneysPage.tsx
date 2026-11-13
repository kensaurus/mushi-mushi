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

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { JourneyCanvas } from '../components/journeys/JourneyCanvas'
import { RecordingCard, ScanBar } from '../components/journeys/JourneyControls'
import { FindingsSection, FlowsSection } from '../components/journeys/JourneyFindings'
import { Btn, Callout, EmptyState, ErrorAlert, Section, SegmentedControl, Skeleton, StatCard } from '../components/ui'
import { usePageData } from '../lib/usePageData'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { JOURNEY_DAYS, journeysPath, percent, scoreTone, type JourneyDays, type JourneysData } from '../lib/journeys'

const SCAN_POLL_MS = 4_000

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
        helpHowToUse="Press Scan my site to map your pages (needs a Firecrawl key). Install the SDK to add real visits. Click a page on the map to see its problems. Copy a prompt into Cursor, Claude Code, Lovable or Bolt, or copy them all at once."
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
  const scanRunning = data?.scan?.status === 'running'

  // While a scan runs, refresh until it lands.
  useEffect(() => {
    if (!scanRunning) return
    const t = setInterval(reload, SCAN_POLL_MS)
    return () => clearInterval(t)
  }, [scanRunning, reload])

  if (loading && !data) return <JourneysSkeleton />
  if (error && !data) return <ErrorAlert title="Couldn't load journeys" message={error} onRetry={reload} />
  if (!data) return null

  const { map } = data
  const hasVisits = map.stats.sessions > 0
  const hasScan = data.mapScan != null
  const hasAnything = map.nodes.length > 0

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        <ScanBar data={data} projectId={projectId} onStarted={reload} />
        <RecordingCard data={data} projectId={projectId} onChanged={reload} />
      </div>
      {!hasAnything ? (
        <GettingStarted hasVisits={hasVisits} hasScan={hasScan} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <StatCard label="Journey score" value={`${map.score}`} detail={map.findings.length === 0 ? 'no problems found' : `${map.findings.length} to look at`} accent={scoreTone(map.score) === 'ok' ? 'text-ok' : scoreTone(map.score) === 'warn' ? 'text-warn' : 'text-danger'} hint="100 means no problems found. Each problem lowers it: fix-first ones the most." />
            <StatCard label="Visits" value={map.stats.sessions} detail={hasVisits ? `last ${data.days} days${map.stats.sampled ? ' (latest 20,000 page views)' : ''}` : 'SDK not sending visits'} />
            <StatCard label="Pages per visit" value={map.stats.avgPagesPerSession ?? '—'} detail={`${map.stats.pageViews} page views`} />
            <StatCard label="Leave after one page" value={percent(map.stats.bounceRate)} detail="visits that saw one page" />
            <StatCard label="Pages" value={map.stats.pages} detail={hasScan ? `${data.mapScan!.pageCount} scanned` : 'not scanned yet'} />
          </div>

          {!hasVisits && (
            <Callout tone="info" label="Map from the site scan only">
              Without visits the map shows your links, not what people do. Install the SDK with session tracking on to see real paths, dead ends and pages people leave from. <Link className="text-brand underline" to="/connect">Set up the SDK</Link>
            </Callout>
          )}
          {!hasScan && (
            <Callout tone="info" label="Not scanned yet">
              A site scan finds duplicate pages, pages nothing links to and pages buried too deep. Press Scan my site above.
            </Callout>
          )}

          <Section
            title="Flow map"
            action={<SegmentedControl<JourneyDays> size="sm" value={days} onChange={setDays} ariaLabel="Period" options={JOURNEY_DAYS.map((d) => ({ id: d, label: `${d} days` }))} />}
          >
            <JourneyCanvas map={map} hasScan={hasScan} findings={map.findings} selected={selected} onSelect={setSelected} />
            <MapLegend hasScan={hasScan} />
          </Section>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <FindingsSection findings={map.findings} selected={selected} onClear={() => setSelected(null)} appUrl={data.liveUrl} />
            </div>
            <div className="min-w-0">
              <FlowsSection flows={map.flows} />
            </div>
          </div>
        </>
      )}
    </>
  )
}

function GettingStarted({ hasVisits, hasScan }: { hasVisits: boolean; hasScan: boolean }) {
  return (
    <EmptyState
      title="No journeys to show yet"
      description="The map needs real visits, a site scan, or both."
      hints={[
        hasScan ? 'Site scan: done.' : 'Press Scan my site above to map your public pages (needs a Firecrawl key in Settings → AI keys).',
        hasVisits ? 'Visits: arriving.' : 'Install the Mushi Mushi SDK with session tracking on (trackSessions: true, the default) to see where real people go.',
      ]}
      action={<Btn variant="ghost" to="/connect">Set up the SDK</Btn>}
    />
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
