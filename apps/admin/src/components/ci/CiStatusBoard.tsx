/**
 * FILE: apps/admin/src/components/ci/CiStatusBoard.tsx
 * PURPOSE: The top of the CI page in plain words (2026-11-16). It answers, from the screen
 *          alone and in this order:
 *            1. Is CI OK right now? (one sentence)
 *            2. Which machine is running what? (a card per real machine, by name)
 *            3. When will each job finish? (usual time, time left, "slower than usual")
 *            4. What broke, and where? (one group per PR, the failing step named)
 *            5. What slows each app down this week? (waiting / failing / slow)
 *          The owner could not answer any of these from runner ids, a stats grid whose
 *          "typical run time 1 min" sat beside a 12-minute job, and a 4-column graph.
 *          Data and rules: lib/ciStatus.ts.
 */
import { useMemo } from 'react'
import type { CiOverview } from '../../lib/ciTypes'
import { buildCiStatus, durationWords, estimateLine, groupFailures, type CiStatus, type FailureGroup, type MachineNow, type RunningNow } from '../../lib/ciStatus'
import { ciJobKey, ciJobKeys, ciRepoKey, useCiLink } from '../../lib/ciHighlight'
import { divergeClass } from '../../lib/ciWeek'
import { formatPercent } from '../../lib/ciView'
import { LINK_ACCENT } from '../../lib/chipTone'
import { useNow } from '../../lib/useNow'
import { Badge, Card, DataTableCell, DataTableHead, RelativeTime } from '../ui'
import { IconExternalLink } from '../icons'
import { CI_OUTCOME_STYLE } from './ciOutcome'

const TONE_BOX: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'border-ok/35 bg-ok-muted/40',
  warn: 'border-warn/40 bg-warn-muted/40',
  bad: 'border-danger/40 bg-danger-muted/40',
}
/**
 * Machine cards by the width they get, not the viewport: the same cards fill the Machines view,
 * two thirds of a wide Now view, or a phone. 1 → 2 → 3 → 4 → 5 columns.
 */
export const MACHINE_GRID = '@xl:grid-cols-2 @4xl:grid-cols-3 @min-[88rem]:grid-cols-4 @min-[120rem]:grid-cols-5'
const BOARD_SPAN = '@min-[72rem]:col-span-2'
// "Healthy" sat under two "keeps failing" cards (2026-11-17): this box is about the live queue only,
// so it says that; the week's failures are the alert strip's.
const TONE_WORD: Record<'ok' | 'warn' | 'bad', string> = { ok: 'Nothing stuck right now', warn: 'Needs a look', bad: 'Something is down' }

function Meter({ label, pct }: { label: string; pct: number | null }) {
  if (pct == null) return null
  const tone = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warn' : 'bg-ok'
  return (
    <div className="flex items-center gap-2 text-2xs text-fg-muted" title={`${label}: ${pct}%`}>
      <span className="w-14 shrink-0">{label}</span>
      <span className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-overlay" role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className={`block h-full ${tone}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
      <span className="w-9 shrink-0 text-right tabular-nums">{pct}%</span>
    </div>
  )
}

/** One real machine: its name, what it runs now, how busy it is. */
export function MachineCard({ m, testId }: { m: MachineNow; testId?: string }) {
  return (
    <li className="min-w-0" data-testid={testId ?? `ci-machine-${m.id}`}>
      <Card className="h-full p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-fg">{m.name}</span>
        {m.detail && <span className="text-2xs text-fg-muted">{m.detail}</span>}
        {m.stale ? <Badge tone="danger">stopped reporting</Badge> : m.running > 0 ? <Badge tone="ok">running {m.running}</Badge> : <Badge tone="neutral">idle</Badge>}
      </div>
      <p className="mt-1 text-xs text-fg-secondary">
        {m.running === 0
          ? m.kind === 'github' ? 'Nothing running on GitHub’s machines.' : 'Nothing running right now.'
          : `Running ${m.apps.map((a) => `${a.app} ${a.count === 1 ? '' : `×${a.count}`}`.trim()).join(', ')}.`}
        {m.kind === 'github' && ' GitHub bills these minutes.'}
      </p>
      <div className="mt-2 space-y-1">
        <Meter label="CPU busy" pct={m.busyPct} />
        <Meter label="Memory" pct={m.memPct} />
      </div>
      </Card>
    </li>
  )
}

/** One running job; pointing at it lights its app, job and runner across the page. */
function RunningRow({ r }: { r: RunningNow }) {
  const link = useCiLink(ciJobKeys(r.job), ciJobKey(r.job.repo, r.job.jobName))
  const pct = r.usualS && r.elapsedS != null ? Math.min(100, Math.round((r.elapsedS / r.usualS) * 100)) : null
  return (
    <li {...link} className={`${link.className} flex flex-col gap-1 px-3 py-2 @xl:flex-row @xl:items-center @xl:gap-3`} data-testid={`ci-running-${r.job.id}`}>
      <div className="min-w-0 @xl:flex-1">
        <p className="text-xs">
          {r.job.htmlUrl ? (
            <a href={r.job.htmlUrl} target="_blank" rel="noopener noreferrer" className={`font-medium ${LINK_ACCENT}`}>
              {r.job.jobName} <IconExternalLink size={10} className="inline" />
            </a>
          ) : (
            <span className="font-medium text-fg">{r.job.jobName}</span>
          )}
          <span className="text-fg-muted"> · {r.app}{r.job.prNumber ? ` · PR #${r.job.prNumber}` : ''}</span>
        </p>
        <p className="text-2xs text-fg-muted">on {r.machine?.name ?? 'a machine'}</p>
      </div>
      <div className="min-w-0 @xl:w-56 @xl:shrink-0">
        <p className={`text-2xs ${r.slow ? 'font-medium text-warn-foreground' : 'text-fg-secondary'}`}>
          {r.elapsedS != null ? `${durationWords(r.elapsedS)} so far · ` : ''}
          {estimateLine(r)}
        </p>
        {pct != null && (
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-overlay" aria-hidden="true">
            {/* Running = the timeline's running colour; the brand red read as a failure in light mode. */}
            <span className={`ci-grow-x block h-full ${r.slow ? 'bg-warn' : `${CI_OUTCOME_STYLE.running.fill} ci-stripes`}`} style={{ width: `${Math.max(3, pct)}%` }} />
          </span>
        )}
      </div>
    </li>
  )
}

/** One pull request's failures; pointing at it lights that job and app across the page. */
function BrokeItem({ g }: { g: FailureGroup }) {
  const first = g.broke[0]?.failure.job
  const keys = [ciRepoKey(g.repo), ...g.broke.flatMap(({ failure }) => ciJobKeys(failure.job))]
  const link = useCiLink(keys, first ? ciJobKey(first.repo, first.jobName) : ciRepoKey(g.repo))
  return (
    <li {...link} className={`${link.className} rounded-md border border-edge-subtle px-3 py-2`} data-testid={`ci-broke-${g.key}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-semibold text-fg">{g.app}</span>
        <span className="text-fg-muted">{g.prNumber ? `PR #${g.prNumber}` : g.branch ?? ''}</span>
        <span className="text-2xs text-fg-faint">
          <RelativeTime value={new Date(g.at).toISOString()} />
        </span>
      </p>
      <ul className="mt-1 space-y-0.5">
          {g.broke.map(({ failure: f, step }) => (
            <li key={f.job.id} className="text-2xs text-fg-secondary">
              <span className="font-medium text-fg">{f.job.jobName}</span>
              {f.kind === 'code' ? (step ? <> failed at <span className="font-medium text-fg">“{step}”</span></> : ' failed') : <> did not finish: {f.kind === 'machine' ? 'the test machine stopped (re-run it)' : 'cancelled before a machine took it'}</>}
              {f.job.htmlUrl && (
                <a href={f.job.htmlUrl} target="_blank" rel="noopener noreferrer" className={`ml-1.5 ${LINK_ACCENT}`}>
                  read the log
                </a>
              )}
            </li>
          ))}
          {g.summaries.length > 0 && (
            <li className="text-2xs text-fg-muted">
              Also red: {[...new Set(g.summaries.map((f) => f.job.jobName))].join(', ')}, {g.summaries.length === 1 ? 'a summary check that fails' : 'summary checks that fail'} whenever the job above fails.
            </li>
          )}
      </ul>
    </li>
  )
}

/** One app's week; its pass rate is graded against the 80% target (red below, blue above). */
function AppTimeRow({ a }: { a: CiStatus['apps'][number] }) {
  const link = useCiLink([ciRepoKey(a.repo)], ciRepoKey(a.repo))
  return (
    <tr {...link} className={link.className}>
      <DataTableCell>{a.app}</DataTableCell>
      <DataTableCell>{a.waitP95S != null ? `up to ${durationWords(a.waitP95S)}` : '—'}</DataTableCell>
      <DataTableCell>{a.runP50S != null ? durationWords(a.runP50S) : '—'}</DataTableCell>
      <DataTableCell>
        <span className={`inline-block min-w-12 rounded-xs px-1.5 py-0.5 text-right font-mono font-bold tabular-nums ${a.passRate == null ? '' : divergeClass(a.passRate)}`}>{formatPercent(a.passRate)}</span>
      </DataTableCell>
      <DataTableCell>
        {a.delay === 'waiting' ? <Badge tone="warn">waiting for a machine</Badge> : a.delay === 'failing' ? <Badge tone="danger">failing checks</Badge> : a.delay === 'slow' ? <Badge tone="warn">long runs</Badge> : <span className="text-fg-muted">none</span>}
      </DataTableCell>
    </tr>
  )
}

export function CiStatusBoard({ overview }: { overview: CiOverview }) {
  const now = useNow(30_000)
  const status = useMemo(() => buildCiStatus(overview, now), [overview, now])
  const grouped = useMemo(() => groupFailures(overview, now), [overview, now])
  // Draft PRs skip CI on purpose: one line under the list, never a failure card each
  // (5 of 8 "failures" were drafts, 2026-11-16).
  const failures = grouped.filter((g) => !g.draftOnly)
  const drafts = grouped.filter((g) => g.draftOnly)

  return (
    // A wide board (≥ 72rem: "Right now" beside the week on a big screen) puts "Running now" and
    // "What broke" side by side; the headline, the machines and the weekly table span both.
    // The wrapper is the container: a container query never matches the container element itself.
    <div className="@container">
    <div className="grid grid-cols-1 items-start gap-4 @min-[72rem]:grid-cols-2" data-testid="ci-status-board">
      {/* 1. Is CI OK right now? */}
      <div className={`rounded-md border px-4 py-3 ${BOARD_SPAN} ${TONE_BOX[status.tone]}`} data-testid="ci-status-headline" role="status">
        <p className="text-2xs font-semibold text-fg-secondary">{TONE_WORD[status.tone]}</p>
        <p className="mt-0.5 text-sm font-medium text-fg">{status.headline}</p>
      </div>

      {/* 2. Which machine is running what? */}
      <section aria-labelledby="ci-machines-now" className={BOARD_SPAN}>
        <h3 id="ci-machines-now" className="mb-1.5 text-xs font-semibold text-fg">Machines right now</h3>
        {status.machines.length > 0 ? (
          <ul className={`grid gap-2 ${MACHINE_GRID}`} data-testid="ci-machines-now">
            {status.machines.map((m) => (
              <MachineCard key={m.id} m={m} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-muted">No machine is running a job right now.</p>
        )}
        {status.idle.length > 0 && (
          <p className="mt-1.5 text-2xs text-fg-muted" data-testid="ci-machines-idle">
            Idle: {status.idle.join(', ')}.
          </p>
        )}
      </section>

      {/* 3. When will each job finish? */}
      <section aria-labelledby="ci-running-now" className="min-w-0">
        <h3 id="ci-running-now" className="mb-1.5 text-xs font-semibold text-fg">
          Running now {status.running.length > 0 && <span className="font-normal text-fg-muted">({status.running.length})</span>}
          {status.waiting > 0 && status.oldestWaitS != null && (
            <span className="ml-2 font-normal text-fg-muted">
              · {status.waiting} waiting for a machine, oldest {durationWords(status.oldestWaitS)}
            </span>
          )}
        </h3>
        {/* Why they wait, at any wait: "2 waiting" beside "Idle: alienware-ci" asks it
            before the headline does (it speaks only past 5 min). */}
        {status.waitWhy && !status.headline.includes(status.waitWhy) && (
          <p className="-mt-1 mb-1.5 text-2xs text-fg-secondary" data-testid="ci-wait-why">{status.waitWhy}</p>
        )}
        {status.running.length === 0 ? (
          <p className="text-xs text-fg-muted">Nothing is running.</p>
        ) : (
          <ul className="divide-y divide-edge-subtle rounded-md border border-edge-subtle" data-testid="ci-running-now">
            {status.running.map((r) => (
              <RunningRow key={r.job.id} r={r} />
            ))}
          </ul>
        )}
      </section>

      {/* 4. What broke, and where? */}
      <section aria-labelledby="ci-broke" className="min-w-0">
        <h3 id="ci-broke" className="mb-1.5 text-xs font-semibold text-fg">
          What broke in the last 2 hours {failures.length > 0 && <span className="font-normal text-fg-muted">({failures.length} {failures.length === 1 ? 'pull request' : 'pull requests'})</span>}
        </h3>
        {failures.length === 0 ? (
          <p className="text-xs text-fg-muted">Nothing failed in the last 2 hours.</p>
        ) : null}
        {failures.length > 0 && (
          <ul className="space-y-2" data-testid="ci-broke">
            {failures.slice(0, 8).map((g) => (
              <BrokeItem key={g.key} g={g} />
            ))}
            {failures.length > 8 && <li className="text-2xs text-fg-muted">and {failures.length - 8} more in the queue below.</li>}
          </ul>
        )}
        {drafts.length > 0 && (
          <p className="mt-1.5 text-2xs text-fg-muted" data-testid="ci-broke-drafts">
            Not failures: {drafts.length} draft {drafts.length === 1 ? 'pull request' : 'pull requests'} skipped CI on purpose (
            {drafts.map((g) => `${g.app} ${g.prNumber ? `#${g.prNumber}` : 'branch'}`).join(', ')}). Mark one ready for review and its CI runs.
          </p>
        )}
      </section>

      {/* 5. What slows each app down this week? */}
      <section aria-labelledby="ci-time" className={BOARD_SPAN}>
        <h3 id="ci-time" className="mb-1 text-xs font-semibold text-fg">Where the time goes this week</h3>
        <p className="mb-1.5 text-2xs text-fg-muted" data-testid="ci-bottleneck">
          {status.bottleneck ?? 'No app is held up: waits are short and most checks pass.'}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-120 text-left text-xs" data-testid="ci-time-by-app">
            <thead>
              <tr>
                <DataTableHead>App</DataTableHead>
                <DataTableHead><span title="1 job in 20 waits this long or longer for a free machine">Waits for a machine</span></DataTableHead>
                <DataTableHead><span title="Half the jobs finish within this">Usual run</span></DataTableHead>
                <DataTableHead>Checks pass</DataTableHead>
                <DataTableHead>Main delay</DataTableHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-subtle">
              {status.apps.map((a) => (
                <AppTimeRow key={a.repo} a={a} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    </div>
  )
}
