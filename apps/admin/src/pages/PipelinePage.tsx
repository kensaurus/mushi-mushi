/**
 * PipelinePage — /pipeline, "Pipeline".
 *
 * Every bug from report to deploy as one picture: Reported → Triaged → Fix
 * PR → Reviewed → CI → Release train → Merged → Deployed, one segmented bar
 * (2026-11-18) where only the jam takes a colour (lib/pipelineSignals.ts).
 * Each stage shows how many items sit in it, how many are stuck and the
 * oldest one's age; under it, how long the stuck work has waited (0–3 d,
 * 3–7 d, 7–30 d, 30 d+; the server's per-group `ages`). Each stuck group
 * has one primary button and a "More" menu for the rest.
 * A status line names the biggest stuck group and offers its first action
 * the server would take. Below, the stuck groups in plain words ("12 PRs:
 * their own CI is red"), each with its items, their evidence and only the
 * fixes the server would not refuse (the rest disabled, with the reason);
 * then the release trains of the last 7 days per repo, who opens fixes
 * (folded), and what intake and deploys report.
 *
 * Scope follows the header switcher (lib/projectScope.ts): one app, or "All
 * apps". Every action asks first, shows its busy state and each PR's
 * result, then the page reads again.
 *
 * The Workers tab (`?tab=workers`, ADR 0048) shows the local workers
 * (`mushi work --daemon`) and their lanes, queues and runs: WorkersPanel.
 *
 * Data: GET /v1/admin/pipeline?projectId= → PipelineData (api-ext)
 *       GET /v1/admin/work/lanes (your lanes, for "Send to my local worker")
 *       POST /v1/admin/pipeline/actions, /v1/admin/fixes/:id/review,
 *       /v1/admin/fixes/:id/ci/rerun, /v1/admin/merge-queue (lib/pipeline.ts)
 */

import { agentCreditsTitle, useAgentCredits } from '../lib/agentCredits'
import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PageLoadError } from '../components/PageLoadError'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Btn, Callout, Loading, PageStatus, Section, SegmentedControl, type PageStatusMetrics } from '../components/ui'
import { StackedShareBar } from '../components/charts/StackedShareBar'
import { IconAlertTriangle, IconBolt, IconNetwork, IconReleases, IconShieldCheck } from '../components/icons'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useProjectScope, useSetProjectScopeMode } from '../lib/projectScope'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { useNow } from '../lib/useNow'
import { useToast } from '../lib/toast'
import { FunnelLegend, PipelineFunnel } from '../components/pipeline/PipelineFunnel'
import { PipelineGroups } from '../components/pipeline/PipelineGroups'
import { PipelineActionDialog, type PendingAction } from '../components/pipeline/PipelineActionDialog'
import { TrainHistory } from '../components/pipeline/TrainHistory'
import { FixOpeners } from '../components/pipeline/FixOpeners'
import { WorkersPanel } from '../components/pipeline/WorkersPanel'
import { WorkerFlagsStrip } from '../components/pipeline/WorkerFlags'
import { LANES_PATH, type WorkLanesData } from '../lib/workers'
import { groupPrimary, needYouAges, needsYouCount, stuckAges } from '../lib/pipelineSignals'
import { StuckAgeBar } from '../components/signal/StuckAgeBar'
import {
  ACTION_META,
  ageLabel,
  openerSplit,
  openerSummary,
  outcomeSummary,
  pipelinePaceFigures,
  retryTrains,
  runPipelineAction,
  type ActionOutcome,
  type PipelineAction,
  type PipelineData,
  type PaceFigures,
  type PipelineGroup,
} from '../lib/pipeline'
import { COUNT_HINTS } from '../lib/countDefinitions'

type Scope = 'project' | 'all'
const SCOPE_OPTIONS = [
  { id: 'project', label: 'This app' },
  { id: 'all', label: 'All apps' },
] as const

type Tab = 'pipeline' | 'workers'
const TAB_OPTIONS = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'workers', label: 'Workers' },
] as const

export function PipelinePage() {
  const projectId = useActiveProjectId()
  const scopeChoice: Scope = useProjectScope().mode
  const setScopeChoice = useSetProjectScopeMode()
  const scope: Scope = projectId ? scopeChoice : 'all'
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'workers' ? 'workers' : 'pipeline'
  const setTab = useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(searchParams)
      if (next === 'pipeline') params.delete('tab')
      else params.set('tab', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )
  const path = scope === 'project' && projectId ? `/v1/admin/pipeline?projectId=${encodeURIComponent(projectId)}` : '/v1/admin/pipeline'
  const page = usePageData<PipelineData>(tab === 'pipeline' ? path : null, { scope: scope === 'all' ? 'enumeration' : 'project' })
  const { data, reload } = page
  // Your own worker lanes, for "Send to my local worker" on report groups.
  const lanesPage = usePageData<WorkLanesData>(tab === 'pipeline' ? LANES_PATH : null, { scope: 'enumeration' })
  const workerLanes = useMemo(() => {
    const d = lanesPage.data
    if (!d || !Array.isArray(d.hosts) || !Array.isArray(d.lanes)) return []
    const mine = new Set(d.hosts.filter((h) => h.mine && !h.revoked).map((h) => h.id))
    // Only lanes that fix reports take a sent report (a conflicts, audit or skill lane would not).
    return d.lanes.filter((l) => mine.has(l.hostId) && l.config.mode === 'fix')
  }, [lanesPage.data])
  const workerFlags = useMemo(() => (Array.isArray(lanesPage.data?.flags) ? lanesPage.data.flags : []), [lanesPage.data])
  const workersHref = useMemo(() => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'workers')
    return `/pipeline?${next.toString()}`
  }, [searchParams])
  const tabOptions = useMemo(
    () => (workerFlags.length ? TAB_OPTIONS.map((o) => (o.id === 'workers' ? { ...o, label: `Workers (${workerFlags.length} problem${workerFlags.length === 1 ? '' : 's'})` } : o)) : TAB_OPTIONS),
    [workerFlags],
  )
  const now = useNow(30_000)
  const toast = useToast()

  const [stage, setStage] = useState<string | null>(null)
  const [pending, setPending] = useState<{ action: PendingAction; key: string } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [results, setResults] = useState<Map<string, ActionOutcome>>(new Map())
  // One app's queue, or every app with a train (`projectIds` holds all of them, `repo` the summary).
  const [trainAsk, setTrainAsk] = useState<{ projectIds: string[]; repo: string } | null>(null)
  const [trainBusy, setTrainBusy] = useState<string | null>(null)
  const [trainResults, setTrainResults] = useState<Map<string, ActionOutcome>>(new Map())

  const projectNames = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, p.name])), [data])
  const stages = data?.stages ?? []
  // One count with Home's "Needs you" (lib/pipelineSignals.ts needsYouCount, the server's
  // buildNeedsYou rule): every stuck group, the backlog "triaged over 3 days ago, no fix
  // started" included. This page said "Nothing needs you now" (0) while it listed that group
  // and Home said 2 (round-2 review, 2026-11-18). The backlog stays uncoloured on the stage bar
  // and only makes the status amber; red is for work that failed.
  const counted = useMemo(() => needsYouCount(stages), [stages])
  const needYou = counted.total
  const stuckTotal = needYou
  const groups = useMemo(() => {
    if (stage) return stages.find((s) => s.id === stage)?.groups ?? []
    return stages.flatMap((s) => s.groups.filter((g) => g.tone === 'stuck')).sort((a, b) => b.count - a.count)
  }, [stages, stage])
  const showApp = scope === 'all'
  // The biggest stuck group and the first of its actions the server would take.
  // Failed work first; the backlog's group only when nothing else is stuck.
  const top = useMemo(
    () => topStuck(stages.filter((s) => s.id !== 'triaged').flatMap((s) => s.groups)) ?? topStuck(stages.flatMap((s) => s.groups)),
    [stages],
  )
  const openers = useMemo(() => (data?.dispatchers ? openerSummary(data.dispatchers) : null), [data])
  const openerParts = useMemo(() => (data?.dispatchers ? openerSplit(data.dispatchers) : null), [data])
  // How fast fixes land and how long the waiting bugs take at that pace (2026-11-16).
  const pace = useMemo(() => (data ? pipelinePaceFigures(data.stages, data.dispatchers) : null), [data])
  // How long the stuck work has waited; "Need you" adds up to the status line's count.
  const ages = useMemo(() => needYouAges(stuckAges(stages, now)), [stages, now])
  // "Nothing is stuck" was false while no agent could open a fix (audit
  // 2026-11-11: next to "Who opens fixes: nobody" and "credits idle").
  const agentCredits = useAgentCredits()
  // Only when bugs wait for a fix: a quiet app with no bugs opens nothing, and that is fine.
  const autofixApps = (data?.dispatchers ?? []).filter((d) => d.autofixOn)
  const waitingForFix = (data?.stages ?? []).find((s) => s.id === 'triaged')?.count ?? 0
  // Reports the API refused (400) in 7 days: lost data, so it leads the status, not the page's last card.
  const rejectedTotal = (data?.intake?.apps ?? []).reduce((n, a) => n + a.rejected, 0)
  const nothingOpens =
    waitingForFix > 0 &&
    (agentCredits.state?.out === true ||
      (autofixApps.length > 0 && autofixApps.every((d) => d.server.dispatches24h === 0 && d.local.runs24h === 0)))

  // Each number once: "Waiting for a fix" is the Triaged stage's count and "Merged, 7 days" the
  // pace row's, so the status does not repeat them. Who opens fixes and intake rejections were calm
  // cards at the bottom; they need you, so they lead, and only when they are not zero (2026-11-18).
  const nobodyApps = waitingForFix > 0 ? (openers?.nobody ?? 0) : 0
  const statusMetrics = [
    { label: 'Need you', value: needYou, tone: counted.failing > 0 ? 'danger' : needYou > 0 ? 'warn' : 'neutral', hint: `${COUNT_HINTS.stuck} Includes bugs triaged over 3 days ago with no fix started, as Home counts them.` },
    ...(nobodyApps > 0
      ? [{ label: 'Apps no one fixes, 24 h', value: nobodyApps, tone: 'warn', hint: 'Apps where neither the cloud agent nor your local worker started a fix in the last 24 hours, while bugs wait for one.' }]
      : []),
    ...(rejectedTotal > 0
      ? [{ label: 'Rejected at intake, 7 d', value: rejectedTotal, tone: 'danger', hint: 'Reports your app sent that the API refused (HTTP 400): they never reached the queue.' }]
      : []),
  ] as unknown as PageStatusMetrics

  usePublishPageContext({
    route: '/pipeline',
    title: 'Pipeline',
    // The Workers tab never loads the pipeline, so it must not say it is loading it.
    summary:
      tab === 'workers'
        ? 'Local workers'
        : data
          ? `${needYou} items need you; ${waitingForFix} bugs wait for a fix`
          : page.error
            ? "The pipeline couldn't load"
            : 'Loading the pipeline',
    questions: ['Why are my fixes not merging?', 'Which PRs are stuck, and why?', 'Why do my release trains keep failing?'],
  })

  const confirmAction = useCallback(
    async (reason: string | undefined) => {
      if (!pending) return
      const { action, key } = pending
      setBusyKey(key)
      try {
        const out = await runPipelineAction(action.action, action.fixIds, reason, action.reportIds)
        setResults((prev) => {
          const next = new Map(prev)
          for (const r of out) next.set(r.id, r)
          return next
        })
        const anyOk = out.some((r) => r.ok)
        if (anyOk) toast.success(outcomeSummary(out))
        else toast.error(outcomeSummary(out))
      } finally {
        setBusyKey(null)
        setPending(null)
        reload()
      }
    },
    [pending, reload, toast],
  )

  const confirmTrain = useCallback(async () => {
    if (!trainAsk) return
    const all = trainAsk.projectIds.length > 1
    setTrainBusy(all ? 'all' : trainAsk.projectIds[0]!)
    try {
      const out: ActionOutcome[] = []
      for (const pid of trainAsk.projectIds) out.push(...(await retryTrains(pid)))
      setTrainResults((prev) => {
        const next = new Map(prev)
        for (const r of out) next.set(r.id, r)
        return next
      })
      if (all) {
        const left = out.filter((r) => r.ok).length
        ;(left > 0 ? toast.success : toast.info)(`${left} of ${out.length} queues sent a train; each row says why the others did not.`)
      } else {
        const mine = out.find((r) => r.id === trainAsk.repo) ?? out[0]
        if (mine) (mine.ok ? toast.success : toast.info)(mine.message)
      }
    } finally {
      setTrainBusy(null)
      setTrainAsk(null)
      reload()
    }
  }, [trainAsk, reload, toast])

  const rejectedOf = (projectId: string) => data?.intake?.apps.find((a) => a.projectId === projectId)?.rejected ?? 0
  const sinceLabel = (since: string) => new Date(`${since}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const intakeRow = (p: PipelineData['projects'][number]) => {
    if (!data) return null
    const rej = data.intake?.apps.find((a) => a.projectId === p.id)
    return (
      <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-fg-muted" data-testid={`pipeline-intake-${p.id}`}>
        <span className="text-fg-secondary">{p.name}:</span>
        {data.intake &&
          (rej && rej.rejected > 0 ? (
            <span className="font-medium text-danger-foreground" data-testid={`pipeline-intake-${p.id}-rejected`}>
              {rej.rejected} rejected ({rej.byReason.slice(0, 3).map((r) => `${r.reason} ×${r.count}`).join(', ')}
              {rej.sdkPackages.length > 0 && `; sent by ${rej.sdkPackages.join(', ')}`}) ·
            </span>
          ) : (
            <span className="text-ok-foreground" data-testid={`pipeline-intake-${p.id}-rejected`}>
              0 rejected since {sinceLabel(data.intake.since)} ·
            </span>
          ))}
        {p.lastDeploy ? (
          <span>
            last deploy seen {ageLabel(p.lastDeploy.at, now)} ago{p.lastDeploy.version ? ` (${p.lastDeploy.version})` : ''}
            {!p.lastDeploy.ok && ' and it failed'}
          </span>
        ) : (
          <span>no deploy recorded in 14 days</span>
        )}
      </li>
    )
  }

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-pipeline">
      <PageHeaderBar
        title="Pipeline"
        icon={<IconNetwork />}
        description="Every bug from report to deploy, where it is stuck, and the fix."
        helpTitle="About the pipeline"
        helpWhatIsIt="Each bug moves from a report to a fix PR, an Opus review, CI, a release train, a merge and a deploy. This page shows how many are in each step now, which are stuck, and why."
        helpHowToUse="Start with the coloured stage: ▲ red is the bottleneck, ◆ amber is nearly as stuck; the rest show their stuck count in plain ink. The age bar shows how long stuck work has waited. In the stuck groups, ▲ marks the one to start with, a red edge means something failed and ◆ means it is slow or waiting. Groups that take the same fix sit under one heading with one button for all of them. Open a group to see its PRs with the failing checks or review findings; More holds the rest (re-run, close with a reason). Every action asks first."
      >
        {tab === 'workers' ? null : page.isValidating && !page.loading ? (
          <span className="text-2xs text-fg-muted">Updating…</span>
        ) : data ? (
          <span className="text-2xs tabular-nums text-fg-muted" data-testid="pipeline-updated">
            {/* Under a minute reads "just now", never "0 min ago" (2026-11-18). */}
            {now - Date.parse(data.generatedAt) < 60_000 ? 'Updated just now' : `Updated ${ageLabel(data.generatedAt, now)} ago`}
          </span>
        ) : null}
        {tab === 'pipeline' && (
          <Btn size="sm" variant="ghost" onClick={reload} disabled={page.isValidating} data-testid="pipeline-refresh">
            Refresh
          </Btn>
        )}
        {projectId && <SegmentedControl<Scope> value={scope} options={SCOPE_OPTIONS} onChange={setScopeChoice} ariaLabel="Which apps" size="sm" />}
      </PageHeaderBar>

      {/* A local worker that stopped doing useful work is loud here too: the Workers tab is not the default. */}
      {tab === 'pipeline' && <WorkerFlagsStrip flags={workerFlags} workersHref={workersHref} />}

      <SegmentedControl<Tab> value={tab} options={tabOptions} onChange={setTab} ariaLabel="Pipeline or local workers" size="md" className="self-start" />

      {tab === 'workers' && <WorkersPanel projectId={scope === 'project' ? projectId : null} now={now} />}

      {tab === 'pipeline' && page.error && <PageLoadError error={page.error} resource="the pipeline" endpoint={path} onRetry={reload} />}
      {tab === 'pipeline' && page.loading && !data && <Loading text="Reading the pipeline…" />}

      {tab === 'pipeline' && data && (
        <>
          <PageStatus
            ariaLabel="Pipeline status"
            // Red only for work that failed (or nothing can open a fix, or reports are lost at
            // intake); stuck backlog alone is a warning (2026-11-18).
            tone={counted.failing > 0 || nothingOpens || rejectedTotal > 0 ? 'danger' : needYou > 0 || waitingForFix > 0 ? 'warn' : 'ok'}
            sentence={
              top
                ? <>Start with the biggest: <span className="font-medium">{top.group.label}</span>.</>
                : nothingOpens
                  ? agentCredits.state?.out
                    ? `${agentCreditsTitle(agentCredits.state)}, so nothing opens fixes. Nothing already open is stuck.`
                    : 'Nothing already open is stuck, but nothing opened a fix in the last day.'
                  : waitingForFix > 0
                    ? 'Nothing needs you now. Bugs wait for a fix: see the pace below.'
                    : 'Nothing is stuck. Every fix is moving.'
            }
            // Each number once: "Waiting for a fix" is the Triaged stage's count and "Merged, 7 days"
            // the pace row's, so they are not repeated here. Who opens fixes and intake rejections
            // were calm cards at the bottom; they need you, so they lead (2026-11-18).
            metrics={statusMetrics}
            action={
              top?.action ? (
                <Btn
                  size="sm"
                  variant={ACTION_META[top.action].variant === 'danger' ? 'ghost' : 'primary'}
                  onClick={() =>
                    setPending({
                      action: {
                        action: top.action!,
                        fixIds: top.ids,
                        reportIds: top.ids.map((id) => top.group.items.find((i) => i.id === id)?.reportId ?? null),
                        target: top.group.label,
                      },
                      key: `${top.action}:${top.group.id}`,
                    })
                  }
                  data-testid="pipeline-top-action"
                >
                  {ACTION_META[top.action].label}
                  {top.ids.length > 1 ? ` (${top.ids.length})` : ''}
                </Btn>
              ) : top ? (
                <a href="#pipeline-stuck" className="text-xs font-medium text-brand hover:underline" data-testid="pipeline-top-why">
                  See why →
                </a>
              ) : undefined
            }
            data-testid="pipeline-status"
          />
          {pace && <PaceRow pace={pace} />}

          <section className="space-y-2" aria-label="Stages">
            <PipelineFunnel stages={stages} openers={openers} selected={stage} onSelect={setStage} now={now} />
            <FunnelLegend />
            <StuckAgeBar ages={ages} />
          </section>

          {!data.ciReadable && (
            <Callout tone="warn" label="CI jobs">
              Mushi Mushi could not read the CI jobs just now, so PRs are judged by their check summary only. Refresh in a minute.
            </Callout>
          )}

          <Section
            title={stage ? `${stages.find((s) => s.id === stage)?.label ?? 'Stage'}: every group` : stuckTotal > 0 ? `Stuck: ${stuckTotal}` : 'Stuck'}
            id="pipeline-stuck"
            icon={<IconAlertTriangle />}
            action={
              stage ? (
                <Btn size="sm" variant="ghost" onClick={() => setStage(null)} data-testid="pipeline-show-all-stuck">
                  Show every stuck group
                </Btn>
              ) : undefined
            }
          >
            {!stage && stuckTotal === 0 ? (
              <p className="text-xs text-ok-foreground" data-testid="pipeline-none-stuck">
                {nothingOpens ? 'Nothing already open is stuck.' : 'Nothing is stuck. Every item is moving.'}
              </p>
            ) : (
              <PipelineGroups
                groups={groups}
                projectNames={projectNames}
                showApp={showApp}
                now={now}
                busyKey={busyKey}
                results={results}
                onAction={(action, key) => setPending({ action, key })}
                workerLanes={workerLanes}
                focusGroupId={stage ? null : searchParams.get('group')}
                topGroupId={stage ? null : (top?.group.id ?? null)}
              />
            )}
          </Section>

          <Section
            title="Release trains, last 7 days"
            id="pipeline-trains"
            icon={<IconReleases />}
            action={
              data.trains.length > 1 ? (
                <Btn
                  size="sm"
                  variant="ghost"
                  loading={trainBusy === 'all'}
                  disabled={trainBusy != null}
                  onClick={() => setTrainAsk({ projectIds: [...new Set(data.trains.map((t) => t.projectId))], repo: `${data.trains.length} repos` })}
                  data-testid="pipeline-trains-retry-all"
                >
                  Run every merge queue now
                </Btn>
              ) : undefined
            }
          >
            <TrainHistory
              trains={data.trains}
              projectNames={projectNames}
              showApp={showApp}
              now={now}
              busyProjectId={trainBusy}
              results={trainResults}
              onRetry={(pid, repo) => setTrainAsk({ projectIds: [pid], repo })}
            />
          </Section>

          {data.dispatchers && data.dispatchers.length > 0 && (
            <details className="group rounded-md border border-edge-subtle bg-surface-raised" id="pipeline-openers" data-testid="pipeline-openers">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-xs font-medium text-fg">
                <IconBolt size={14} />
                Who opens fixes
                {openers && (
                  <span className="font-normal text-fg-muted">
                    server {openers.server} · local {openers.local} · nobody {openers.nobody}
                    {data.dispatchers.some((d) => d.problem) ? ' · auto-fix cannot dispatch on some apps' : ''}
                  </span>
                )}
              </summary>
              <div className="border-t border-edge-subtle px-3 py-2">
                {openerParts && (
                  <StackedShareBar
                    className="mb-2 max-w-md"
                    ariaLabel="Apps by who opened a fix in the last 24 hours"
                    segments={[
                      { key: 'server', label: 'Server', value: openerParts.serverOnly, barClass: 'bg-brand', textClass: 'text-brand', glyph: '●' },
                      { key: 'local', label: 'Local', value: openerParts.localOnly, barClass: 'bg-info', textClass: 'text-info', glyph: '■' },
                      { key: 'both', label: 'Both', value: openerParts.both, barClass: 'bg-ok', textClass: 'text-ok', glyph: '◆' },
                      { key: 'nobody', label: 'Nobody', value: openerParts.nobody, barClass: 'bg-danger', textClass: 'text-danger', glyph: '▲' },
                    ]}
                  />
                )}
                <p className="mb-2 text-xs text-fg-muted">
                  The server opens fixes on its own only with an active Cursor key that has spend-down on. Local lanes are your own <code>mushi work</code> runs; set them up on the{' '}
                  <Link to="/pipeline?tab=workers" className="text-brand hover:underline">
                    Workers
                  </Link>{' '}
                  tab.
                </p>
                <FixOpeners dispatchers={data.dispatchers} now={now} />
              </div>
            </details>
          )}

          <Section title="Intake and deploys" id="pipeline-intake" icon={<IconShieldCheck />}>
            <ul className="space-y-1.5 text-xs" data-testid="pipeline-intake">
              <li className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-fg">Reports rejected at intake (400), last 7 days</span>
                {!data.intake && (
                  <span className="text-fg-muted" data-testid="pipeline-intake-not-recorded">not recorded yet</span>
                )}
                <Link to="/connect#connect-sdk-health" className="text-2xs font-medium text-brand hover:underline">
                  SDK health →
                </Link>
              </li>
              {(() => {
                // Only apps with something to say get their own line (2026-11-18): a rejection or a
                // failed deploy. The quiet rest fold into one "N apps: 0 rejected" line.
                const loud = data.intake ? data.projects.filter((p) => rejectedOf(p.id) > 0 || (p.lastDeploy != null && !p.lastDeploy.ok)) : data.projects
                const quiet = data.intake ? data.projects.filter((p) => !loud.includes(p)) : []
                if (quiet.length < 2) return data.projects.map(intakeRow)
                const seen = quiet.filter((p) => p.lastDeploy).length
                return (
                  <>
                    {loud.map(intakeRow)}
                    <li>
                      <details className="group" data-testid="pipeline-intake-quiet">
                        <summary className="cursor-pointer list-none text-fg-secondary hover:text-fg">
                          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">▸</span>{' '}
                          {quiet.length} apps: 0 rejected since {sinceLabel(data.intake!.since)}
                          <span className="text-fg-muted"> · {seen === 0 ? 'no deploy recorded in 14 days' : `${seen} with a deploy seen`}</span>
                        </summary>
                        <ul className="mt-1 space-y-1.5 pl-4">{quiet.map(intakeRow)}</ul>
                      </details>
                    </li>
                  </>
                )
              })()}
            </ul>
          </Section>
        </>
      )}

      {pending && (
        <PipelineActionDialog pending={pending.action} busy={busyKey != null} onConfirm={(r) => void confirmAction(r)} onCancel={() => setPending(null)} />
      )}
      {trainAsk && (
        <ConfirmDialog
          title={trainAsk.projectIds.length > 1 ? 'Run every merge queue now' : 'Run the merge queue now'}
          body={`Mushi Mushi checks ${trainAsk.projectIds.length > 1 ? 'each app’s queue' : 'this app’s queue'} now: a release train leaves if its interval is up and approved, green PRs are ready. Otherwise it says when the next one may leave.`}
          details={<span className="font-mono">{trainAsk.repo}</span>}
          confirmLabel="Run now"
          loading={trainBusy != null}
          onConfirm={() => void confirmTrain()}
          onCancel={() => setTrainAsk(null)}
        />
      )}
    </div>
  )
}

/** The biggest stuck group, and its one primary action when the server would take it for at least one item (the same choice as the group's own button). */
function topStuck(groups: PipelineGroup[]): { group: PipelineGroup; action: PipelineAction | null; ids: string[] } | null {
  const stuck = groups.filter((g) => g.tone === 'stuck').sort((a, b) => b.count - a.count)
  const group = stuck[0]
  if (!group) return null
  const primary = groupPrimary(group)
  return primary ? { group, action: primary.action, ids: primary.ids } : { group, action: null, ids: [] }
}

/** One labelled figure in the pace row: a muted label, the number in mono, a short note. */
function PaceFigure({ label, value, note, testId }: { label: string; value: string | number; note?: string | null; testId: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" data-testid={testId}>
      <span className="text-fg-muted">{label}</span>
      <span className="font-mono font-bold tabular-nums text-fg">{value}</span>
      {note && <span className="text-fg-muted">({note})</span>}
    </span>
  )
}

/** The pace as a short row of labelled figures, not a paragraph (2026-11-18). */
function PaceRow({ pace }: { pace: PaceFigures }) {
  const quiet = pace.quietApps
  return (
    <p className="-mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1 text-xs" data-testid="pipeline-pace">
      <span className="text-3xs font-bold tracking-wider text-fg-secondary uppercase">Pace</span>
      <PaceFigure label="Merged, 7 d" value={pace.merged7} note={pace.rate} testId="pipeline-pace-merged" />
      {pace.clears && <PaceFigure label="Backlog clears in" value={`~${pace.clears}`} testId="pipeline-pace-clears" />}
      {pace.started24h != null && <PaceFigure label="Fixes started, 24 h" value={pace.started24h} note={pace.startedBy} testId="pipeline-pace-started" />}
      {quiet.length > 0 && (
        <span className="text-fg-muted" title={quiet.join(', ')} data-testid="pipeline-pace-quiet">
          none for {quiet.length > 3 ? `${quiet.slice(0, 3).join(', ')} +${quiet.length - 3}` : quiet.join(', ')}
        </span>
      )}
    </p>
  )
}
