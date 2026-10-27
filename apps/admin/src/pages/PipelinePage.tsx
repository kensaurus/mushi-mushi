/**
 * PipelinePage — /pipeline, "Pipeline".
 *
 * Every bug from report to deploy as one picture: Reported → Triaged → Fix
 * PR → Reviewed → CI → Release train → Merged → Deployed. Each stage shows
 * how many items sit in it, how many are stuck and the oldest one's age.
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

import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PageLoadError } from '../components/PageLoadError'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Btn, Callout, Loading, PageStatus, Section, SegmentedControl } from '../components/ui'
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
import { LANES_PATH, type WorkLanesData } from '../lib/workers'
import {
  ACTION_META,
  actionableIds,
  ageLabel,
  openerSummary,
  outcomeSummary,
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
    return d.lanes.filter((l) => mine.has(l.hostId))
  }, [lanesPage.data])
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
  const groups = useMemo(() => {
    if (stage) return stages.find((s) => s.id === stage)?.groups ?? []
    return stages.flatMap((s) => s.groups.filter((g) => g.tone === 'stuck')).sort((a, b) => b.count - a.count)
  }, [stages, stage])
  const showApp = scope === 'all'
  // The biggest stuck group and the first of its actions the server would take.
  const top = useMemo(() => topStuck(stages.flatMap((s) => s.groups)), [stages])
  const openers = useMemo(() => (data?.dispatchers ? openerSummary(data.dispatchers) : null), [data])

  usePublishPageContext({
    route: '/pipeline',
    title: 'Pipeline',
    // The Workers tab never loads the pipeline, so it must not say it is loading it.
    summary:
      tab === 'workers'
        ? 'Local workers'
        : data
          ? `${stuckTotal} items stuck across ${stages.filter((s) => s.stuck > 0).length} stages`
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
        helpHowToUse="Start with the red stages. Open a stuck group to see its PRs with the failing checks or review findings, then fix them in one click: CI repair, update branch, re-run review, or close with a reason. Every action asks first."
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

      <SegmentedControl<Tab> value={tab} options={TAB_OPTIONS} onChange={setTab} ariaLabel="Pipeline or local workers" size="md" />

      {tab === 'workers' && <WorkersPanel projectId={scope === 'project' ? projectId : null} now={now} />}

      {tab === 'pipeline' && page.error && <PageLoadError error={page.error} resource="the pipeline" endpoint={path} onRetry={reload} />}
      {tab === 'pipeline' && page.loading && !data && <Loading text="Reading the pipeline…" />}

      {tab === 'pipeline' && data && (
        <>
          <PageStatus
            ariaLabel="Pipeline status"
            tone={stuckTotal > 0 ? 'danger' : 'ok'}
            sentence={
              top
                ? <>{stuckTotal} {pluralize(stuckTotal, 'item')} stuck. The biggest: <span className="font-medium">{top.group.label}</span>.</>
                : 'Nothing is stuck. Every fix is moving.'
            }
            metrics={[
              { label: 'Stuck', value: stuckTotal, tone: stuckTotal > 0 ? 'danger' : 'ok', hint: COUNT_HINTS.stuck },
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

          <section className="space-y-2" aria-label="Stages">
            <PipelineFunnel stages={stages} openers={openers} selected={stage} onSelect={setStage} now={now} />
            <FunnelLegend />
          </section>

          {!data.ciReadable && (
            <Callout tone="warn" label="CI jobs">
              Mushi could not read the CI jobs just now, so PRs are judged by their check summary only. Refresh in a minute.
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
              <p className="text-xs text-ok-foreground" data-testid="pipeline-none-stuck">Nothing is stuck. Every item is moving.</p>
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
          body="Mushi checks this app's queue now: a release train leaves if its interval is up and approved, green PRs are ready. Otherwise it says when the next one may leave."
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

/** The biggest stuck group, and the first of its actions the server would take for at least one item. */
function topStuck(groups: PipelineGroup[]): { group: PipelineGroup; action: PipelineAction | null; ids: string[] } | null {
  const stuck = groups.filter((g) => g.tone === 'stuck').sort((a, b) => b.count - a.count)
  const group = stuck[0]
  if (!group) return null
  for (const action of group.actions) {
    const ids = actionableIds(group.items, action)
    if (ids.length > 0) return { group, action, ids }
  }
  return { group, action: null, ids: [] }
}
