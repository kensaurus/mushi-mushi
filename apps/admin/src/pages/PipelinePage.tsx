/**
 * PipelinePage — /pipeline, "Pipeline".
 *
 * Every bug from report to deploy as one picture: Reported → Triaged → Fix
 * PR → Reviewed → CI → Release train → Merged → Deployed. Each stage shows
 * how many items sit in it, how many are stuck and the oldest one's age.
 * Below, the stuck groups in plain words ("12 PRs: their own CI is red"),
 * each with its items, their evidence and one-click fixes; then the release
 * trains of the last 7 days per repo, and what intake and deploys report.
 *
 * Scope follows the header switcher (lib/projectScope.ts): one app, or "All
 * apps". Every action asks first, shows its busy state and each PR's
 * result, then the page reads again.
 *
 * Data: GET /v1/admin/pipeline?projectId= → PipelineData (api-ext)
 *       POST /v1/admin/pipeline/actions, /v1/admin/fixes/:id/review,
 *       /v1/admin/fixes/:id/ci/rerun, /v1/admin/merge-queue (lib/pipeline.ts)
 */

import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PageLoadError } from '../components/PageLoadError'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Btn, Callout, Loading, Section, SegmentedControl } from '../components/ui'
import { IconAlertTriangle, IconNetwork, IconReleases, IconShieldCheck } from '../components/icons'
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
import {
  ageLabel,
  outcomeSummary,
  retryTrains,
  runPipelineAction,
  type ActionOutcome,
  type PipelineData,
} from '../lib/pipeline'

type Scope = 'project' | 'all'
const SCOPE_OPTIONS = [
  { id: 'project', label: 'This app' },
  { id: 'all', label: 'All apps' },
] as const

export function PipelinePage() {
  const projectId = useActiveProjectId()
  const scopeChoice: Scope = useProjectScope().mode
  const setScopeChoice = useSetProjectScopeMode()
  const scope: Scope = projectId ? scopeChoice : 'all'
  const path = scope === 'project' && projectId ? `/v1/admin/pipeline?projectId=${encodeURIComponent(projectId)}` : '/v1/admin/pipeline'
  const page = usePageData<PipelineData>(path, { scope: scope === 'all' ? 'enumeration' : 'project' })
  const { data, reload } = page
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

  usePublishPageContext({
    route: '/pipeline',
    title: 'Pipeline',
    summary: data ? `${stuckTotal} items stuck across ${stages.filter((s) => s.stuck > 0).length} stages` : page.error ? "The pipeline couldn't load" : 'Loading the pipeline',
    questions: ['Why are my fixes not merging?', 'Which PRs are stuck, and why?', 'Why do my release trains keep failing?'],
  })

  const confirmAction = useCallback(
    async (reason: string | undefined) => {
      if (!pending) return
      const { action, key } = pending
      setBusyKey(key)
      try {
        const out = await runPipelineAction(action.action, action.fixIds, reason)
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
        {page.isValidating && !page.loading ? (
          <span className="text-2xs text-fg-muted">Updating…</span>
        ) : data ? (
          <span className="text-2xs tabular-nums text-fg-muted" data-testid="pipeline-updated">Updated {ageLabel(data.generatedAt, now)} ago</span>
        ) : null}
        <Btn size="sm" variant="ghost" onClick={reload} disabled={page.isValidating} data-testid="pipeline-refresh">
          Refresh
        </Btn>
        {projectId && <SegmentedControl<Scope> value={scope} options={SCOPE_OPTIONS} onChange={setScopeChoice} ariaLabel="Which apps" size="sm" />}
      </PageHeaderBar>

      {page.error && <PageLoadError error={page.error} resource="the pipeline" endpoint={path} onRetry={reload} />}
      {page.loading && !data && <Loading text="Reading the pipeline…" />}

      {data && (
        <>
          <section className="space-y-2" aria-label="Stages">
            <PipelineFunnel stages={stages} selected={stage} onSelect={setStage} now={now} />
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

          <Section title="Intake and deploys" id="pipeline-intake" icon={<IconShieldCheck />}>
            <ul className="space-y-1.5 text-xs" data-testid="pipeline-intake">
              <li className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-fg">Reports rejected at intake:</span>
                {data.intake ? (
                  <span data-testid="pipeline-intake-rejected">
                    {data.intake.rejected}
                    {data.intake.byReason.length > 0 && ` (${data.intake.byReason.map((r) => `${r.count} ${r.reason}`).join(', ')})`}
                  </span>
                ) : (
                  <span className="text-fg-muted" data-testid="pipeline-intake-not-recorded">not recorded yet</span>
                )}
                <Link to="/connect#connect-sdk-health" className="text-2xs font-medium text-brand hover:underline">
                  SDK health →
                </Link>
              </li>
              {data.projects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-fg-muted">
                  <span className="text-fg-secondary">{p.name}:</span>
                  {p.lastDeploy ? (
                    <span>
                      last deploy seen {ageLabel(p.lastDeploy.at, now)} ago{p.lastDeploy.version ? ` (${p.lastDeploy.version})` : ''}
                      {!p.lastDeploy.ok && ' and it failed'}
                    </span>
                  ) : (
                    <span>no deploy recorded in 14 days</span>
                  )}
                </li>
              ))}
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
