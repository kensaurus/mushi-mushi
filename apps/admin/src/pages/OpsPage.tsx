/**
 * OpsPage — /ops, "Ops" (docs/execplans/ops-hub-slack.md §5).
 *
 * Every app's operational events in one place: payments, releases and
 * alerts, whether an app sent them (POST /v1/ops/events with its ops key)
 * or Mushi Mushi saw them itself (production deploys, Sentry, edge
 * canaries). Worst first: today's counts with open alerts, then which app
 * is silent (the coverage matrix), then the feed with its threads.
 * Slack is the alert; this page is the record (Slack's free plan keeps 90
 * days).
 *
 * Data: GET /v1/admin/ops/coverage?org= (today, matrix, mutes, bot on/off)
 *       GET /v1/admin/ops/events?org=&project=&category=&severity=&unacked=1&before=
 *       POST /v1/admin/ops/events/:id/ack
 * Filters live in the URL (?app=&category=&severity=&unacked=1); `?event=`
 * (the Slack button "Open in Mushi Mushi") highlights one event.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PageLoadError } from '../components/PageLoadError'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Btn, Callout, EmptyState, FilterSelect, Loading, Section, Toggle } from '../components/ui'
import { IconAlertTriangle, IconBell, IconGauge, IconRefresh } from '../components/icons'
import { OpsCoverageMatrix, OpsTodayStrip } from '../components/ops/OpsCoverage'
import { OpsFeed } from '../components/ops/OpsFeed'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { usePageData } from '../lib/usePageData'
import { apiFetch, apiFetchMutate } from '../lib/supabase'
import { usePublishPageContext } from '../lib/pageContext'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { docsUrl } from '../lib/docsUrl'
import { LINK_ACCENT } from '../lib/chipTone'
import { useNow } from '../lib/useNow'
import { useToast } from '../lib/toast'
import { opsAppName, paymentsToday } from '../lib/opsView'
import type { OpsCoverageResponse, OpsEvent, OpsFeedResponse } from '../lib/opsTypes'

const CATEGORY_OPTIONS = ['payments', 'releases', 'alerts'] as const
const SEVERITY_OPTIONS = ['urgent', 'warn', 'info', 'resolved'] as const
const HINT = 'mb-2 max-w-prose text-xs text-fg-muted'

/** The feed's query string for the current filters. */
export function opsFeedPath(orgId: string, params: URLSearchParams, before?: string | null): string {
  const q = new URLSearchParams({ org: orgId, limit: '50' })
  const app = params.get('app')
  const category = params.get('category')
  const severity = params.get('severity')
  if (app) q.set('project', app)
  if (category && (CATEGORY_OPTIONS as readonly string[]).includes(category)) q.set('category', category)
  if (severity && (SEVERITY_OPTIONS as readonly string[]).includes(severity)) q.set('severity', severity)
  if (params.get('unacked') === '1') q.set('unacked', '1')
  if (before) q.set('before', before)
  return `/v1/admin/ops/events?${q.toString()}`
}

export function OpsPage() {
  const orgId = useActiveOrgId()
  const [params, setParams] = useSearchParams()
  const now = useNow(30_000)
  const toast = useToast()
  const coverage = usePageData<OpsCoverageResponse>(orgId ? `/v1/admin/ops/coverage?org=${encodeURIComponent(orgId)}` : null, { scope: 'enumeration' })
  const feedPath = orgId ? opsFeedPath(orgId, params) : null
  const feed = usePageData<OpsFeedResponse>(feedPath, { scope: 'enumeration' })
  const [older, setOlder] = useState<{ path: string | null; events: OpsEvent[]; next: string | null }>({ path: null, events: [], next: null })
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [acking, setAcking] = useState<ReadonlySet<string>>(new Set())

  // Older pages belong to one filter set; a new filter starts from the newest page again.
  const olderEvents = older.path === feedPath ? older.events : []
  const nextBefore = older.path === feedPath && older.events.length > 0 ? older.next : (feed.data?.nextBefore ?? null)
  const events = useMemo(() => [...(feed.data?.events ?? []), ...olderEvents], [feed.data, olderEvents])
  const apps = feed.data?.apps ?? coverage.data?.apps ?? []

  const setFilter = useCallback(
    (key: string, value: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        next.delete('event')
        return next
      }),
    [setParams],
  )

  const loadOlder = useCallback(async () => {
    if (!orgId || !nextBefore || !feedPath) return
    setLoadingOlder(true)
    const res = await apiFetch<OpsFeedResponse>(opsFeedPath(orgId, params, nextBefore), { scope: 'enumeration', cache: 'no-store' })
    setLoadingOlder(false)
    if (!res.ok || !res.data) {
      toast.error(res.error?.message ?? 'Could not load older events.')
      return
    }
    const page = res.data
    setOlder((cur) => ({ path: feedPath, events: [...(cur.path === feedPath ? cur.events : []), ...page.events], next: page.nextBefore }))
  }, [orgId, nextBefore, feedPath, params, toast])

  const ackMany = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      setAcking((cur) => new Set([...cur, ...ids]))
      const results = await Promise.all(
        ids.map((id) => apiFetchMutate<{ id: string }>(`/v1/admin/ops/events/${encodeURIComponent(id)}/ack`, { method: 'POST', scope: 'enumeration' }).then((res) => ({ id, res }))),
      )
      setAcking((cur) => {
        const next = new Set(cur)
        for (const id of ids) next.delete(id)
        return next
      })
      const done = new Set(results.filter((r) => r.res.ok).map((r) => r.id))
      const failed = results.find((r) => !r.res.ok)
      if (failed) toast.error(failed.res.error?.message ?? (ids.length > 1 ? 'Could not acknowledge every event.' : 'Could not acknowledge that event.'))
      if (done.size === 0) return
      const at = new Date().toISOString()
      setOlder((cur) => ({ ...cur, events: cur.events.map((e) => (done.has(e.id) ? { ...e, acked_at: at } : e)) }))
      feed.reload()
      coverage.reload()
    },
    [feed, coverage, toast],
  )
  const ack = useCallback((id: string) => ackMany([id]), [ackMany])

  const reloadAll = useCallback(() => {
    feed.reload()
    coverage.reload()
  }, [feed, coverage])

  usePublishPageContext({
    route: '/ops',
    title: 'Ops',
    summary: coverage.data
      ? `Today: payments ${paymentsToday(coverage.data.today.payments)}, ${coverage.data.today.releases} releases, ${coverage.data.today.openAlerts} open alerts`
      : coverage.error
        ? "Ops couldn't load"
        : 'Loading Ops',
    questions: ['Which app has not reported in?', 'What sold today?', 'Which alerts are still open?'],
  })

  const pending = coverage.errorCode === 'MIGRATION_PENDING' || feed.errorCode === 'MIGRATION_PENDING'
  const appOptions = apps.map((a) => a.id)
  const appName = (id: string) => opsAppName(apps.find((a) => a.id === id))

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-ops">
      <PageHeaderBar
        title="Ops"
        icon={<IconBell />}
        description="Payments, releases and alerts from every app, in one place, and in your team's Slack."
        helpTitle="About Ops"
        helpWhatIsIt="Each app sends its payments, releases and alerts to Mushi Mushi with its own ops key; Mushi Mushi also adds production deploys, Sentry errors and site checks it already sees. Everything is kept here and posted to your team's Slack with your own bot, which threads follow-ups and answers a slash command."
        helpHowToUse="Start at the top: open alerts, then the apps that never reported (hatched). Acknowledge an alert here or in Slack; both show it as seen."
      >
        <Btn size="sm" variant="ghost" onClick={reloadAll} aria-label="Refresh" title="Read the latest events now" aria-busy={(feed.isValidating && !feed.loading) || undefined}>
          <IconRefresh size={14} className={feed.isValidating && !feed.loading ? 'motion-safe:animate-spin' : ''} />
        </Btn>
      </PageHeaderBar>

      {!orgId && <EmptyState title="Pick a team" description="Ops shows one team's apps at a time. Choose a team in the switcher at the top of the sidebar." />}

      <PagePosture
        slots={[
          {
            id: 'ops-migration',
            priority: POSTURE_PRIORITY.status,
            show: pending,
            children: (
              <Callout tone="warn" label="Waiting for a database update">
                Ops starts working once database update 20261117120000_ops_hub is applied.
              </Callout>
            ),
          },
          {
            id: 'ops-slack-off',
            priority: POSTURE_PRIORITY.status,
            show: Boolean(coverage.data && !coverage.data.slack.enabled),
            children: (
              <Callout tone="info" label="Slack bot is off">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>Events are kept here only. Connect your team's own Slack bot to get them in #payments, #releases and #alerts, with buttons and a slash command.</span>
                  <Link to="/settings?tab=slack-bot" className={`font-medium ${LINK_ACCENT}`}>
                    Connect the Slack bot
                  </Link>
                </span>
              </Callout>
            ),
          },
        ]}
      />

      {!pending && coverage.error && <PageLoadError error={coverage.error} resource="Ops" endpoint="/v1/admin/ops/coverage" onRetry={coverage.reload} />}
      {orgId && coverage.loading && !coverage.data && <Loading text="Reading your apps…" />}

      {coverage.data && (
        <>
          <Section title="Today" id="ops-today" icon={<IconAlertTriangle />}>
            <OpsTodayStrip data={coverage.data} />
          </Section>
          <Section title="Is every app reporting?" id="ops-coverage" icon={<IconGauge />}>
            <p className={HINT}>When each app last sent each kind of event. A hatched row has never sent one: give that app its ops key.</p>
            <OpsCoverageMatrix data={coverage.data} now={now} />
          </Section>
        </>
      )}

      {orgId && !pending && (
        <Section title="Feed" id="ops-feed" icon={<IconBell />}>
          <div className="mb-2 flex flex-wrap items-end gap-2" data-testid="ops-filters">
            <FilterSelect label="apps" options={appOptions} optionLabel={appName} value={params.get('app') ?? ''} onChange={(e) => setFilter('app', e.target.value)} />
            <FilterSelect label="kinds" options={CATEGORY_OPTIONS} value={params.get('category') ?? ''} onChange={(e) => setFilter('category', e.target.value)} />
            <FilterSelect label="severities" options={SEVERITY_OPTIONS} value={params.get('severity') ?? ''} onChange={(e) => setFilter('severity', e.target.value)} />
            <Toggle label="Only not acknowledged" checked={params.get('unacked') === '1'} onChange={(on) => setFilter('unacked', on ? '1' : '')} />
          </div>
          {feed.error && !pending && <PageLoadError error={feed.error} resource="the Ops feed" endpoint={feedPath ?? undefined} onRetry={feed.reload} />}
          {feed.loading && !feed.data && <Loading text="Reading events…" />}
          {feed.data && events.length === 0 && (
            <EmptyState
              title="No events yet"
              description="Give an app its ops key (Projects → Ops key) and send one event, or connect GitHub deployments and Sentry: Mushi Mushi adds those itself."
              action={
                <Btn size="sm" variant="ghost" href={docsUrl('/integrations/ops-hub')}>
                  How to send events
                </Btn>
              }
            />
          )}
          {events.length > 0 && (
            <OpsFeed events={events} apps={apps} now={now} canAck={feed.data?.canAck ?? false} acking={acking} onAck={(id) => void ack(id)} onAckMany={(ids) => void ackMany(ids)} focusId={params.get('event')} />
          )}
          {nextBefore && (
            <div className="mt-2 flex justify-center">
              <Btn size="sm" variant="ghost" loading={loadingOlder} onClick={() => void loadOlder()}>
                Show older events
              </Btn>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
