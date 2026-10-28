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

/** An agent space, explained once wherever flags show. */
const AGENT_SPACE = 'An agent space is one coding agent running at a time; each machine allows a set number at once (its limits below).'

function FlagAction({ flag, action, onChanged }: { flag: WorkerFlag; action: WorkerFlagAction; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
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
              body={`The report goes back to the queue. ${flag.hostname ?? 'The machine'} stops the agent at its next heartbeat, within a minute, and commits and pushes nothing more; a git hook already running ends at git's own time limit. The change so far stays in the worktree on the machine.`}
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

function FlagItem({ flag, onChanged }: { flag: WorkerFlag; onChanged: () => void }) {
  const commands = flag.actions.filter((a): a is Extract<WorkerFlagAction, { kind: 'copy_command' }> => a.kind === 'copy_command')
  const buttons = flag.actions.filter((a) => a.kind !== 'copy_command')
  return (
    <li data-testid={`worker-flag-${flag.kind}`} data-flag-id={flag.id}>
      <Callout
        tone={flag.severity === 'danger' ? 'danger' : 'warn'}
        label={KIND_LABEL[flag.kind] ?? 'Worker problem'}
        action={flag.sinceSec != null ? <span className="text-2xs tabular-nums text-fg-muted">for {durationLabel(flag.sinceSec)}</span> : undefined}
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
              <p className="text-2xs text-fg-muted">{a.label}, on {flag.hostname ?? 'the machine'}:</p>
              <CodeValue value={a.command} multiline />
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

/** Every flag, worst first, each with its actions. Empty → nothing. */
export function WorkerFlags({ flags, onChanged }: Props) {
  if (flags.length === 0) return null
  const danger = flags.filter((f) => f.severity === 'danger').length
  return (
    <section aria-label="Local worker problems" className="space-y-2" data-testid="worker-flags">
      <p className="text-sm font-semibold text-fg">
        {flags.length === 1 ? '1 thing stops' : `${flags.length} things stop`} your local workers from fixing bugs{danger ? ` (${danger} need you now)` : ''}.
      </p>
      {flags.some((f) => f.kind === 'lanes_waiting' || f.kind === 'run_stuck') && <p className="text-2xs text-fg-muted">{AGENT_SPACE}</p>}
      <ul className="space-y-2">
        {flags.map((f) => (
          <FlagItem key={f.id} flag={f} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  )
}

/** Above the Pipeline tabs: how many, the worst titles, and the way to the Workers tab. */
export function WorkerFlagsStrip({ flags, workersHref }: { flags: WorkerFlag[]; workersHref: string }) {
  if (flags.length === 0) return null
  const danger = flags.some((f) => f.severity === 'danger')
  return (
    <Callout
      tone={danger ? 'danger' : 'warn'}
      label={`Local workers: ${flags.length} problem${flags.length === 1 ? '' : 's'}`}
      action={
        <Btn size="sm" variant={danger ? 'danger' : 'ghost'} to={workersHref} data-testid="worker-flags-strip-open">
          Open Workers
        </Btn>
      }
    >
      <ul className="space-y-0.5 text-xs text-fg" data-testid="worker-flags-strip">
        {flags.slice(0, 3).map((f) => (
          <li key={f.id}>{f.title}.</li>
        ))}
        {flags.length > 3 && <li className="text-fg-muted">and {flags.length - 3} more on the Workers tab.</li>}
      </ul>
    </Callout>
  )
}
