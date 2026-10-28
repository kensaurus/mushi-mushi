/**
 * FILE: apps/admin/src/components/ux-runs/FreshEyesPanel.tsx
 * PURPOSE: The First-time user test (fresh-eyes runs, ADR 0053 and its
 *          2026-10-28 amendment). A model plays someone who has never seen
 *          the app and tries one goal from its start page while code times
 *          each step. This panel starts a test with one click (Run now: a
 *          computer of the user's runs it), says plainly when no computer
 *          can, and shows how long the last test took to reach the goal,
 *          where it stalled, each step with its screenshot, the trend and
 *          the reports it filed.
 *
 *          The start page and goal come from the app itself (its last test,
 *          its live-site watch or site audit address); test accounts are
 *          offered only where they can work (Mushi's own project, for its
 *          operators). The server decides both.
 *
 * Data: GET /v1/admin/projects/:pid/fresh-eyes, GET …/fresh-eyes/:runId,
 *       POST …/fresh-eyes (Run now), POST …/fresh-eyes/:runId/cancel
 * Live: Realtime on ux_runs for the project.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn, Callout, Card, CodeValue, EmptyState, Input, Loading, SegmentedControl, Sparkline, StatCard } from '../ui'
import { formatRelative } from '../ui/metrics'
import { PageLoadError } from '../PageLoadError'
import { usePageData } from '../../lib/usePageData'
import { useRealtimeReload } from '../../lib/realtime'
import { apiFetch } from '../../lib/supabase'
import {
  formatSeconds,
  isStartUrl,
  RUN_STATUS_META,
  runHeadline,
  runnerMessage,
  STALL_LABEL,
  stepNotes,
  ttfvTrend,
  type FreshEyesListData,
  type FreshEyesRunDetail,
  type FreshEyesRunner,
  type FreshEyesSession,
} from '../../lib/freshEyes'

type Mode = 'look' | 'file' | 'account'

export function FreshEyesPanel({ projectId }: { projectId: string }) {
  const listPath = `/v1/admin/projects/${projectId}/fresh-eyes`
  const list = usePageData<FreshEyesListData>(listPath)
  const runs = list.data?.runs ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  const runId = chosen ?? runs[0]?.local_run_id ?? null
  const detail = usePageData<FreshEyesRunDetail>(runId ? `${listPath}/${runId}` : null)
  useRealtimeReload([{ table: 'ux_runs', filter: `project_id=eq.${projectId}` }], () => {
    list.reload()
    detail.reload()
  })

  const latest = runs.find((r) => r.status === 'done') ?? null
  const trend = ttfvTrend(list.data?.trend ?? [])

  return (
    <div className="flex flex-col gap-4" data-testid="fresh-eyes-panel">
      {list.error && <PageLoadError error={list.error} resource="first-time user tests" endpoint={listPath} onRetry={list.reload} />}
      {list.loading && !list.data && <Loading text="Loading first-time user tests…" />}

      {list.data && (
        <RunNowCard
          key={projectId}
          projectId={projectId}
          data={list.data}
          onQueued={(id) => {
            setChosen(id)
            list.reload()
          }}
        />
      )}

      {latest && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Time to first value" value={formatSeconds(latest.ttfv_seconds)} detail="app wait and reading, not the model" />
          <StatCard label="Steps" value={latest.steps ?? 0} detail="median over visitors" />
          <StatCard label="Reached the goal" value={`${latest.reached ?? 0} of ${latest.counts?.sessions ?? 0}`} detail="visitors" />
          <Card className="flex flex-col gap-1 p-3" data-testid="fresh-eyes-trend">
            <span className="text-2xs text-fg-muted">Trend, last 90 days</span>
            {trend.length > 1 ? (
              <Sparkline values={trend} width={120} height={28} ariaLabel={`Time to first value over ${trend.length} tests`} />
            ) : (
              <span className="text-2xs text-fg-faint">Shows after two finished tests that reach the goal.</span>
            )}
          </Card>
        </div>
      )}

      {list.data && runs.length === 0 && (
        <EmptyState title="No tests yet" description="Each test shows here with every step the visitor took, its screenshot, how long the app made them wait, and what stopped them." />
      )}

      {runs.length > 0 && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <nav aria-label="First-time user tests" className="flex shrink-0 flex-col gap-1 lg:w-64">
            {runs.map((r) => (
              <button
                key={r.local_run_id}
                type="button"
                onClick={() => setChosen(r.local_run_id)}
                aria-current={r.local_run_id === runId}
                className={`rounded-md border px-3 py-2 text-left text-xs ${r.local_run_id === runId ? 'border-brand/40 bg-surface-raised' : 'border-edge-subtle hover:bg-surface-raised'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg">{formatRelative(r.started_at)}</span>
                  <span className="flex items-center gap-1">
                    {r.dry_run ? <Badge tone="neutral">Look around</Badge> : null}
                    {r.status !== 'done' && <Badge tone={RUN_STATUS_META[r.status]?.tone ?? 'neutral'}>{RUN_STATUS_META[r.status]?.label ?? r.status}</Badge>}
                  </span>
                </span>
                <span className="mt-0.5 block text-2xs text-fg-secondary">{runHeadline(r)}</span>
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {detail.error && <PageLoadError error={detail.error} resource="this test" endpoint={`${listPath}/${runId}`} onRetry={detail.reload} />}
            {detail.data && <FreshEyesRunView key={runId ?? ''} projectId={projectId} detail={detail.data} runner={list.data?.runner ?? null} onChanged={list.reload} />}
          </div>
        </div>
      )}
    </div>
  )
}

/** Start a test: where the visitor starts, what they came to do, and how. One button. */
function RunNowCard({ projectId, data, onQueued }: { projectId: string; data: FreshEyesListData; onQueued: (runId: string) => void }) {
  const defaults = data.defaults
  const [url, setUrl] = useState(defaults?.url ?? '')
  const [goal, setGoal] = useState(defaults?.goal ?? '')
  const [successText, setSuccessText] = useState('')
  const [sessions, setSessions] = useState(String(defaults?.sessions ?? 3))
  const [mode, setMode] = useState<Mode>('look')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState<string | null>(null)
  // The defaults arrive with the first read; a field the person already typed in keeps their words.
  useEffect(() => {
    if (defaults?.url) setUrl((u) => u || defaults.url!)
    if (defaults?.goal) setGoal((g) => g || defaults.goal)
  }, [defaults?.url, defaults?.goal])

  const status = runnerMessage(data.runner)
  const urlOk = isStartUrl(url)
  const goalOk = goal.trim().length > 0 && goal.trim().length <= 300
  const canRun = status.canRun && urlOk && goalOk && !busy

  async function runNow() {
    setBusy(true)
    setError(null)
    setQueued(null)
    const res = await apiFetch<{ runId: string; runner: FreshEyesRunner }>(`/v1/admin/projects/${projectId}/fresh-eyes`, {
      method: 'POST',
      body: JSON.stringify({ url: url.trim(), goal: goal.trim(), sessions: Number(sessions), successText: successText.trim() || null, dryRun: mode === 'look', withAccount: mode === 'account' }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'The test was not started. Try again in a minute.')
      return
    }
    setQueued(res.data?.runId ?? null)
    if (res.data?.runId) onQueued(res.data.runId)
  }

  const modes: Array<{ id: Mode; label: string }> = [
    { id: 'look', label: 'Look around, file nothing' },
    { id: 'file', label: 'File what stops them' },
    ...(data.canUseTestAccount ? [{ id: 'account' as const, label: 'Sign up with test accounts' }] : []),
  ]

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="fresh-eyes-run-now">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-fg">Run a first-time user test</h2>
        <p className="max-w-3xl text-xs text-fg-secondary">
          An AI that has never seen your app opens it and tries to do one thing, reading only what is on screen. Mushi times every step and shows you where it got stuck.
        </p>
      </div>

      <Callout tone={status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : 'info'} className="text-xs">
        <p className="text-fg-secondary" data-testid="fresh-eyes-runner">{status.text}</p>
        {status.setup === 'install' && (
          <div className="mt-2 flex flex-col gap-2">
            <CodeValue value="mushi worker install" />
            <Link className="text-2xs font-medium text-brand hover:underline" to="/pipeline?tab=workers">
              Open Workers to see your computers →
            </Link>
          </div>
        )}
        {status.setup === 'workers' && (
          <Link className="mt-1 inline-block text-2xs font-medium text-brand hover:underline" to="/pipeline?tab=workers">
            Open Workers →
          </Link>
        )}
      </Callout>

      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Start page"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-app.com"
          error={url && !urlOk ? 'Use a web address that starts with https://' : undefined}
        />
        <Input label="What a new visitor came to do" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="sign up and start using the app" maxLength={300} />
        <Input
          label="Done when the page shows (optional)"
          value={successText}
          onChange={(e) => setSuccessText(e.target.value)}
          placeholder="e.g. Your dashboard"
          maxLength={120}
        />
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium text-fg-muted">Visitors</span>
          <SegmentedControl
            size="sm"
            ariaLabel="Visitors"
            value={sessions}
            options={['1', '2', '3'].map((n) => ({ id: n, label: n }))}
            onChange={setSessions}
          />
          <span className="text-2xs text-fg-faint">With 2 or more, an opinion such as &quot;confusing&quot; counts only when two visitors agree.</span>
        </div>
      </div>
      {!successText.trim() && !url.startsWith('https://kensaur.us/mushi-mushi') && (
        <p className="text-2xs text-fg-muted">Without words to look for, the test shows where visitors got stuck but cannot time how long it took to get there.</p>
      )}

      <div className="flex flex-col gap-1">
        <SegmentedControl<Mode> size="sm" ariaLabel="What the test may do" value={mode} options={modes} onChange={setMode} />
        <span className="text-2xs text-fg-muted">
          {mode === 'look' && 'The visitor reads and clicks but never sends a form, and nothing becomes a report. It stops at the sign-up page.'}
          {mode === 'file' && 'Same visit; what stops the visitor (errors, dead ends, a step that needs a terminal or an inbox) is filed as a bug report.'}
          {mode === 'account' && 'Each visitor signs up with its own test account, made for this test and deleted after a day. Only for Mushi itself.'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Btn onClick={runNow} disabled={!canRun} loading={busy} data-testid="fresh-eyes-run-button">
          Run now
        </Btn>
        {queued && <span className="text-2xs text-fg-secondary">Started. It shows below and updates by itself.</span>}
        {error && (
          <span role="alert" className="text-2xs text-danger">
            {error}
          </span>
        )}
      </div>
    </Card>
  )
}

function FreshEyesRunView({ projectId, detail, runner, onChanged }: { projectId: string; detail: FreshEyesRunDetail; runner: FreshEyesRunner | null; onChanged: () => void }) {
  const sessions = detail.run.timeline ?? []
  const [index, setIndex] = useState(String(sessions[0]?.index ?? 1))
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const session = sessions.find((s) => String(s.index) === index) ?? sessions[0]
  const findings = detail.run.findings ?? []
  const run = detail.run

  async function cancel() {
    setCancelling(true)
    setCancelError(null)
    const res = await apiFetch(`/v1/admin/projects/${projectId}/fresh-eyes/${run.local_run_id}/cancel`, { method: 'POST' })
    setCancelling(false)
    if (!res.ok) setCancelError(res.error?.message ?? 'It could not be cancelled.')
    else onChanged()
  }

  return (
    <div className="flex flex-col gap-3" data-testid="fresh-eyes-run">
      <p className="text-xs text-fg-secondary">
        Goal: <span className="text-fg">“{run.goal}”</span> from <span className="font-mono">{run.start_url}</span>
        {run.dry_run ? ', looking around only' : run.has_account ? ', with a test account' : ', with no account'}.
      </p>
      {run.status === 'queued' && (
        <Callout tone="info" className="text-xs">
          <p className="text-fg-secondary" data-testid="fresh-eyes-run-state">
            Waiting for {runner?.hostname ?? 'your computer'} to start it. {runner?.state === 'busy' ? 'It is busy with another job right now.' : 'This usually takes about a minute.'}
          </p>
          <Btn variant="ghost" size="sm" className="mt-2" onClick={cancel} loading={cancelling}>
            Cancel
          </Btn>
          {cancelError && <p className="mt-1 text-2xs text-danger">{cancelError}</p>}
        </Callout>
      )}
      {run.status === 'running' && sessions.length === 0 && (
        <Callout tone="info" className="text-xs">
          <p className="text-fg-secondary" data-testid="fresh-eyes-run-state">
            Running on your computer. Each visitor takes a few minutes; the steps show here when the test ends.
          </p>
        </Callout>
      )}
      {(run.status === 'failed' || run.status === 'stopped') && run.detail && (
        <Callout tone={run.status === 'failed' ? 'danger' : 'neutral'} className="text-xs">
          <p className="text-fg-secondary" data-testid="fresh-eyes-run-state">
            {run.status === 'failed' ? 'It failed: ' : ''}
            {run.detail}
          </p>
        </Callout>
      )}
      {run.status === 'done' && run.detail && <p className="text-2xs text-fg-muted">{run.detail}</p>}
      {sessions.length > 1 && (
        <SegmentedControl
          size="sm"
          ariaLabel="Visitors"
          value={index}
          options={sessions.map((s) => ({ id: String(s.index), label: `Visitor ${s.index}` }))}
          onChange={setIndex}
        />
      )}
      {session && <SessionTimeline session={session} shots={detail.shots} />}
      {(run.status === 'done' || findings.length > 0) && (
        <section aria-label="Findings" className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-fg">What it found</h3>
          {findings.length === 0 && <p className="text-2xs text-fg-muted">Nothing confirmed.</p>}
          <ul className="flex flex-col gap-1">
            {findings.map((f) => (
              <li key={f.fingerprint} className="flex items-start gap-2 text-xs">
                <Badge tone={f.severity === 'high' ? 'dangerSubtle' : f.severity === 'medium' ? 'warnSubtle' : 'neutral'}>{f.severity}</Badge>
                <span className="text-fg-secondary">
                  {f.summary} <span className="text-fg-faint">({f.basis === 'measured' ? 'measured' : `${f.sessions.length} visitors agreed`})</span>
                </span>
              </li>
            ))}
          </ul>
          {detail.reports.length > 0 && (
            <p className="text-2xs text-fg-muted">
              Filed as{' '}
              {detail.reports.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ', '}
                  <Link className="underline" to={`/reports/${r.id}`}>
                    {r.title.slice(0, 60)}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function SessionTimeline({ session, shots }: { session: FreshEyesSession; shots: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-2" data-testid="fresh-eyes-timeline">
      <Card className="p-3 text-xs">
        {session.outcome === 'reached' ? (
          <p className="font-medium text-fg">Reached the goal in {session.steps.length - 1} steps, {formatSeconds(session.ttfv_seconds)} to first value.</p>
        ) : (
          <p className="font-medium text-fg">
            {STALL_LABEL[session.stall?.reason ?? 'out_of_steps']} at <span className="font-mono">{session.stall?.screen}</span>, step {session.stall?.step}.
          </p>
        )}
        {session.stall?.detail && <p className="mt-1 text-fg-secondary">{session.stall.detail}</p>}
        <p className="mt-1 text-2xs text-fg-muted">
          App wait {formatSeconds(session.app_seconds)} · reading {formatSeconds(session.read_seconds)} · {session.backtracks} time(s) went back · the model&apos;s own think time ({formatSeconds(session.model_seconds)}) is not counted
        </p>
      </Card>
      <ol className="flex flex-col gap-2">
        {session.steps.map((st, i) => {
          const notes = stepNotes(st)
          const url = st.shot ? shots[st.shot] : undefined
          const stalledHere = session.stall && st.n === session.stall.step && i === session.steps.length - 1
          return (
            <li key={`${st.n}-${i}`} className={`flex gap-3 rounded-md border p-2 ${stalledHere ? 'border-danger/40' : 'border-edge-subtle'}`}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={url} alt={`Step ${st.n}: ${st.screen}`} loading="lazy" className="h-20 w-32 rounded-sm border border-edge-subtle object-cover object-top" />
                </a>
              ) : (
                <span className="h-20 w-32 shrink-0 rounded-sm border border-dashed border-edge-subtle" aria-hidden />
              )}
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-medium text-fg">
                  {st.n}. {st.action}
                </p>
                <p className="truncate font-mono text-2xs text-fg-muted">{st.screen}</p>
                <p className="text-2xs text-fg-secondary">
                  App wait {formatSeconds(st.app_ms / 1000)}
                  {st.read_ms > 0 ? ` · reading ${formatSeconds(st.read_ms / 1000)}` : ''}
                </p>
                {notes.length > 0 && <p className="text-2xs text-fg-secondary">{notes.join(' · ')}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
