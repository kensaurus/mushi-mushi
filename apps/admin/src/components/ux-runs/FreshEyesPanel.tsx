/**
 * FILE: apps/admin/src/components/ux-runs/FreshEyesPanel.tsx
 * PURPOSE: The Fresh eyes tab of UX runs (ADR 0053). A fresh-eyes run is a
 *          model playing someone who has never seen the app, trying one goal
 *          from the landing page while code times each step. This tab shows
 *          how long the last run took to reach the goal, where it stalled,
 *          each step with its screenshot and time, the trend over runs, and
 *          the reports it filed.
 *
 *          Runs start on the developer's computer (the browser and the model
 *          run there), so "Run now" is the exact command to paste.
 *
 * Data: GET /v1/admin/projects/:pid/fresh-eyes, GET …/fresh-eyes/:runId
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, CodeValue, DisclosurePanel, EmptyState, Loading, SegmentedControl, Sparkline, StatCard } from '../ui'
import { formatRelative } from '../ui/metrics'
import { PageLoadError } from '../PageLoadError'
import { usePageData } from '../../lib/usePageData'
import { useRealtimeReload } from '../../lib/realtime'
import {
  formatSeconds,
  freshEyesCommand,
  runHeadline,
  STALL_LABEL,
  stepNotes,
  ttfvTrend,
  type FreshEyesRunDetail,
  type FreshEyesRunListItem,
  type FreshEyesSession,
  type FreshEyesTrendPoint,
} from '../../lib/freshEyes'

const MUSHI_LANDING = 'https://kensaur.us/mushi-mushi/'
const DEFAULT_GOAL = 'get my first bug explained'

export function FreshEyesPanel({ projectId }: { projectId: string }) {
  const listPath = `/v1/admin/projects/${projectId}/fresh-eyes`
  const list = usePageData<{ runs: FreshEyesRunListItem[]; trend: FreshEyesTrendPoint[] }>(listPath)
  const runs = list.data?.runs ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  const runId = chosen ?? runs[0]?.local_run_id ?? null
  const detail = usePageData<FreshEyesRunDetail>(runId ? `${listPath}/${runId}` : null)
  useRealtimeReload([{ table: 'ux_runs', filter: `project_id=eq.${projectId}` }], () => {
    list.reload()
    detail.reload()
  })

  const latest = runs.find((r) => r.status === 'done') ?? runs[0] ?? null
  const trend = ttfvTrend(list.data?.trend ?? [])
  const command = freshEyesCommand({ url: latest?.start_url ?? MUSHI_LANDING, goal: latest?.goal ?? DEFAULT_GOAL, mushi: (latest?.start_url ?? MUSHI_LANDING).startsWith(MUSHI_LANDING) })

  return (
    <div className="flex flex-col gap-4" data-testid="fresh-eyes-panel">
      <p className="max-w-3xl text-xs text-fg-secondary">
        A fresh-eyes run is a first-time visitor: a model that has never seen your app tries one goal from your landing page, reading only what is on screen. Mushi times every step the app makes them wait, and files what stops them: errors, dead ends, a sign-in it cannot pass, a step that needs an inbox, a key or a terminal. Opinions such as &quot;confusing&quot; are filed only when two sessions agree.
      </p>

      {list.error && <PageLoadError error={list.error} resource="fresh-eyes runs" endpoint={listPath} onRetry={list.reload} />}
      {list.loading && !list.data && <Loading text="Loading fresh-eyes runs…" />}

      {latest && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Time to first value" value={formatSeconds(latest.ttfv_seconds)} detail="app wait and reading, not the model" />
          <StatCard label="Steps" value={latest.steps ?? 0} detail="median over sessions" />
          <StatCard label="Reached the goal" value={`${latest.reached ?? 0} of ${latest.counts?.sessions ?? 0}`} detail="sessions" />
          <Card className="flex flex-col gap-1 p-3" data-testid="fresh-eyes-trend">
            <span className="text-2xs text-fg-muted">Trend, last 90 days</span>
            {trend.length > 1 ? (
              <Sparkline values={trend} width={120} height={28} ariaLabel={`Time to first value over ${trend.length} runs`} />
            ) : (
              <span className="text-2xs text-fg-faint">Shows after two finished runs that reach the goal.</span>
            )}
          </Card>
        </div>
      )}

      <DisclosurePanel title={runs.length ? 'Run now' : 'Run your first fresh-eyes test'} defaultOpen={!runs.length}>
        <div className="flex flex-col gap-2 p-3 text-xs" data-testid="fresh-eyes-run-now">
          <p className="text-fg-secondary">
            Paste this in a terminal on your computer, where the Cursor CLI is signed in. The browser and the model run there; the run shows here when it ends. Add <code>--dry-run</code> to stop at the sign-up page and file nothing.
          </p>
          <CodeValue value={command} />
          <p className="text-2xs text-fg-muted">Starting it from this page through your local worker is not built yet.</p>
        </div>
      </DisclosurePanel>

      {list.data && runs.length === 0 && (
        <EmptyState title="No fresh-eyes runs yet" description="Run the command above. Each run shows here with its timeline and screenshots." />
      )}

      {runs.length > 0 && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <nav aria-label="Fresh-eyes runs" className="flex shrink-0 flex-col gap-1 lg:w-64">
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
                  {r.dry_run ? <Badge tone="neutral">Dry run</Badge> : null}
                </span>
                <span className="mt-0.5 block text-2xs text-fg-secondary">{runHeadline(r)}</span>
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {detail.error && <PageLoadError error={detail.error} resource="this run" endpoint={`${listPath}/${runId}`} onRetry={detail.reload} />}
            {detail.data && <FreshEyesRunView key={runId ?? ''} detail={detail.data} />}
          </div>
        </div>
      )}
    </div>
  )
}

function FreshEyesRunView({ detail }: { detail: FreshEyesRunDetail }) {
  const sessions = detail.run.timeline ?? []
  const [index, setIndex] = useState(String(sessions[0]?.index ?? 1))
  const session = sessions.find((s) => String(s.index) === index) ?? sessions[0]
  const findings = detail.run.findings ?? []
  return (
    <div className="flex flex-col gap-3" data-testid="fresh-eyes-run">
      <p className="text-xs text-fg-secondary">
        Goal: <span className="text-fg">“{detail.run.goal}”</span> from <span className="font-mono">{detail.run.start_url}</span>
        {detail.run.has_account ? ', with a test account' : ', with no account'}.
      </p>
      {sessions.length > 1 && (
        <SegmentedControl
          size="sm"
          ariaLabel="Sessions"
          value={index}
          options={sessions.map((s) => ({ id: String(s.index), label: `Session ${s.index}` }))}
          onChange={setIndex}
        />
      )}
      {session && <SessionTimeline session={session} shots={detail.shots} />}
      <section aria-label="Findings" className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold text-fg">What it found</h3>
        {findings.length === 0 && <p className="text-2xs text-fg-muted">Nothing confirmed.</p>}
        <ul className="flex flex-col gap-1">
          {findings.map((f) => (
            <li key={f.fingerprint} className="flex items-start gap-2 text-xs">
              <Badge tone={f.severity === 'high' ? 'dangerSubtle' : f.severity === 'medium' ? 'warnSubtle' : 'neutral'}>{f.severity}</Badge>
              <span className="text-fg-secondary">
                {f.summary} <span className="text-fg-faint">({f.basis === 'measured' ? 'measured' : `${f.sessions.length} sessions agreed`})</span>
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
