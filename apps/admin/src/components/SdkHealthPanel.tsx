/**
 * FILE: apps/admin/src/components/SdkHealthPanel.tsx
 * PURPOSE: What is wrong with this app's Mushi SDK, each problem with its own
 *          Fix button, and Fix all. Problems and checks that could not run
 *          come from GET /sdk-health; the fixes are in lib/sdkHealth.ts.
 *
 * Writing CI secrets revokes the older CI key once GitHub accepts the new
 * one, so it is confirmed first (QA bug 30), alone or as part of Fix all.
 *
 * A filed task says what really happens next, from the app's Autofix and
 * GitHub state (lib/fixReadiness.ts). A secrets write that did not fully work
 * says why and gives the `gh` command with the new key in it; once Check
 * again shows every name set, the warning goes (owner, 2026-11-17).
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Callout, Card, CopyButton } from './ui'
import { ConfirmDialog } from './ConfirmDialog'
import { IconCheck, IconExternalLink, IconRefresh } from './icons'
import { usePageData } from '../lib/usePageData'
import { LINK_ACCENT } from '../lib/chipTone'
import { detectWebBundler } from '../lib/sdkInstallDefaults'
import { ciSecretsManualStep } from '../lib/sdkCiSecrets'
import { useFixReadiness, type FixReadiness } from '../lib/fixReadiness'
import { useTurnOnAutofix } from '../lib/useTurnOnAutofix'
import {
  FIX_ACTION_TEXT,
  fixAllPlan,
  fixBusy,
  fixStarted,
  presentSdkHealthProblems,
  taskStateFor,
  useSdkHealthFixes,
  type SdkHealthFixKind,
  type SdkHealthFixes,
  type SdkHealthPayload,
  type SdkHealthProblem,
} from '../lib/sdkHealth'

// JSX text does not decode \u escapes, so the glyph is a constant.
const WARNING_SIGN = '⚠'

/** Problems that only mean setup is not finished yet. */
const SETUP_STEPS = new Set<SdkHealthProblem['id']>(['not_installed', 'no_repo', 'no_sdk_key', 'ci_secrets_missing', 'never_seen'])

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
  /**
   * Known to be an Expo, React Native or Capacitor app: its store builds run
   * in CI, so missing GitHub Actions secrets are a real fault. Unknown or a
   * web app: asked as a question (see presentSdkHealthProblems).
   */
  nativeApp?: boolean
}

export function SdkHealthPanel({ projectId, bare, nativeApp = false }: SdkHealthPanelProps) {
  const health = usePageData<SdkHealthPayload>(`/v1/admin/projects/${projectId}/sdk-health`)
  const { reload } = health
  // After every fix SDK health is read again, so a fixed problem leaves the list.
  const fixes = useSdkHealthFixes(projectId, reload)
  const [confirm, setConfirm] = useState<SdkHealthFixKind[] | null>(null)
  // A filed task reads what happens next from the app's Autofix and GitHub state.
  const taskFiled = Object.values(fixes.tasks).some((t) => t.status === 'filed')
  const fixReadiness = useFixReadiness(projectId, taskFiled)
  const autofix = useTurnOnAutofix(projectId, fixReadiness.reload)
  // Check again pressed after a secrets write: the result then follows the re-read.
  const [recheckedCi, setRecheckedCi] = useState(false)

  // The upgrade PR opens a little after the click: read again once it is open.
  const upgradeOpened = fixes.ran.includes('upgrade_pr') && fixes.upgrade.status === 'completed'
  useEffect(() => {
    if (upgradeOpened) reload()
  }, [upgradeOpened, reload])

  const rawProblems = health.data?.problems ?? []
  const asksAboutCi = !nativeApp && rawProblems.some((p) => p.id === 'ci_secrets_missing')
  // The app's own package.json names its bundler, so the values are named the way its build reads them.
  const stack = usePageData<{ packageJson: string | null }>(asksAboutCi ? `/v1/admin/projects/${projectId}/github/stack` : null)
  const problems = presentSdkHealthProblems(rawProblems, { nativeApp, bundler: detectWebBundler(stack.data?.packageJson) })
  const notes = health.data?.notes ?? []
  // Never checked in and only setup steps listed: steps left, not something broken.
  const settingUp = Boolean(health.data) && !health.data?.lastSeenAt && problems.every((p) => SETUP_STEPS.has(p.id))
  const plan = fixAllPlan(problems)
  const pending = plan.filter((k) => !fixStarted(fixes, k))
  const busy = fixes.runningAll || fixes.running !== null
  // Results of fixes whose problem is gone after the re-read.
  const done = FIX_KINDS.filter((k) => fixStarted(fixes, k) && !problems.some((p) => p.fix?.kind === k))
  // After Check again: every CI name set, still missing, or not checkable.
  const ciCheck: CiRecheck = !recheckedCi
    ? 'not_rechecked'
    : notes.some((n) => n.check === 'ci_secrets')
      ? 'unverifiable'
      : rawProblems.some((p) => p.id === 'ci_secrets_missing')
        ? 'still_missing'
        : 'all_set'
  const resultProps: ResultProps = { fixes, readiness: fixReadiness.readiness, autofix, ciCheck }

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
              ? !health.data
                ? ''
                : notes.length > 0
                  ? // Never "all good" while a check could not run.
                    `No problems in the checks that ran, but ${notes.length} ${notes.length === 1 ? 'check' : 'checks'} could not run (below).`
                  : 'No SDK problems found.'
              : settingUp
                ? `${problems.length} ${problems.length === 1 ? 'step' : 'steps'} left before this app sends bug reports.`
                : `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} found.`}
        </p>
        <div className="flex items-center gap-2">
          <Btn
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => {
              if (fixes.ci.status !== 'idle') setRecheckedCi(true)
              health.reload()
              fixReadiness.reload()
            }}
            loading={health.isValidating && !health.loading}
          >
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
            <ProblemRow key={p.id} problem={p} result={resultProps} busy={busy} settingUp={settingUp} onFix={(k) => start([k])} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="space-y-1 rounded-md border border-ok/25 px-3 py-2" data-testid="sdk-health-done">
          <p className="text-3xs font-semibold text-fg-secondary">Done</p>
          {done.map((k) => (
            <div key={k}>
              <p className="text-xs font-medium text-fg-secondary">{DONE_LABEL[k]}</p>
              <FixResult kind={k} {...resultProps} />
            </div>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <div className="space-y-1">
          <p className="text-3xs font-semibold text-fg-secondary">Not checked</p>
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

type CiRecheck = 'not_rechecked' | 'all_set' | 'still_missing' | 'unverifiable'

interface ResultProps {
  fixes: SdkHealthFixes
  readiness: FixReadiness
  autofix: ReturnType<typeof useTurnOnAutofix>
  ciCheck: CiRecheck
}

function ProblemRow({
  problem,
  result,
  busy,
  settingUp,
  onFix,
}: {
  problem: SdkHealthProblem
  result: ResultProps
  busy: boolean
  settingUp: boolean
  onFix: (k: SdkHealthFixKind) => void
}) {
  const kind = problem.fix?.kind ?? null
  const fixes = result.fixes
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start" data-testid={`sdk-health-problem-${problem.id}`}>
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${settingUp ? SEVERITY_DOT.info : SEVERITY_DOT[problem.severity]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{problem.title}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{problem.detail}</p>
        {kind && fixStarted(fixes, kind) && <FixResult kind={kind} {...result} />}
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
      {problem.link &&
        (problem.link.href.startsWith('/') ? (
          <Btn size="sm" variant="ghost" to={problem.link.href} className="shrink-0 self-start" data-testid={`sdk-health-link-${problem.id}`}>
            {problem.link.label}
          </Btn>
        ) : (
          <Btn size="sm" variant="ghost" href={problem.link.href} className="shrink-0 gap-1 self-start" data-testid={`sdk-health-link-${problem.id}`}>
            {problem.link.label}
            <IconExternalLink className="h-3 w-3" aria-hidden />
          </Btn>
        ))}
    </li>
  )
}

/** The key sync just minted, hidden until asked: needed where the app builds outside GitHub Actions. */
function MintedKey({ rawKey, prefix }: { rawKey: string; prefix?: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="space-y-1" data-testid="sdk-health-minted-key">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">
          {shown ? rawKey : `${prefix ?? rawKey.slice(0, 12)}…`}
        </code>
        {shown ? (
          <CopyButton value={rawKey} label="Copy API key" copiedLabel="Copied" size="sm" />
        ) : (
          <Btn size="sm" variant="ghost" onClick={() => setShown(true)}>
            Reveal key
          </Btn>
        )}
      </div>
      <p className="text-2xs text-fg-faint">
        This is the only time the full key is shown. If the app also builds on a host (Vercel, Netlify, EAS), set it there too.
      </p>
    </div>
  )
}

function Line({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }) {
  const cls = tone === 'ok' ? 'text-ok-foreground' : tone === 'warn' ? 'text-warn-foreground' : 'text-fg-muted'
  return <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${cls}`}>{children}</p>
}

/** What happens to a filed task next, from the app's Autofix and GitHub state. */
function TaskFiled({ reportId, existing, readiness, autofix }: { reportId: string; existing: boolean } & Pick<ResultProps, 'readiness' | 'autofix'>) {
  const filed = existing ? 'Already filed' : 'Task filed'
  const open = `/reports/${reportId}`
  const prompt = `${open}#fix-prompt`
  if (readiness.kind === 'ready') {
    return (
      <Line tone="ok">
        <IconCheck className="h-3.5 w-3.5" aria-hidden />
        <span>
          {filed}: Mushi Mushi starts the fix and opens it as a draft PR for you to review.{' '}
          <Link to={open} className={LINK_ACCENT}>
            Open the task
          </Link>
        </span>
      </Line>
    )
  }
  if (readiness.kind === 'autofix_off' || readiness.kind === 'blocked') {
    const sentence =
      readiness.kind === 'autofix_off'
        ? `${filed}. Autofix is off for this app: turn it on, or copy the fix prompt into your editor.`
        : `${filed}. Mushi Mushi can't start the fix yet (${readiness.label.toLowerCase()} is not done): finish that step, or copy the fix prompt into your editor.`
    return (
      <div className="mt-1.5 space-y-1.5" data-testid={`sdk-health-task-${readiness.kind}`}>
        <p className="flex items-start gap-1.5 text-xs text-fg-secondary">
          <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
          <span>{sentence}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {readiness.kind === 'blocked' ? (
            <Btn size="sm" variant="ghost" to={readiness.href}>
              Finish setup
            </Btn>
          ) : readiness.githubReady ? (
            <Btn size="sm" variant="ghost" onClick={() => void autofix.turnOn()} loading={autofix.saving} data-testid="sdk-health-turn-on-autofix">
              Turn on Autofix
            </Btn>
          ) : (
            <Btn size="sm" variant="ghost" to={readiness.githubHref}>
              Connect GitHub first
            </Btn>
          )}
          <Btn size="sm" variant="ghost" to={prompt}>
            Copy the fix prompt
          </Btn>
        </div>
      </div>
    )
  }
  return (
    <Line tone="ok">
      <IconCheck className="h-3.5 w-3.5" aria-hidden />
      <span>
        {filed}. Open it for the fix prompt to paste into your editor.{' '}
        <Link to={prompt} className={LINK_ACCENT}>
          Open the task
        </Link>
      </span>
    </Line>
  )
}

function FixResult({ kind, fixes, readiness, autofix, ciCheck }: { kind: SdkHealthFixKind } & ResultProps) {
  const task = taskStateFor(fixes, kind)
  if (task) {
    if (task.status === 'running') return <Line tone="muted">Filing the task…</Line>
    if (task.status === 'failed') return <Line tone="warn">{task.error}</Line>
    return <TaskFiled reportId={task.reportId ?? ''} existing={Boolean(task.existing)} readiness={readiness} autofix={autofix} />
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
      <div className="space-y-1">
        <Line tone="ok">
          <IconCheck className="h-3.5 w-3.5" aria-hidden />
          <span>Wrote {s.written?.join(', ')}. Ship a new build so the app picks them up.</span>
        </Line>
        {s.rawKey && <MintedKey rawKey={s.rawKey} prefix={s.keyPrefix} />}
      </div>
    )
  }
  if (s.status !== 'partial' && s.status !== 'forbidden' && s.status !== 'no-repo' && s.status !== 'failed') return null
  // Set by hand since: Check again found every name in GitHub.
  if (ciCheck === 'all_set') {
    return (
      <Line tone="ok">
        <IconCheck className="h-3.5 w-3.5" aria-hidden />
        <span>Every CI name is set in GitHub now. Ship a new build so the app picks them up.</span>
      </Line>
    )
  }
  const step = ciSecretsManualStep({
    status: s.status,
    failed: s.failed,
    commands: s.fallback?.commands,
    rawKey: s.rawKey,
    errorMessage: s.errorMessage,
  })
  const commands = (
    <>
      {step.commands.map((cmd) => (
        <div key={cmd} className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">{cmd}</code>
          <CopyButton value={cmd} label="Copy command" copiedLabel="Copied" size="sm" />
        </div>
      ))}
      {s.rawKey && <p className="text-2xs text-fg-faint">The command holds the new key. This is the only time it is shown.</p>}
    </>
  )
  // Mushi Mushi cannot read the repo's secrets, so it cannot confirm them. After
  // Check again the warning goes; the command stays under a fold.
  if (ciCheck === 'unverifiable') {
    const names = s.failed?.map((f) => f.name).join(', ') || 'the secret'
    return (
      <div className="mt-1.5 space-y-1.5" data-testid="sdk-health-ci-unverifiable">
        <Line tone="muted">
          Mushi Mushi can&apos;t read your GitHub secrets, so it can&apos;t confirm {names}. If you ran the command, you&apos;re done: the next build&apos;s first report confirms it.
        </Line>
        <details className="text-2xs text-fg-muted">
          <summary className="cursor-pointer">Show the command again</summary>
          <div className="mt-1 space-y-1">{commands}</div>
        </details>
      </div>
    )
  }
  return (
    <div className="mt-1.5 space-y-1.5" data-testid="sdk-health-ci-manual">
      <Line tone="warn">
        <span aria-hidden>{WARNING_SIGN}</span>
        <span>{step.reason}</span>
      </Line>
      {commands}
      {s.rawKey && (
        <details className="text-2xs text-fg-muted">
          <summary className="cursor-pointer">Builds on a host too (Vercel, Netlify, EAS)? Copy the key alone</summary>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">{s.rawKey}</code>
            <CopyButton value={s.rawKey} label="Copy API key" copiedLabel="Copied" size="sm" />
          </div>
        </details>
      )}
    </div>
  )
}
