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
 *          offered only where the app turned them on and the caller may grant
 *          them (ADR 0073). The server decides both. A test can play one of
 *          the app's personas (/personas); ?persona=<id> picks it.
 *
 *          Layout (2026-11-19): a status block leads (the computer as a state
 *          mark, one sentence, the last test's numbers, and the fix command
 *          copied in one click when the computer cannot run a test); the run
 *          history is a list of state marks; a visitor's steps are a strip of
 *          screenshots with a wait/reading bar each on one scale.
 *
 * Data: GET /v1/admin/projects/:pid/fresh-eyes, GET …/fresh-eyes/:runId,
 *       POST …/fresh-eyes (Run now), POST …/fresh-eyes/:runId/cancel
 * Live: Realtime on ux_runs for the project.
 */

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Btn, Callout, Card, CodeValue, EmptyState, Input, Loading, SegmentedControl, Sparkline } from '../ui'
import { formatRelative } from '../ui/metrics'
import { PageLoadError } from '../PageLoadError'
import { PageStatus, toMetrics, type PageStatusMetric } from '../ui/page-status'
import { StatusMark, StatusPill, STATUS_WORD, type RunStatus } from '../signal/StatusMark'
import { PersonaAvatar } from '../personas/PersonaAvatar'
import { PersonaPicker } from '../personas/PersonaPicker'
import { formatUsd } from '../../lib/personas'
import { usePageData } from '../../lib/usePageData'
import { useRealtimeReload } from '../../lib/realtime'
import { apiFetch } from '../../lib/supabase'
import {
  formatSeconds,
  freshEyesStatus,
  isStartUrl,
  runHeadline,
  runMark,
  runnerFix,
  runnerMark,
  runnerMessage,
  runNowBlocker,
  STALL_LABEL,
  stepNotes,
  ttfvTrend,
  type FreshEyesListData,
  type FreshEyesPersona,
  type FreshEyesRunDetail,
  type FreshEyesRunListItem,
  type FreshEyesRunner,
  type FreshEyesSession,
  type FreshEyesStep,
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

  // The numbers come from the newest finished test that could sign up: a look-around test stops at sign-up by design (Home and the trend leave it out too).
  const latest = runs.find((r) => r.status === 'done' && !r.dry_run) ?? null
  const trend = ttfvTrend(list.data?.trend ?? [])
  const personas = list.data?.personas ?? []
  const personaOf = (id: string | null | undefined) => (id ? (personas.find((p) => p.id === id) ?? null) : null)

  return (
    <div className="flex flex-col gap-3" data-testid="fresh-eyes-panel">
      {list.error && <PageLoadError error={list.error} resource="first-time user tests" endpoint={listPath} onRetry={list.reload} />}
      {list.loading && !list.data && <Loading text="Loading first-time user tests…" />}

      {list.data && <FreshEyesStatus data={list.data} latest={latest} runCount={runs.length} />}

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

      {list.data && runs.length === 0 && (
        <EmptyState title="No tests yet" description="Each test shows here with every step the visitor took, its screenshot, how long the app made them wait, and what stopped them." />
      )}

      {runs.length > 0 && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <nav aria-label="First-time user tests" className="flex shrink-0 flex-col gap-2 lg:w-64">
            {trend.length > 1 && (
              <div className="flex items-center justify-between gap-2 rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1" data-testid="fresh-eyes-trend">
                <span className="text-2xs font-semibold text-fg-secondary">Time to goal, 90 days</span>
                <Sparkline values={trend} width={96} height={22} ariaLabel={`Time to first value over ${trend.length} tests`} />
              </div>
            )}
            <ul className="flex flex-col divide-y divide-edge-subtle rounded-sm border border-edge-subtle bg-surface-raised" data-testid="fresh-eyes-history">
              {runs.map((r) => (
                <RunHistoryRow key={r.local_run_id} run={r} persona={personaOf(r.persona_id)} current={r.local_run_id === runId} onPick={() => setChosen(r.local_run_id)} />
              ))}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {detail.error && <PageLoadError error={detail.error} resource="this test" endpoint={`${listPath}/${runId}`} onRetry={detail.reload} />}
            {detail.data && (
              <FreshEyesRunView key={runId ?? ''} projectId={projectId} detail={detail.data} persona={personaOf(detail.data.run.persona_id)} runner={list.data?.runner ?? null} onChanged={list.reload} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The page's lead: the computer's state as a mark, one sentence, the last test's numbers, and
 * the fix in place when the computer cannot run a test (2026-11-19: "alienwarex16 offline"
 * blocked Run now with nothing to press). The command copies in one click.
 */
function FreshEyesStatus({ data, latest, runCount }: { data: FreshEyesListData; latest: FreshEyesRunListItem | null; runCount: number }) {
  const status = freshEyesStatus(data.runner, latest)
  const mark = runnerMark(data.runner)
  const machine = runnerMessage(data.runner)
  const fix = runnerFix(data.runner)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!fix) return
    try {
      await navigator.clipboard.writeText(fix.command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  const reached = latest?.reached ?? 0
  const sessions = latest?.counts?.sessions ?? 0
  const metrics: PageStatusMetric[] = latest
    ? [
        { label: 'Time to first value', value: formatSeconds(latest.ttfv_seconds), hint: "App wait and reading time in the last test that could sign up; the model's own think time is not counted." },
        { label: 'Reached the goal', value: `${reached} of ${sessions}`, tone: reached === 0 ? 'danger' : reached < sessions ? 'warn' : 'ok' },
        { label: 'Tests', value: runCount },
      ]
    : [{ label: 'Tests', value: runCount }]
  const workers = (
    <Btn size="sm" variant={fix || machine.canRun ? 'ghost' : 'primary'} to="/pipeline?tab=workers">
      Open Workers
    </Btn>
  )
  return (
    <PageStatus
      ariaLabel="Test status"
      marked
      tone={status.tone}
      metrics={toMetrics(metrics)}
      data-testid="fresh-eyes-status"
      sentence={
        <span className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={mark.status} label={mark.label} />
            <span data-testid="fresh-eyes-runner">{status.sentence}</span>
          </span>
          {fix && (
            <span className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary" data-testid="fresh-eyes-fix">
              <CodeValue inline value={fix.command} />
              {fix.after && <span>{fix.after}</span>}
            </span>
          )}
        </span>
      }
      action={
        fix ? (
          <>
            <Btn size="sm" variant="primary" onClick={() => void copy()} data-testid="fresh-eyes-fix-copy">
              {copied ? 'Copied' : fix.label}
            </Btn>
            {workers}
          </>
        ) : !machine.canRun ? (
          workers
        ) : (
          <Btn size="sm" variant="primary" onClick={() => document.getElementById('fresh-eyes-run-now')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            Start a test
          </Btn>
        )
      }
    />
  )
}

/** One test in the history: a state mark, when, and the result in one line. */
function RunHistoryRow({ run: r, persona, current, onPick }: { run: FreshEyesRunListItem; persona: FreshEyesPersona | null; current: boolean; onPick: () => void }) {
  const mark: RunStatus = runMark(r)
  const headline = runHeadline(r)
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={current}
        className={`flex w-full items-start gap-2 border-l-2 px-2 py-1.5 text-left text-xs hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${current ? 'border-l-brand bg-surface-overlay' : 'border-l-transparent'}`}
        data-status={mark}
      >
        <StatusMark status={mark} label={STATUS_WORD[mark]} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-fg">{formatRelative(r.started_at)}</span>
            {r.dry_run ? <span className="rounded-xs border border-edge-subtle px-1 text-3xs text-fg-secondary">Look around</span> : null}
          </span>
          {persona && (
            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-2xs text-fg-secondary" data-testid="fresh-eyes-history-persona">
              <PersonaAvatar persona={persona} size="sm" decorative />
              <span className="truncate">{persona.name}</span>
            </span>
          )}
          <span className="block truncate text-2xs text-fg-secondary" title={headline}>
            {headline}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Start a test: where the visitor starts, what they came to do, and how. One button. */
function RunNowCard({ projectId, data, onQueued }: { projectId: string; data: FreshEyesListData; onQueued: (runId: string) => void }) {
  const defaults = data.defaults
  // Who the test plays: ?persona=<id> from the studio's "Test with this persona", else a plain visitor.
  const personas = data.personas ?? []
  const [params] = useSearchParams()
  const [personaId, setPersonaId] = useState<string | null>(() => {
    const asked = params.get('persona')
    return asked && personas.some((p) => p.id === asked) ? asked : null
  })
  const persona = personas.find((p) => p.id === personaId) ?? null
  const [url, setUrl] = useState(defaults?.url ?? '')
  const [goal, setGoal] = useState(() => persona?.goal ?? defaults?.goal ?? '')
  // A goal the person typed is theirs; until then, picking a persona fills in what it came to do.
  const [goalTouched, setGoalTouched] = useState(false)
  const [userPicked, setUserPicked] = useState(false)
  // The first paint can be an older cached list without a persona just added in the studio:
  // pick the asked-for one when the fresh list brings it, unless the person already chose.
  const asked = params.get('persona')
  const askedPersona = asked ? (data.personas?.find((p) => p.id === asked) ?? null) : null
  useEffect(() => {
    if (!askedPersona || userPicked || personaId === askedPersona.id) return
    setPersonaId(askedPersona.id)
    if (!goalTouched) setGoal(askedPersona.goal ?? defaults?.goal ?? '')
  }, [askedPersona, userPicked, personaId, goalTouched, defaults?.goal])
  const [successText, setSuccessText] = useState('')
  const [sessions, setSessions] = useState(String(defaults?.sessions ?? 3))
  const [mode, setMode] = useState<Mode>('look')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState<string | null>(null)
  const [reservedUsd, setReservedUsd] = useState<number | null>(null)
  // The defaults arrive with the first read; a field the person already typed in keeps their words.
  useEffect(() => {
    if (defaults?.url) setUrl((u) => u || defaults.url!)
    if (defaults?.goal) setGoal((g) => g || defaults.goal)
  }, [defaults?.url, defaults?.goal])

  const status = runnerMessage(data.runner)
  const urlOk = isStartUrl(url)
  const goalOk = goal.trim().length > 0 && goal.trim().length <= 300
  const canRun = status.canRun && urlOk && goalOk && !busy
  const blocker = runNowBlocker({ runnerCanRun: status.canRun, runnerSetup: status.setup, url, goal })
  const accounts = data.testAccounts ?? null

  function pickPersona(id: string | null) {
    setUserPicked(true)
    setPersonaId(id)
    if (goalTouched) return
    const next = personas.find((p) => p.id === id) ?? null
    setGoal(next?.goal ?? defaults?.goal ?? '')
  }

  async function runNow() {
    setBusy(true)
    setError(null)
    setQueued(null)
    setReservedUsd(null)
    const res = await apiFetch<{ runId: string; runner: FreshEyesRunner; personaId?: string | null; reservedUsd?: number | null }>(`/v1/admin/projects/${projectId}/fresh-eyes`, {
      method: 'POST',
      body: JSON.stringify({
        url: url.trim(),
        goal: goal.trim(),
        sessions: Number(sessions),
        successText: successText.trim() || null,
        dryRun: mode === 'look',
        withAccount: mode === 'account',
        ...(persona ? { personaId: persona.id } : {}),
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'The test was not started. Try again in a minute.')
      return
    }
    setQueued(res.data?.runId ?? null)
    setReservedUsd(typeof res.data?.reservedUsd === 'number' ? res.data.reservedUsd : null)
    if (res.data?.runId) onQueued(res.data.runId)
  }

  const modes: Array<{ id: Mode; label: string }> = [
    { id: 'look', label: 'Look around, file nothing' },
    { id: 'file', label: 'File what stops them' },
    ...(data.canUseTestAccount ? [{ id: 'account' as const, label: 'Sign up with test accounts' }] : []),
  ]

  return (
    <Card id="fresh-eyes-run-now" className="flex scroll-mt-4 flex-col gap-3 p-3" data-testid="fresh-eyes-run-now">
      {/* The computer's state and its fix lead the page (FreshEyesStatus above); the card only
          says who runs the test once it can run (2026-11-19, moved out of the card). */}
      <h2 className="text-sm font-semibold text-fg">Run a first-time user test</h2>

      <PersonaPicker personas={personas} value={persona?.id ?? null} onChange={pickPersona} />

      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Start page"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-app.com"
          error={url && !urlOk ? 'Use a web address that starts with https://' : undefined}
        />
        <Input
          label="What a new visitor came to do"
          value={goal}
          onChange={(e) => {
            setGoalTouched(true)
            setGoal(e.target.value)
          }}
          placeholder="sign up and start using the app"
          maxLength={300}
        />
        <Input
          label="Done when the page shows (optional)"
          value={successText}
          onChange={(e) => setSuccessText(e.target.value)}
          placeholder="e.g. Your dashboard"
          maxLength={120}
        />
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium text-fg-muted" title="With 2 or more, an opinion such as “confusing” counts only when two visitors agree.">
            Visitors
          </span>
          <SegmentedControl
            size="sm"
            ariaLabel="Visitors"
            value={sessions}
            // "1 / 2 / 3" were 18 px targets, under WCAG 2.5.8's 24 px (axe, audit 2026-11-21).
            options={['1', '2', '3'].map((n) => ({ id: n, label: n === '1' ? '1 visitor' : `${n} visitors` }))}
            onChange={setSessions}
            className="self-start"
          />
        </div>
      </div>
      {!successText.trim() && (
        <p className="text-2xs text-fg-muted">Without words to look for, the test shows where visitors got stuck but cannot time how long it took to get there.</p>
      )}

      <div className="flex flex-col gap-1">
        <SegmentedControl<Mode> size="sm" wrap ariaLabel="What the test may do" value={mode} options={modes} onChange={setMode} className="self-start" />
        <span className="text-2xs text-fg-muted">
          {mode === 'look' && 'The visitor reads and clicks but never sends a form, and nothing becomes a report. It stops at the sign-up page.'}
          {mode === 'file' && 'Same visit; what stops the visitor (errors, dead ends, a step that needs a terminal or an inbox) is filed as a bug report.'}
          {mode === 'account' &&
            `Each visitor signs up with its own test account, made for this test${accounts?.mode === 'hook' ? " by your app's test-account hook" : ''} and deleted after a day.`}
        </span>
        {!data.canUseTestAccount && accounts?.unavailable && (
          <span className="text-2xs text-fg-muted" data-testid="fresh-eyes-accounts-unavailable">
            {accounts.unavailable}
            {accounts.mode === 'off' && (
              <>
                {' '}
                <Link className="text-brand underline underline-offset-2" to="/personas">
                  Open Personas
                </Link>
              </>
            )}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Btn onClick={runNow} disabled={!canRun} loading={busy} data-testid="fresh-eyes-run-button">
          Run now
        </Btn>
        {status.canRun && !blocker && !busy && !queued && <span className="text-2xs text-fg-muted">{status.text}</span>}
        {blocker && !busy && (
          <span className="text-2xs text-fg-secondary" data-testid="fresh-eyes-run-blocker">
            {blocker}
          </span>
        )}
        {queued && <span className="text-2xs text-fg-secondary">Started. It shows below and updates by itself.</span>}
        {queued && reservedUsd != null && (
          <span className="text-2xs text-fg-muted" data-testid="fresh-eyes-reserved">
            Holding up to {formatUsd(reservedUsd)} of AI budget for this test; what it does not use comes back when it ends.
          </span>
        )}
        {error && (
          <span role="alert" className="text-2xs text-danger">
            {error}
          </span>
        )}
      </div>
    </Card>
  )
}

function FreshEyesRunView({
  projectId,
  detail,
  persona,
  runner,
  onChanged,
}: {
  projectId: string
  detail: FreshEyesRunDetail
  persona: FreshEyesPersona | null
  runner: FreshEyesRunner | null
  onChanged: () => void
}) {
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
      {persona && (
        <p className="flex items-center gap-2 text-xs text-fg-secondary" data-testid="fresh-eyes-run-persona">
          <PersonaAvatar persona={persona} size="sm" decorative />
          <span>
            Played by <span className="font-semibold text-fg">{persona.name}</span>
          </span>
        </p>
      )}
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
                <StatusPill status={SEVERITY_MARK[f.severity].status} label={SEVERITY_MARK[f.severity].label} />
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

const SEVERITY_MARK: Record<'high' | 'medium' | 'low', { status: RunStatus; label: string }> = {
  high: { status: 'failed', label: 'High' },
  medium: { status: 'slow', label: 'Medium' },
  low: { status: 'idle', label: 'Low' },
}

/** App wait (dark teal; amber when it hit the 20 s cap) and reading (light teal), stacked on the session's shared scale. */
function StepTimeBar({ step: st, maxMs }: { step: FreshEyesStep; maxMs: number }) {
  const pct = (ms: number) => (maxMs > 0 ? Math.max(0, Math.min(100, (ms / maxMs) * 100)) : 0)
  const label = `${formatSeconds(st.app_ms / 1000)} wait${st.read_ms > 0 ? ` · ${formatSeconds(st.read_ms / 1000)} read` : ''}`
  return (
    <span className="flex min-w-0 flex-col gap-0.5" title={`App wait ${formatSeconds(st.app_ms / 1000)}${st.read_ms > 0 ? `, reading ${formatSeconds(st.read_ms / 1000)}` : ''}`}>
      <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay" aria-hidden="true">
        <span className={`ci-grow-x h-full ${st.capped ? 'bg-st-slow' : 'ci-heat-5'}`} style={{ width: `${pct(st.app_ms)}%` }} />
        <span className="ci-grow-x h-full ci-heat-2" style={{ width: `${pct(st.read_ms)}%` }} />
      </span>
      <span className="truncate font-mono text-3xs font-bold text-fg tabular-nums">{label}</span>
    </span>
  )
}

/** Where the session's time went: app wait and reading counted, the model's think time not. */
function SessionTimeSplit({ session }: { session: FreshEyesSession }) {
  const total = session.app_seconds + session.read_seconds
  const appPct = total > 0 ? (session.app_seconds / total) * 100 : 0
  return (
    <div className="flex flex-col gap-1">
      <span className="flex h-2 w-full max-w-md overflow-hidden rounded-sm bg-surface-overlay" aria-hidden="true">
        <span className="ci-grow-x h-full ci-heat-5" style={{ width: `${appPct}%` }} />
        <span className="ci-grow-x h-full ci-heat-2" style={{ width: `${total > 0 ? 100 - appPct : 0}%` }} />
      </span>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-fg-secondary">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 rounded-xs ci-heat-5" aria-hidden="true" />
          App wait <span className="font-mono font-bold text-fg tabular-nums">{formatSeconds(session.app_seconds)}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 rounded-xs ci-heat-2" aria-hidden="true" />
          Reading <span className="font-mono font-bold text-fg tabular-nums">{formatSeconds(session.read_seconds)}</span>
        </span>
        {session.backtracks > 0 && <span>Went back {session.backtracks}×</span>}
        <span className="text-fg-muted">The model&apos;s own think time ({formatSeconds(session.model_seconds)}) is not counted</span>
      </p>
    </div>
  )
}

function SessionTimeline({ session, shots }: { session: FreshEyesSession; shots: Record<string, string> }) {
  const maxMs = Math.max(1, ...session.steps.map((s) => s.app_ms + s.read_ms))
  const reached = session.outcome === 'reached'
  return (
    <div className="flex flex-col gap-2" data-testid="fresh-eyes-timeline">
      <Card className="flex flex-col gap-1.5 px-3 py-2 text-xs">
        <p className="flex items-start gap-2 font-semibold text-fg">
          <StatusMark status={reached ? 'passed' : 'failed'} label={reached ? 'Reached the goal' : 'Stalled'} className="mt-0.5" />
          {reached ? (
            <span>
              Reached the goal in {session.steps.length - 1} steps,{' '}
              {session.ttfv_seconds == null ? 'but a wait hit the 20 s limit, so the time is not measured' : `${formatSeconds(session.ttfv_seconds)} to first value`}.
            </span>
          ) : (
            <span>
              {STALL_LABEL[session.stall?.reason ?? 'out_of_steps']} at <span className="font-mono">{session.stall?.screen}</span>, step {session.stall?.step}.
            </span>
          )}
        </p>
        {session.stall?.detail && <p className="pl-5 text-fg-secondary">{session.stall.detail}</p>}
        <SessionTimeSplit session={session} />
      </Card>
      {/* The steps as a strip: screenshot, what the visitor did, and how long the app made them
          wait and read, on one scale (2026-11-19: a long text column per step). */}
      <ol className="flex gap-2 overflow-x-auto pb-1" aria-label="Steps the visitor took" data-testid="fresh-eyes-steps">
        {session.steps.map((st, i) => {
          const notes = stepNotes(st)
          const url = st.shot ? shots[st.shot] : undefined
          const stalledHere = !!session.stall && st.n === session.stall.step && i === session.steps.length - 1
          const goalHere = reached && i === session.steps.length - 1
          return (
            <li
              key={`${st.n}-${i}`}
              className={`flex w-36 shrink-0 flex-col gap-1 rounded-sm border p-1 ${stalledHere ? 'border-st-failed bg-st-failed-soft' : 'border-edge-subtle bg-surface-raised'}`}
              title={`${st.n}. ${st.action}\n${st.screen}`}
              data-stalled={stalledHere || undefined}
            >
              <span className="relative block">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="block">
                    <img src={url} alt={`Step ${st.n}: ${st.screen}`} loading="lazy" className="h-20 w-full rounded-xs border border-edge-subtle object-cover object-top" />
                  </a>
                ) : (
                  <span className="block h-20 w-full rounded-xs border border-dashed border-edge-subtle" aria-hidden />
                )}
                <span className="absolute top-0.5 left-0.5 inline-flex items-center gap-0.5 rounded-xs bg-surface-raised px-1 font-mono text-3xs font-bold text-fg">
                  {stalledHere ? <StatusMark status="failed" label="Stalled here" size={10} /> : goalHere ? <StatusMark status="passed" label="Goal reached" size={10} /> : null}
                  {st.n}
                </span>
              </span>
              <span className="truncate text-2xs font-semibold text-fg">{st.action}</span>
              <span className="truncate font-mono text-3xs text-fg-muted">{st.screen}</span>
              <StepTimeBar step={st} maxMs={maxMs} />
              {notes.length > 0 && (
                <span className="line-clamp-2 text-3xs text-fg-secondary" title={notes.join(' · ')}>
                  {notes.join(' · ')}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
