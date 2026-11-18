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
import { Btn, Callout, Loading, PageStatus, Section, SegmentedControl } from '../components/ui'
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
import { groupPrimary, stuckAges } from '../lib/pipelineSignals'
import { StuckAgeBar } from '../components/pipeline/StuckAgeBar'
import {
  ACTION_META,
  ageLabel,
  openerSplit,
  openerSummary,
  outcomeSummary,
  pipelinePace,
  retryTrains,
  runPipelineAction,
  type ActionOutcome,
  type PipelineAction,
  type PipelineData,
  type PipelineGroup,
} from '../lib/pipeline'
import { COUNT_HINTS } from '../lib/countDefinitions'
import { pluralize } from '../lib/format'

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
  const [trainAsk, setTrainAsk] = useState<{ projectId: string; repo: string } | null>(null)
  const [trainBusy, setTrainBusy] = useState<string | null>(null)
  const [trainResults, setTrainResults] = useState<Map<string, ActionOutcome>>(new Map())

  const projectNames = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, p.name])), [data])
  const stages = data?.stages ?? []
  const stuckTotal = stages.reduce((n, s) => n + s.stuck, 0)
  // The triaged stage's stuck items are bugs no fix has started on yet: the backlog, with no
  // action for a person. Counted as "stuck", 1013 of 1013 read the same and every stage was
  // red (owner's fresh-user review, 2026-11-16). The server's "stuck" is unchanged; this
  // page separates what needs you from what waits for a fix (the pace line counts that).
  const backlogStuck = stages.find((s) => s.id === 'triaged')?.stuck ?? 0
  const needYou = stuckTotal - backlogStuck
  const groups = useMemo(() => {
    if (stage) return stages.find((s) => s.id === stage)?.groups ?? []
    return stages.flatMap((s) => s.groups.filter((g) => g.tone === 'stuck')).sort((a, b) => b.count - a.count)
  }, [stages, stage])
  const showApp = scope === 'all'
  // The biggest stuck group and the first of its actions the server would take.
  const top = useMemo(() => topStuck(stages.filter((s) => s.id !== 'triaged').flatMap((s) => s.groups)), [stages])
  const openers = useMemo(() => (data?.dispatchers ? openerSummary(data.dispatchers) : null), [data])
  const openerParts = useMemo(() => (data?.dispatchers ? openerSplit(data.dispatchers) : null), [data])
  // How fast fixes land and how long the waiting bugs take at that pace (2026-11-16).
  const pace = useMemo(() => (data ? pipelinePace(data.stages, data.dispatchers) : null), [data])
  // How long the stuck work has waited; "Need you" adds up to the status line's count.
  const ages = useMemo(() => stuckAges(stages, now), [stages, now])
  // "Nothing is stuck" was false while no agent could open a fix (audit
  // 2026-11-11: next to "Who opens fixes: nobody" and "credits idle").
  const agentCredits = useAgentCredits()
  // Only when bugs wait for a fix: a quiet app with no bugs opens nothing, and that is fine.
  const autofixApps = (data?.dispatchers ?? []).filter((d) => d.autofixOn)
  const waitingForFix = (data?.stages ?? []).find((s) => s.id === 'triaged')?.count ?? 0
  const nothingOpens =
    waitingForFix > 0 &&
    (agentCredits.state?.out === true ||
      (autofixApps.length > 0 && autofixApps.every((d) => d.server.dispatches24h === 0 && d.local.runs24h === 0)))

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
    setTrainBusy(trainAsk.projectId)
    try {
      const out = await retryTrains(trainAsk.projectId)
      setTrainResults((prev) => {
        const next = new Map(prev)
        for (const r of out) next.set(r.id, r)
        return next
      })
      const mine = out.find((r) => r.id === trainAsk.repo) ?? out[0]
      if (mine) (mine.ok ? toast.success : toast.info)(mine.message)
    } finally {
      setTrainBusy(null)
      setTrainAsk(null)
      reload()
    }
  }, [trainAsk, reload, toast])

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-pipeline">
      <PageHeaderBar
        title="Pipeline"
        icon={<IconNetwork />}
        description="Every bug from report to deploy, where it is stuck, and the fix."
        helpTitle="About the pipeline"
        helpWhatIsIt="Each bug moves from a report to a fix PR, an Opus review, CI, a release train, a merge and a deploy. This page shows how many are in each step now, which are stuck, and why."
        helpHowToUse="Start with the coloured stage: ▲ red is the bottleneck, ◆ amber is nearly as stuck; the rest show their stuck count in plain ink. The age bar shows how long stuck work has waited. Open a stuck group to see its PRs with the failing checks or review findings; each group has one main fix, and More holds the rest (re-run, close with a reason). Every action asks first."
      >
        {tab === 'workers' ? null : page.isValidating && !page.loading ? (
          <span className="text-2xs text-fg-muted">Updating…</span>
        ) : data ? (
          <span className="text-2xs tabular-nums text-fg-muted" data-testid="pipeline-updated">Updated {ageLabel(data.generatedAt, now)} ago</span>
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

      <SegmentedControl<Tab> value={tab} options={tabOptions} onChange={setTab} ariaLabel="Pipeline or local workers" size="md" />

      {tab === 'workers' && <WorkersPanel projectId={scope === 'project' ? projectId : null} now={now} />}

      {tab === 'pipeline' && page.error && <PageLoadError error={page.error} resource="the pipeline" endpoint={path} onRetry={reload} />}
      {tab === 'pipeline' && page.loading && !data && <Loading text="Reading the pipeline…" />}

      {tab === 'pipeline' && data && (
        <>
          <PageStatus
            ariaLabel="Pipeline status"
            tone={needYou > 0 || nothingOpens ? 'danger' : waitingForFix > 0 ? 'warn' : 'ok'}
            sentence={
              top
                ? <>{needYou} {pluralize(needYou, 'item')} {needYou === 1 ? 'needs' : 'need'} you. The biggest: <span className="font-medium">{top.group.label}</span>.</>
                : nothingOpens
                  ? agentCredits.state?.out
                    ? `${agentCreditsTitle(agentCredits.state)}, so nothing opens fixes. Nothing already open is stuck.`
                    : 'Nothing already open is stuck, but nothing opened a fix in the last day.'
                  : waitingForFix > 0
                    ? 'Nothing needs you now. Bugs wait for a fix: see the pace below.'
                    : 'Nothing is stuck. Every fix is moving.'
            }
            metrics={[
              { label: 'Need you', value: needYou, tone: needYou > 0 ? 'danger' : 'ok', hint: `${COUNT_HINTS.stuck} Bugs that only wait for a fix are not counted here.` },
              { label: 'Waiting for a fix', value: waitingForFix, tone: waitingForFix > 0 ? 'warn' : 'ok', hint: 'Bugs triaged and understood, with no fix started yet.' },
              { label: 'Merged, 7 days', value: (stages.find((s) => s.id === 'merged')?.count ?? 0) + (stages.find((s) => s.id === 'deployed')?.count ?? 0), tone: 'ok', hint: 'Fixes merged in the last 7 days, deployed or not.' },
            ]}
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
          {pace && (
            <p className="-mt-1 px-1 text-xs text-fg-secondary" data-testid="pipeline-pace">
              {pace}
            </p>
          )}

          <section className="space-y-2" aria-label="Stages">
            <PipelineFunnel stages={stages} openers={openers} selected={stage} onSelect={setStage} now={now} />
            <FunnelLegend />
            <StuckAgeBar needYou={ages.needYou} waiting={ages.waiting} />
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
              />
            )}
          </Section>

          <Section title="Release trains, last 7 days" id="pipeline-trains" icon={<IconReleases />}>
            <TrainHistory
              trains={data.trains}
              projectNames={projectNames}
              showApp={showApp}
              now={now}
              busyProjectId={trainBusy}
              results={trainResults}
              onRetry={(pid, repo) => setTrainAsk({ projectId: pid, repo })}
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
              {data.projects.map((p) => {
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
                        0 rejected since {new Date(`${data.intake.since}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} ·
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
              })}
            </ul>
          </Section>
        </>
      )}

      {pending && (
        <PipelineActionDialog pending={pending.action} busy={busyKey != null} onConfirm={(r) => void confirmAction(r)} onCancel={() => setPending(null)} />
      )}
      {trainAsk && (
        <ConfirmDialog
          title="Run the merge queue now"
          body="Mushi Mushi checks this app's queue now: a release train leaves if its interval is up and approved, green PRs are ready. Otherwise it says when the next one may leave."
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
