/**
 * FILE: apps/admin/src/components/ci/CiJobDebug.tsx
 * PURPOSE: "Why it failed", in the console (2026-11-19; the owner: "let users debug the pipeline
 *          thoroughly from the Mushi console"). One drawer for the whole page:
 *            - the failing step with its mark, then every step;
 *            - a plain-English cause, one next step and whether it is the code, a flaky run or the
 *              test machine (Explain: OpenAI's mini model reads the screened log; cached per job
 *              attempt, so a second look is free; a machine stop is answered without a model);
 *            - the screened log around the failure and GitHub's annotations;
 *            - Re-run failed jobs, Cancel run, Send to CI repair, and "Open on GitHub" last.
 *          A refusal (no Actions write, no OpenAI key, spend limit) says why in one line and puts the
 *          button that fixes it in the same spot.
 *
 *          Any row on the page opens it with <CiWhyButton jobId=…/> (the overview's `jobs[].id`);
 *          outside a CiDebugProvider the button renders nothing.
 *
 * Data: GET /v1/admin/ci/jobs/:id/debug · POST …/explain · …/rerun · …/cancel (api/routes/ci-job-debug.ts)
 *       POST /v1/admin/pipeline/actions { action: 'ci_repair', fixIds } (Send to CI repair)
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CiExplainResult, CiJobDebug, CiRunActionResult } from '../../lib/ciTypes'
import {
  ciDebugErrorView,
  debugPanelReducer,
  EXPLANATION_KIND,
  githubAccessFix,
  initialPanelState,
  logStatusLine,
  stepStatus,
  type CiDebugFix,
  type CiPanelAction,
  type CiPanelEvent,
  type CiPanelState,
} from '../../lib/ciDebug'
import { formatSeconds, repoShortName } from '../../lib/ciView'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { StageDrawer } from '../flow-primitives/StageDrawer'
import { Btn, Loading } from '../ui'
import { IconBan, IconExternalLink, IconIntelligence, IconQuery, IconRerun, IconSend } from '../icons'
import { StatusMark, StatusPill, type RunStatus } from '../signal/StatusMark'

interface CiDebugApi {
  open: (jobId: string) => void
}

const CiDebugContext = createContext<CiDebugApi | null>(null)

/** The page's debug drawer, or null outside a CiDebugProvider. */
export function useCiDebug(): CiDebugApi | null {
  return useContext(CiDebugContext)
}

const WHY_BUTTON =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-edge bg-surface-raised px-1.5 text-2xs font-semibold text-fg ' +
  'motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-px hover:border-accent hover:text-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'

/**
 * Opens the debug drawer for one job. `label` defaults to "Why?" (a failure); a running job says
 * "Inspect". Clicks never bubble to the row (rows pin a highlight on click).
 */
export function CiWhyButton({ jobId, label = 'Why?', title = 'Why it failed: the failing step, the log and a plain-English cause' }: { jobId: string | null | undefined; label?: string; title?: string }) {
  const debug = useCiDebug()
  if (!debug || !jobId) return null
  return (
    <button
      type="button"
      className={WHY_BUTTON}
      title={title}
      aria-label={`${label} ${title}`}
      onClick={(e) => {
        e.stopPropagation()
        debug.open(jobId)
      }}
      data-testid="ci-why"
    >
      <IconQuery size={11} />
      {label}
    </button>
  )
}

async function explainCall(jobId: string) {
  return apiFetchMutate<CiExplainResult>(`/v1/admin/ci/jobs/${encodeURIComponent(jobId)}/explain`, { method: 'POST', body: '{}', scope: 'enumeration' })
}

/** The provider: holds the open job, fetches its debug view once per open, renders the drawer. */
export function CiDebugProvider({ children, onChanged }: { children: ReactNode; onChanged?: () => void }) {
  const [state, dispatch] = useReducer(debugPanelReducer, null, () => initialPanelState(null))
  const open = useCallback((jobId: string) => dispatch({ type: 'open', jobId }), [])
  const api = useMemo(() => ({ open }), [open])

  // One read per open (not on every 30 s poll of the page).
  useEffect(() => {
    if (!state.jobId || state.load !== 'loading') return
    const jobId = state.jobId
    void apiFetch<CiJobDebug>(`/v1/admin/ci/jobs/${encodeURIComponent(jobId)}/debug`, { scope: 'enumeration', cache: 'no-store' }).then((res) => {
      if (res.ok && res.data) dispatch({ type: 'loaded', jobId, data: res.data })
      else dispatch({ type: 'loadFailed', jobId, error: ciDebugErrorView(res.error?.code, res.error?.message, '') })
    })
  }, [state.jobId, state.load])

  return (
    <CiDebugContext.Provider value={api}>
      {children}
      <CiJobDebugDrawer state={state} dispatch={dispatch} onChanged={onChanged} />
    </CiDebugContext.Provider>
  )
}

function FixLink({ fix }: { fix: CiDebugFix }) {
  return (
    <Link to={fix.to} className="inline-flex h-6 items-center rounded-sm border border-accent px-1.5 text-2xs font-semibold text-accent-foreground hover:bg-accent-muted" data-testid="ci-debug-fix">
      {fix.label} →
    </Link>
  )
}

function ErrorLine({ text, fix }: { text: string; fix: CiDebugFix | null }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg" role="alert">
      <StatusMark status="failed" size={10} />
      <span>{text}</span>
      {fix && <FixLink fix={fix} />}
    </p>
  )
}

function jobStatus(d: CiJobDebug): RunStatus {
  if (d.job.status !== 'completed') return 'running'
  if (d.job.ciKind === 'passed') return 'passed'
  if (d.job.infra || d.job.ciKind === 'runner_lost' || d.job.ciKind === 'queue_expired') return 'cancelled'
  if (d.job.ciKind === 'cancelled' || d.job.ciKind === 'skipped') return 'cancelled'
  return 'failed'
}

const SECTION_H = 'mb-1 text-3xs font-bold tracking-wider text-fg-secondary uppercase'

function Explanation({ state, dispatch }: { state: CiPanelState; dispatch: (e: CiPanelEvent) => void }) {
  const d = state.data!
  const e = d.explanation
  const run = async () => {
    dispatch({ type: 'explainStart' })
    const res = await explainCall(d.job.id)
    if (res.ok && res.data) dispatch({ type: 'explained', explanation: res.data.explanation })
    else dispatch({ type: 'explainFailed', error: ciDebugErrorView(res.error?.code, res.error?.message, d.job.projectId) })
  }
  if (e) {
    const kind = EXPLANATION_KIND[e.kind]
    return (
      <section className="rounded-md border border-edge bg-surface-raised px-2.5 py-2" data-testid="ci-debug-explanation">
        <div className="mb-1 flex items-center gap-1.5">
          <StatusPill status={kind.status} label={kind.label} />
          <span className="ml-auto text-3xs text-fg-secondary">{e.source === 'ai' ? `AI · ${e.model ?? 'OpenAI'}` : 'From the job’s result'}</span>
        </div>
        <p className="text-sm leading-snug font-bold text-fg">{e.cause}</p>
        <p className="mt-1 text-xs text-fg">
          <span className="font-semibold">Next: </span>
          {e.nextStep}
        </p>
      </section>
    )
  }
  if (!d.actions.explain) return null
  return (
    <section className="flex flex-col gap-1.5" data-testid="ci-debug-explain">
      <Btn size="sm" variant="primary" onClick={run} loading={state.explain.state === 'busy'} leadingIcon={<IconIntelligence size={13} />}>
        Explain this failure
      </Btn>
      {state.explain.error && <ErrorLine text={state.explain.error.text} fix={state.explain.error.fix} />}
    </section>
  )
}

function Steps({ d }: { d: CiJobDebug }) {
  if (d.steps.length === 0) return null
  const failedAt = d.steps.findIndex((s) => s.name === d.failedStep)
  return (
    <details className="text-xs" open={d.steps.length <= 8} data-testid="ci-debug-steps">
      <summary className={`${SECTION_H} cursor-pointer`}>Steps ({d.steps.length})</summary>
      <ol className="mt-1 flex flex-col">
        {d.steps.map((s, i) => {
          const st = stepStatus(s.conclusion)
          return (
            <li key={`${i}-${s.name}`} className={`flex min-w-0 items-center gap-1.5 px-1 py-0.5 ${i === failedAt ? 'rounded-sm bg-st-failed-soft font-bold' : ''}`}>
              <StatusMark status={st} size={9} />
              <span className="min-w-0 truncate text-fg" title={s.name}>
                {s.name}
              </span>
              {s.seconds != null && <span className="ml-auto shrink-0 font-mono text-3xs text-fg-secondary tabular-nums">{formatSeconds(s.seconds)}</span>}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

function LogExcerpt({ d }: { d: CiJobDebug }) {
  const why = logStatusLine(d.log.status)
  return (
    <section data-testid="ci-debug-log">
      <h4 className={SECTION_H}>Log around the failure</h4>
      {d.log.excerpt ? (
        <>
          <pre className="max-h-72 overflow-auto rounded-sm border border-edge bg-surface-overlay p-2 font-mono text-3xs leading-relaxed whitespace-pre-wrap text-fg">{d.log.excerpt}</pre>
          {d.log.linesDropped > 0 && (
            <p className="mt-0.5 text-3xs text-fg-secondary">
              {d.log.linesDropped} line{d.log.linesDropped === 1 ? '' : 's'} hidden: they read like instructions to an AI or named a secret.
            </p>
          )}
        </>
      ) : why ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-secondary">
          <StatusMark status={d.log.status === 'running' ? 'running' : 'idle'} size={9} />
          {why.text}
          {why.github && <FixLink fix={githubAccessFix(d.job.projectId)} />}
        </p>
      ) : (
        <p className="text-xs text-fg-secondary">GitHub returned an empty log.</p>
      )}
      {d.annotations.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5" data-testid="ci-debug-annotations">
          {d.annotations.map((a) => (
            <li key={a} className="flex items-start gap-1.5 text-xs text-fg">
              <StatusMark status="failed" size={9} />
              <span className="min-w-0 wrap-break-word">{a}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const ACTION_DONE: Record<CiPanelAction, string> = {
  rerun: 'Failed jobs queued again on GitHub.',
  cancel: 'Cancelling the run on GitHub.',
  repair: 'Sent to CI repair.',
}

function Actions({ state, dispatch, onChanged }: { state: CiPanelState; dispatch: (e: CiPanelEvent) => void; onChanged?: () => void }) {
  const d = state.data!
  const act = async (action: CiPanelAction) => {
    dispatch({ type: 'actionStart', action })
    if (action === 'repair') {
      const res = await apiFetch<{ results: Array<{ ok: boolean; message: string }> }>('/v1/admin/pipeline/actions', {
        method: 'POST',
        scope: 'enumeration',
        body: JSON.stringify({ action: 'ci_repair', fixIds: [d.actions.ciRepair!.fixId] }),
      })
      const r = res.data?.results?.[0]
      if (res.ok && r?.ok) dispatch({ type: 'actionDone', action, message: r.message || ACTION_DONE.repair })
      else dispatch({ type: 'actionFailed', action, error: { text: r?.message ?? res.error?.message ?? 'Could not send it to CI repair.', fix: null } })
      return
    }
    const res = await apiFetchMutate<CiRunActionResult>(`/v1/admin/ci/jobs/${encodeURIComponent(d.job.id)}/${action}`, { method: 'POST', body: '{}', scope: 'enumeration' })
    if (res.ok) {
      dispatch({ type: 'actionDone', action, message: ACTION_DONE[action] })
      onChanged?.()
    } else dispatch({ type: 'actionFailed', action, error: ciDebugErrorView(res.error?.code, res.error?.message, d.job.projectId) })
  }
  const a = state.actions
  const busyOrDone = (k: CiPanelAction) => a[k].state === 'busy' || a[k].state === 'done'
  const outcomes = (['rerun', 'cancel', 'repair'] as const).filter((k) => a[k].state === 'done' || a[k].state === 'error')
  return (
    <div className="flex flex-col gap-1.5" data-testid="ci-debug-actions">
      <div className="flex flex-wrap items-center gap-1.5">
        {d.actions.rerun && (
          <Btn size="sm" variant="ghost" onClick={() => void act('rerun')} loading={a.rerun.state === 'busy'} disabled={busyOrDone('rerun')} leadingIcon={<IconRerun size={13} />} data-testid="ci-debug-rerun">
            {a.rerun.state === 'done' ? '✓ Re-run queued' : 'Re-run failed jobs'}
          </Btn>
        )}
        {d.actions.cancel &&
          (a.cancel.state === 'confirm' ? (
            <Btn size="sm" variant="danger" onClick={() => void act('cancel')} leadingIcon={<IconBan size={13} />} data-testid="ci-debug-cancel-confirm">
              Confirm: cancel the whole run
            </Btn>
          ) : (
            <Btn size="sm" variant="ghost" onClick={() => dispatch({ type: 'actionConfirm', action: 'cancel' })} loading={a.cancel.state === 'busy'} disabled={busyOrDone('cancel')} leadingIcon={<IconBan size={13} />} data-testid="ci-debug-cancel">
              {a.cancel.state === 'done' ? '✓ Cancelling' : 'Cancel run'}
            </Btn>
          ))}
        {d.actions.ciRepair &&
          (a.repair.state === 'confirm' ? (
            <Btn size="sm" variant="primary" onClick={() => void act('repair')} leadingIcon={<IconSend size={13} />} data-testid="ci-debug-repair-confirm">
              Confirm: an agent makes CI green
            </Btn>
          ) : (
            <Btn size="sm" variant="ghost" onClick={() => dispatch({ type: 'actionConfirm', action: 'repair' })} loading={a.repair.state === 'busy'} disabled={busyOrDone('repair')} leadingIcon={<IconSend size={13} />} data-testid="ci-debug-repair">
              {a.repair.state === 'done' ? '✓ Sent to CI repair' : 'Send to CI repair'}
            </Btn>
          ))}
        <a href={d.job.htmlUrl ?? d.job.runUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-2xs font-medium text-fg-secondary hover:text-fg hover:underline">
          Open on GitHub <IconExternalLink size={10} />
        </a>
      </div>
      {a.repair.state === 'confirm' && <p className="text-2xs text-fg-secondary">An agent fixes the code on the pull request without weakening tests.</p>}
      {outcomes.map((k) =>
        a[k].state === 'error' ? (
          <ErrorLine key={k} text={a[k].message ?? 'That did not work.'} fix={a[k].fix} />
        ) : (
          <p key={k} className="flex items-center gap-1.5 text-xs text-fg" role="status">
            <StatusMark status="passed" size={10} />
            {a[k].message}
          </p>
        ),
      )}
    </div>
  )
}

function DebugBody({ state, dispatch, onChanged }: { state: CiPanelState; dispatch: (e: CiPanelEvent) => void; onChanged?: () => void }) {
  if (state.load === 'loading') return <Loading text="Reading the job from GitHub…" />
  if (state.load === 'error' || !state.data) {
    return (
      <div className="flex flex-col gap-2">
        {state.loadError && <ErrorLine text={state.loadError.text} fix={state.loadError.fix} />}
        {state.jobId && (
          <Btn size="sm" variant="ghost" onClick={() => dispatch({ type: 'open', jobId: state.jobId! })}>
            Try again
          </Btn>
        )}
      </div>
    )
  }
  const d = state.data
  const status = jobStatus(d)
  const current = d.job.status !== 'completed' ? d.steps.find((s) => stepStatus(s.conclusion) === 'running')?.name ?? null : null
  return (
    <div className="flex flex-col gap-3" data-testid="ci-debug-panel">
      <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs" data-testid="ci-debug-step">
        <StatusMark status={status} size={12} />
        {status === 'running' ? (
          <span className="text-fg">Running{current ? <>: <b>{current}</b></> : ''}</span>
        ) : d.failedStep ? (
          <span className="text-fg">
            {status === 'failed' ? 'Failed at' : 'Stopped at'} <b>{d.failedStep}</b>
          </span>
        ) : (
          <span className="text-fg">{status === 'passed' ? 'Passed' : 'Did not finish'}</span>
        )}
        {d.job.durationSeconds != null && <span className="ml-auto font-mono text-2xs text-fg-secondary tabular-nums">{formatSeconds(d.job.durationSeconds)}</span>}
      </p>
      <Explanation state={state} dispatch={dispatch} />
      <Actions state={state} dispatch={dispatch} onChanged={onChanged} />
      <LogExcerpt d={d} />
      <Steps d={d} />
    </div>
  )
}

function CiJobDebugDrawer({ state, dispatch, onChanged }: { state: CiPanelState; dispatch: (e: CiPanelEvent) => void; onChanged?: () => void }) {
  const d = state.data
  const subtitle = d ? [repoShortName(d.job.repo), d.job.workflowName, d.job.prNumber != null ? `PR #${d.job.prNumber}` : d.job.headBranch].filter(Boolean).join(' · ') : undefined
  return (
    <StageDrawer open={state.jobId != null} onClose={() => dispatch({ type: 'close' })} title={d?.job.jobName ?? 'CI job'} subtitle={subtitle}>
      <DebugBody state={state} dispatch={dispatch} onChanged={onChanged} />
    </StageDrawer>
  )
}

/**
 * "Re-run" for the jobs a test machine stopped, in the console (2026-11-19; it linked to GitHub).
 * `jobIds` holds one job per run (lib/ciDebug oneJobPerRun); each run's failed jobs are re-run.
 * A refusal says why and links the fix in the same spot.
 */
export function CiRerunRunButton({ jobIds, projectId, label = 'Re-run', onDone }: { jobIds: string[]; projectId: string; label?: string; onDone?: () => void }) {
  const [state, setState] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; message: string | null; fix: CiDebugFix | null }>({ state: 'idle', message: null, fix: null })
  if (jobIds.length === 0) return null
  const run = async () => {
    setState({ state: 'busy', message: null, fix: null })
    let ok = 0
    for (const id of jobIds) {
      const res = await apiFetchMutate<CiRunActionResult>(`/v1/admin/ci/jobs/${encodeURIComponent(id)}/rerun`, { method: 'POST', body: '{}', scope: 'enumeration' })
      if (res.ok) {
        ok++
        continue
      }
      const view = ciDebugErrorView(res.error?.code, res.error?.message, projectId)
      setState({ state: 'error', message: ok > 0 ? `${ok} re-run, then: ${view.text}` : view.text, fix: view.fix })
      return
    }
    setState({ state: 'done', message: jobIds.length === 1 ? 'Re-run queued' : `${ok} runs queued`, fix: null })
    onDone?.()
  }
  if (state.state === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-2xs font-semibold text-st-passed-ink" role="status" data-testid="ci-rerun-run-done">
        <StatusMark status="passed" size={9} /> {state.message}
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className={WHY_BUTTON}
        onClick={(e) => {
          e.stopPropagation()
          void run()
        }}
        disabled={state.state === 'busy'}
        title="Re-run the failed jobs of this run on GitHub"
        data-testid="ci-rerun-run"
      >
        <IconRerun size={11} className={state.state === 'busy' ? 'motion-safe:animate-spin' : ''} />
        {state.state === 'busy' ? 'Re-running…' : label}
      </button>
      {state.state === 'error' && state.message && <ErrorLine text={state.message} fix={state.fix} />}
    </span>
  )
}
