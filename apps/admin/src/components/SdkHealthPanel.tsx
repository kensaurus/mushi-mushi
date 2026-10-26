/**
 * FILE: apps/admin/src/components/SdkHealthPanel.tsx
 * PURPOSE: What is wrong with this app's Mushi SDK, each problem with its own
 *          Fix button, and Fix all. Problems and checks that could not run
 *          come from GET /sdk-health; the fixes are in lib/sdkHealth.ts.
 *
 * Writing CI secrets revokes the older CI key once GitHub accepts the new
 * one, so it is confirmed first (QA bug 30), alone or as part of Fix all.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Callout, Card, CopyButton } from './ui'
import { ConfirmDialog } from './ConfirmDialog'
import { IconCheck, IconExternalLink, IconRefresh } from './icons'
import { usePageData } from '../lib/usePageData'
import { LINK_ACCENT } from '../lib/chipTone'
import {
  FIX_ACTION_TEXT,
  fixAllPlan,
  fixBusy,
  fixStarted,
  taskStateFor,
  useSdkHealthFixes,
  type SdkHealthFixKind,
  type SdkHealthFixes,
  type SdkHealthPayload,
  type SdkHealthProblem,
} from '../lib/sdkHealth'

const SEVERITY_DOT: Record<SdkHealthProblem['severity'], string> = {
  error: 'bg-danger',
  warn: 'bg-warn',
  info: 'bg-fg-faint/60',
}

/** What each fix made, for results that stay once its problem is gone. */
const DONE_LABEL: Record<SdkHealthFixKind, string> = {
  sync_ci_secrets: 'CI secrets',
  install_task: 'Install task',
  upgrade_pr: 'Upgrade PR',
  csp_task: 'CSP task',
}

const FIX_KINDS = Object.keys(DONE_LABEL) as SdkHealthFixKind[]

const NOTE_LABEL: Record<SdkHealthPayload['notes'][number]['check'], string> = {
  repo: 'Repo',
  ci_secrets: 'CI secrets',
  site_csp: 'Site security policy',
  versions: 'SDK versions',
}

function repoLabel(repoUrl: string | null): string {
  if (!repoUrl) return 'no repo linked'
  const match = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(repoUrl)
  return match ? match[1]! : repoUrl
}

interface SdkHealthPanelProps {
  projectId: string
  /** Inline use (setup checklist): no outer card. */
  bare?: boolean
}

export function SdkHealthPanel({ projectId, bare }: SdkHealthPanelProps) {
  const health = usePageData<SdkHealthPayload>(`/v1/admin/projects/${projectId}/sdk-health`)
  const { reload } = health
  // After every fix SDK health is read again, so a fixed problem leaves the list.
  const fixes = useSdkHealthFixes(projectId, reload)
  const [confirm, setConfirm] = useState<SdkHealthFixKind[] | null>(null)

  // The upgrade PR opens a little after the click: read again once it is open.
  const upgradeOpened = fixes.ran.includes('upgrade_pr') && fixes.upgrade.status === 'completed'
  useEffect(() => {
    if (upgradeOpened) reload()
  }, [upgradeOpened, reload])

  const problems = health.data?.problems ?? []
  const notes = health.data?.notes ?? []
  const plan = fixAllPlan(problems)
  const pending = plan.filter((k) => !fixStarted(fixes, k))
  const busy = fixes.runningAll || fixes.running !== null
  // Results of fixes whose problem is gone after the re-read.
  const done = FIX_KINDS.filter((k) => fixStarted(fixes, k) && !problems.some((p) => p.fix?.kind === k))

  const start = (kinds: SdkHealthFixKind[]) => {
    // A single task or upgrade PR touches nothing live; writing secrets and Fix all are confirmed.
    if (kinds.length === 1 && kinds[0] !== 'sync_ci_secrets') void fixes.runFix(kinds[0])
    else setConfirm(kinds)
  }

  const body = (
    <div className="space-y-3" data-testid="sdk-health-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          {health.loading
            ? 'Checking your SDK…'
            : problems.length === 0
              ? health.data
                ? 'No SDK problems found.'
                : ''
              : `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} found.`}
        </p>
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="ghost" className="gap-1.5" onClick={() => health.reload()} loading={health.isValidating && !health.loading}>
            <IconRefresh className="h-3.5 w-3.5" aria-hidden />
            Check again
          </Btn>
          {pending.length > 1 && (
            <Btn size="sm" onClick={() => start(pending)} loading={fixes.runningAll} disabled={busy} data-testid="sdk-health-fix-all">
              Fix all ({pending.length})
            </Btn>
          )}
        </div>
      </div>

      {health.error && (
        <Callout tone="danger" label="Could not check the SDK" action={<Btn size="sm" variant="ghost" onClick={() => health.reload()}>Retry</Btn>}>
          <p className="text-xs">{health.errorMessage ?? health.error}</p>
        </Callout>
      )}

      {problems.length > 0 && (
        <ul className="divide-y divide-edge-subtle/60 rounded-md border border-edge-subtle">
          {problems.map((p) => (
            <ProblemRow key={p.id} problem={p} fixes={fixes} busy={busy} onFix={(k) => start([k])} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="space-y-1 rounded-md border border-ok/25 px-3 py-2" data-testid="sdk-health-done">
          <p className="text-3xs font-semibold uppercase tracking-wider text-fg-faint">Done</p>
          {done.map((k) => (
            <div key={k}>
              <p className="text-xs font-medium text-fg-secondary">{DONE_LABEL[k]}</p>
              <FixResult kind={k} fixes={fixes} />
            </div>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <div className="space-y-1">
          <p className="text-3xs font-semibold uppercase tracking-wider text-fg-faint">Not checked</p>
          <ul className="space-y-0.5 text-2xs text-fg-muted">
            {notes.map((n) => (
              <li key={n.check}>
                <span className="font-medium text-fg-secondary">{NOTE_LABEL[n.check]}:</span> {n.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.length === 1 ? 'Write new CI secrets to GitHub?' : `Run ${confirm.length} fixes?`}
          body="Each step runs in order and shows its result here."
          details={
            <ul className="list-disc space-y-0.5 pl-4">
              {confirm.includes('sync_ci_secrets') && (
                <li>
                  Repo: <span className="font-mono">{repoLabel(health.data?.repoUrl ?? null)}</span>
                </li>
              )}
              {confirm.map((k) => (
                <li key={k}>{FIX_ACTION_TEXT[k]}</li>
              ))}
            </ul>
          }
          confirmLabel={confirm.length === 1 ? 'Write secrets' : 'Fix all'}
          tone={confirm.includes('sync_ci_secrets') ? 'danger' : undefined}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const kinds = confirm
            setConfirm(null)
            if (kinds.length === 1) void fixes.runFix(kinds[0])
            else void fixes.runAll(problems.filter((p) => p.fix && kinds.includes(p.fix.kind)))
          }}
        />
      )}
    </div>
  )

  return bare ? body : <Card className="p-3">{body}</Card>
}

function ProblemRow({
  problem,
  fixes,
  busy,
  onFix,
}: {
  problem: SdkHealthProblem
  fixes: SdkHealthFixes
  busy: boolean
  onFix: (k: SdkHealthFixKind) => void
}) {
  const kind = problem.fix?.kind ?? null
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start" data-testid={`sdk-health-problem-${problem.id}`}>
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[problem.severity]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{problem.title}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{problem.detail}</p>
        {kind && fixStarted(fixes, kind) && <FixResult kind={kind} fixes={fixes} />}
      </div>
      {kind && problem.fix && !fixStarted(fixes, kind) && (
        <Btn
          size="sm"
          variant="ghost"
          className="shrink-0 self-start"
          onClick={() => onFix(kind)}
          loading={fixes.running === kind || fixBusy(fixes, kind)}
          disabled={busy}
          data-testid={`sdk-health-fix-${problem.id}`}
        >
          {problem.fix.label}
        </Btn>
      )}
      {problem.link && (
        <Btn size="sm" variant="ghost" href={problem.link.href} className="shrink-0 gap-1 self-start" data-testid={`sdk-health-link-${problem.id}`}>
          {problem.link.label}
          <IconExternalLink className="h-3 w-3" aria-hidden />
        </Btn>
      )}
    </li>
  )
}

function Line({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }) {
  const cls = tone === 'ok' ? 'text-ok-foreground' : tone === 'warn' ? 'text-warn-foreground' : 'text-fg-muted'
  return <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${cls}`}>{children}</p>
}

function FixResult({ kind, fixes }: { kind: SdkHealthFixKind; fixes: SdkHealthFixes }) {
  const task = taskStateFor(fixes, kind)
  if (task) {
    if (task.status === 'running') return <Line tone="muted">Filing the task…</Line>
    if (task.status === 'failed') return <Line tone="warn">{task.error}</Line>
    return (
      <Line tone="ok">
        <IconCheck className="h-3.5 w-3.5" aria-hidden />
        <span>
          {task.existing ? 'Already filed' : 'Task filed'}: your fix agent picks it up and opens the PR.{' '}
          <Link to={`/reports/${task.reportId}`} className={LINK_ACCENT}>
            Open the task
          </Link>
        </span>
      </Line>
    )
  }

  if (kind === 'upgrade_pr') {
    const u = fixes.upgrade
    if (u.status === 'completed' && u.prUrl) {
      return (
        <Line tone="ok">
          <IconCheck className="h-3.5 w-3.5" aria-hidden />
          <span>
            Upgrade PR is open.{' '}
            <a href={u.prUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 ${LINK_ACCENT}`}>
              View PR <IconExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </span>
        </Line>
      )
    }
    if (u.status === 'completed_no_pr' || u.status === 'failed' || u.status === 'cancelled') {
      return <Line tone="warn">{u.error ?? 'The upgrade PR was not opened.'}</Line>
    }
    if (u.status === 'awaiting_lockfile') return <Line tone="muted">Bump pushed. The PR opens once your lockfile workflow runs.</Line>
    return <Line tone="muted">Opening the upgrade PR…</Line>
  }

  const s = fixes.ci
  if (s.status === 'syncing') return <Line tone="muted">Writing the secrets…</Line>
  if (s.status === 'ok') {
    return (
      <Line tone="ok">
        <IconCheck className="h-3.5 w-3.5" aria-hidden />
        <span>Wrote {s.written?.join(', ')}. Ship a new build so the app picks them up.</span>
      </Line>
    )
  }
  const manual = s.status === 'forbidden' || s.status === 'no-repo' || s.status === 'partial' || s.status === 'failed'
  return (
    <div className="mt-1.5 space-y-1.5">
      <Line tone="warn">
        {s.status === 'forbidden'
          ? "GitHub didn't let Mushi write secrets (the token lacks Secrets: write). Run these commands instead."
          : s.status === 'no-repo'
            ? 'No GitHub repo or token is connected. Run these commands instead.'
            : s.status === 'partial'
              ? `Some names were not written: ${s.failed?.map((f) => f.name).join(', ')}.`
              : (s.errorMessage ?? 'The secrets were not written.')}
      </Line>
      {manual && s.rawKey && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">{s.rawKey}</code>
          <CopyButton value={s.rawKey} label="Copy API key" copiedLabel="Copied" size="sm" />
        </div>
      )}
      {manual && s.rawKey && <p className="text-2xs text-fg-faint">This is the only time the full key is shown.</p>}
      {manual &&
        s.fallback?.commands.map((cmd) => (
          <div key={cmd} className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">{cmd}</code>
            <CopyButton value={cmd} label="Copy command" copiedLabel="Copied" size="sm" />
          </div>
        ))}
    </div>
  )
}
