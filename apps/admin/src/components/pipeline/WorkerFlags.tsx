/**
 * FILE: apps/admin/src/components/pipeline/WorkerFlags.tsx
 * PURPOSE: Worker flags (ADR 0048 amendment 2026-10-28): every way a local
 *          worker stopped doing useful work, loud and never collapsed. Each
 *          flag says what is wrong, why in plain words, how long, and for a
 *          run that holds an agent space its stage and last log lines, with
 *          the actions that fix it: stop the run, pause the lane, open the
 *          report or PR, re-check the Cursor account, or copy the exact
 *          command to run on the machine.
 *
 *          `strip` is the short form above the Pipeline tabs: how many, the
 *          worst few titles, and a link to the Workers tab.
 *
 * Data: the `flags` of GET /v1/admin/work/lanes (the server's work-flags.ts).
 */

import { useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { Badge, Btn, Callout, CodeValue } from '../ui'
import { IconExternalLink } from '../icons'
import { SwitchCursorAccountDialog } from './SwitchCursorAccount'
import { StatusGlyph } from '../signal/StatusGlyph'
import { useToast } from '../../lib/toast'
import { durationLabel, patchLane, recheckAccount, STAGE_LABEL, stopRun, type WorkerFlag, type WorkerFlagAction, type WriteResult } from '../../lib/workers'

const KIND_LABEL: Record<string, string> = {
  host_offline: 'Machine offline',
  machine_not_ready: 'Lane cannot start',
  run_stuck: 'Stuck run',
  lanes_waiting: 'Waiting for an agent space',
  account_check: 'Cursor account',
  gh_signed_out: 'GitHub sign-in',
  machine_waiting: 'Machine waiting',
  machine_busy: 'Machine overloaded',
  hook_failures: 'Git hooks failing',
  unmanaged_run: 'Run outside the worker',
  credits_idle: 'Credits idle',
}

/**
 * The tone a flag is drawn in. Idle credits are money left unspent, a warning, never a failure:
 * the server sends them as `danger` and the card was red (round-2 review, 2026-11-18).
 */
export function flagTone(flag: Pick<WorkerFlag, 'kind' | 'severity'>): 'danger' | 'warn' {
  if (flag.kind === 'credits_idle') return 'warn'
  return flag.severity === 'danger' ? 'danger' : 'warn'
}

/**
 * A flag's small label and duration, only where they add to its title: "Credits idle" over
 * "Cursor credits idle for 33 h", then "for 33 h" again, said one thing three times
 * (2026-11-18).
 */
function flagHeading(flag: Pick<WorkerFlag, 'id' | 'kind' | 'title' | 'sinceSec'>): { label: string | null; since: string | null } {
  const label = flag.id === 'credits_out' ? 'Out of credits' : (KIND_LABEL[flag.kind] ?? 'Worker problem')
  const title = flag.title.toLowerCase()
  const since = flag.sinceSec != null ? durationLabel(flag.sinceSec) : null
  return { label: title.includes(label.toLowerCase()) ? null : label, since: since && !title.includes(since.toLowerCase()) ? since : null }
}

/** An agent space, explained once wherever flags show. */
const AGENT_SPACE = 'An agent space is one coding agent running at a time; each machine allows a set number at once (its limits below).'

function FlagAction({ flag, action, onChanged }: { flag: WorkerFlag; action: WorkerFlagAction; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [switching, setSwitching] = useState(false)
  const testId = `worker-flag-${flag.kind}-${action.kind}`
  const run = async (write: () => Promise<WriteResult>) => {
    setBusy(true)
    const res = await write()
    setBusy(false)
    setAsking(false)
    ;(res.ok ? toast.success : toast.error)(res.message)
    if (res.ok) onChanged()
  }
  switch (action.kind) {
    case 'stop_run':
      return (
        <>
          <Btn size="sm" variant="danger" loading={busy} onClick={() => setAsking(true)} data-testid={testId}>
            {action.label}
          </Btn>
          {asking && (
            <ConfirmDialog
              title="Stop this run"
              body={`The report is free again: the next lane or a cloud agent can take it. ${flag.hostname ?? 'The machine'} stops the agent at its next heartbeat, within a minute, and commits and pushes nothing more; a git hook already running ends at git's own time limit. The change so far stays in the worktree on the machine.`}
              confirmLabel="Stop the run"
              tone="danger"
              loading={busy}
              onConfirm={() => void run(() => stopRun(action.claimId))}
              onCancel={() => setAsking(false)}
            />
          )}
        </>
      )
    case 'pause_lane':
      return (
        <Btn size="sm" variant="ghost" loading={busy} onClick={() => void run(() => patchLane(action.laneId, { paused: true }))} data-testid={testId}>
          {action.label}
        </Btn>
      )
    case 'recheck_account':
      return (
        <Btn size="sm" variant="ghost" loading={busy} onClick={() => void run(() => recheckAccount(action.hostId))} data-testid={testId}>
          {action.label}
        </Btn>
      )
    case 'switch_account':
      return (
        <>
          <Btn size="sm" variant="primary" onClick={() => setSwitching(true)} data-testid={testId}>
            {action.label}
          </Btn>
          {switching && <SwitchCursorAccountDialog hostId={action.hostId} hostname={flag.hostname ?? 'this machine'} onClose={() => setSwitching(false)} onChanged={onChanged} />}
        </>
      )
    case 'open_report':
      return (
        <Btn size="sm" variant="ghost" to={`/reports/${action.reportId}`} data-testid={testId}>
          {action.label}
        </Btn>
      )
    case 'open_page':
      return (
        <Btn size="sm" variant="ghost" to={action.to} data-testid={testId}>
          {action.label}
        </Btn>
      )
    case 'open_pr':
      return (
        <a href={action.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-brand hover:underline" data-testid={testId}>
          {action.label} <IconExternalLink size={10} />
        </a>
      )
    case 'copy_command':
      return null
  }
}

/**
 * A link to the Workers tab, drawn on the Workers tab, goes nowhere: "Open Workers" on the idle
 * credits card linked to the page it sat on (round-3 review, 2026-11-19). @internal Exported for tests.
 */
export function isWorkersTabLink(action: WorkerFlagAction): boolean {
  return action.kind === 'open_page' && /^\/pipeline(\?|#|$)/.test(action.to) && /[?&]tab=workers(&|#|$)/.test(action.to)
}

function FlagItem({ flag, onChanged }: { flag: WorkerFlag; onChanged: () => void }) {
  const commands = flag.actions.filter((a): a is Extract<WorkerFlagAction, { kind: 'copy_command' }> => a.kind === 'copy_command')
  // These cards show on the Workers tab: a button back to it is dropped.
  const buttons = flag.actions.filter((a) => a.kind !== 'copy_command' && !isWorkersTabLink(a))
  const head = flagHeading(flag)
  return (
    <li data-testid={`worker-flag-${flag.kind}`} data-flag-id={flag.id} data-tone={flagTone(flag)}>
      <Callout
        tone={flagTone(flag)}
        label={head.label ?? undefined}
        action={head.since ? <span className="text-2xs tabular-nums text-fg-muted">for {head.since}</span> : undefined}
      >
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-fg">{flag.title}</p>
          <p className="text-xs text-fg-secondary">{flag.cause}</p>
          {flag.stage && (
            <p className="text-2xs text-fg-muted" data-testid={`worker-flag-${flag.kind}-stage`}>
              Stage: <Badge tone={flag.stage === 'commit' || flag.stage === 'push' ? 'danger' : 'neutral'}>{STAGE_LABEL[flag.stage]}</Badge>
            </p>
          )}
          {flag.log && flag.log.length > 0 && (
            <ol className="rounded-sm border border-edge-subtle bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg-secondary" aria-label="Last log lines" data-testid={`worker-flag-${flag.kind}-log`}>
              {flag.log.map((line, i) => (
                <li key={i} className="wrap-anywhere">
                  {line}
                </li>
              ))}
            </ol>
          )}
          {buttons.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {buttons.map((a) => (
                <FlagAction key={`${a.kind}:${a.label}`} flag={flag} action={a} onChanged={onChanged} />
              ))}
            </div>
          )}
          {commands.map((a) => (
            <div key={a.command} className="space-y-0.5">
              <p className="text-2xs text-fg-muted">{flag.id === 'credits_out' ? `${a.label}:` : `${a.label}, on ${flag.hostname ?? 'the machine'}:`}</p>
              {/* Not `multiline`: its copy button is absolute inside the Tooltip anchor and landed outside the card (2026-11-18). */}
              <CodeValue value={a.command} className="w-full" />
            </div>
          ))}
        </div>
      </Callout>
    </li>
  )
}

interface Props {
  flags: WorkerFlag[]
  onChanged: () => void
}

/** "2 things stop your local workers from fixing bugs (1 needs you now)." The Workers status says it once, above the cards. */
export function flagsSentence(flags: ReadonlyArray<Pick<WorkerFlag, 'kind' | 'severity'>>): string {
  const danger = flags.filter((f) => flagTone(f) === 'danger').length
  return `${flags.length === 1 ? '1 thing stops' : `${flags.length} things stop`} your local workers from fixing bugs${danger ? ` (${danger} ${danger === 1 ? 'needs' : 'need'} you now)` : ''}.`
}

/** Every flag, worst first, each with its actions. Empty → nothing. */
export function WorkerFlags({ flags, onChanged }: Props) {
  if (flags.length === 0) return null
  return (
    <section aria-label="Local worker problems" className="space-y-2" data-testid="worker-flags">
      {flags.some((f) => f.kind === 'lanes_waiting' || f.kind === 'run_stuck') && <p className="text-2xs text-fg-muted">{AGENT_SPACE}</p>}
      <ul className="space-y-2">
        {flags.map((f) => (
          <FlagItem key={f.id} flag={f} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  )
}

/**
 * Above the Pipeline tabs: how many, the worst titles, and the way to the Workers tab. Failures sit
 * in a red banner; warnings (idle credits) are amber lines under it, never inside it: the red
 * banner listed "Cursor credits idle for 34 h" beside the offline machine while the Workers tab
 * drew it amber (round-3 review, 2026-11-19).
 */
export function WorkerFlagsStrip({ flags, workersHref }: { flags: WorkerFlag[]; workersHref: string }) {
  if (flags.length === 0) return null
  const failing = flags.filter((f) => flagTone(f) === 'danger')
  const warnings = flags.filter((f) => flagTone(f) !== 'danger')
  const open = (danger: boolean) => (
    <Btn size="sm" variant={danger ? 'danger' : 'ghost'} to={workersHref} data-testid="worker-flags-strip-open">
      Open Workers
    </Btn>
  )
  // One count with the tab ("Workers (2 problems)") and the Workers status: every problem, whatever its colour.
  const label = `Local workers: ${flags.length} problem${flags.length === 1 ? '' : 's'}`
  const list = (items: WorkerFlag[], testId: string, more: number) => (
    <ul className="space-y-0.5 text-xs text-fg" data-testid={testId}>
      {items.map((f) => (
        <li key={f.id}>{f.title}.</li>
      ))}
      {more > 0 && <li className="text-fg-muted">and {more} more on the Workers tab.</li>}
    </ul>
  )
  if (failing.length === 0) {
    return (
      <Callout tone="warn" label={label} action={open(false)}>
        {list(warnings.slice(0, 3), 'worker-flags-strip', warnings.length - 3)}
      </Callout>
    )
  }
  return (
    <div className="space-y-1" data-testid="worker-flags-strip-wrap">
      <Callout tone="danger" label={label} action={open(true)}>
        {list(failing.slice(0, 3), 'worker-flags-strip', failing.length - 3)}
      </Callout>
      {warnings.length > 0 && (
        <ul className="space-y-0.5 px-1 text-xs text-fg" data-testid="worker-flags-strip-warn">
          {warnings.slice(0, 3).map((f) => (
            <li key={f.id} className="flex items-baseline gap-1.5">
              <StatusGlyph tone="warn" label="Warning" />
              <span>{f.title}.</span>
            </li>
          ))}
          {warnings.length > 3 && <li className="pl-4 text-fg-muted">and {warnings.length - 3} more on the Workers tab.</li>}
        </ul>
      )}
    </div>
  )
}
