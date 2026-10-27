/**
 * FILE: apps/admin/src/components/onboarding/SetupProgressRail.tsx
 * PURPOSE: The top of Set up (console journeys 2026-10-27): "Is my app wired
 *          up? What's the one thing left?"
 *
 *            1. A four-step rail (app → key → SDK heartbeat → first report from
 *               the app), each step with its live state and when it happened.
 *            2. The next step only, with its one button: Make the key, copy
 *               the snippet, send a test bug, or open the first report.
 *            3. The last heartbeat: when, which key, from where.
 *
 *          It replaces the status banner, four tiles and steps guide that sat
 *          above the tabs. The model is lib/setupRail.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CodePanel } from '../CodePanel'
import { Btn } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { buildSetupRail, heartbeatSentence, type SetupRail, type SetupRailStep, type TimeToFirstDiagnosis } from '../../lib/setupRail'
import { DEFAULT_SDK_CONFIG, installCommand, renderSnippet } from '../../lib/sdkSnippets'
import { resolveDefaultSdkFramework } from '../../lib/sdkInstallDefaults'
import { relativeTime } from '../../lib/setupGuideSteps'
import type { SetupProject } from '../../lib/useSetupStatus'
import type { OnboardingTabId } from './types'

interface SetupProgressRailProps {
  project: SetupProject | null
  /** A key minted on this page, so the snippet carries it. */
  apiKey: string | null
  onTab: (tab: OnboardingTabId) => void
  onMintKey: () => void
  minting: boolean
  onSendTest: () => void
  testing: boolean
  /** Rail only (other tabs); the next step and heartbeat show on Overview. */
  compact?: boolean
}

export function SetupProgressRail({ project, apiKey, onTab, onMintKey, minting, onSendTest, testing, compact = false }: SetupProgressRailProps) {
  const { data: ttfd } = usePageData<TimeToFirstDiagnosis>(
    project ? '/v1/admin/onboarding/time-to-first-diagnosis' : null,
    { deps: [project?.project_id ?? null] },
  )
  const rail = buildSetupRail({ project, ttfd: ttfd ?? null })

  return (
    <section
      aria-label="Setup progress"
      data-testid="setup-progress-rail"
      // mushi-mushi-allowlist: a labelled <section> landmark; Card renders a plain div
      className="w-full min-w-0 rounded-md border border-edge-subtle bg-surface-raised p-3 sm:p-4"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-fg">
          {rail.next ? `${rail.doneCount} of 4 done. Next: ${rail.next.label}` : 'Your app is wired up'}
        </h2>
      </div>
      <ol className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {rail.steps.map((step, i) => (
          <RailStep key={step.id} step={step} index={i} onTab={onTab} />
        ))}
      </ol>
      {compact ? null : (
        <>
          <NextStepPanel
            rail={rail}
            project={project}
            apiKey={apiKey}
            onMintKey={onMintKey}
            minting={minting}
            onSendTest={onSendTest}
            testing={testing}
            onTab={onTab}
          />
          <p className="mt-3 flex min-w-0 items-start gap-2 text-2xs text-fg-muted" data-testid="setup-heartbeat">
            <span
              aria-hidden="true"
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${rail.heartbeat ? 'bg-ok' : 'bg-fg-faint'}`}
            />
            <span className="min-w-0 wrap-anywhere">{heartbeatSentence(rail.heartbeat)}</span>
          </p>
        </>
      )}
    </section>
  )
}

const STATE_RING: Record<SetupRailStep['state'], string> = {
  done: 'border-ok/40 bg-ok/5',
  current: 'border-brand/50 bg-brand/5 ring-1 ring-inset ring-brand/20',
  todo: 'border-edge-subtle bg-surface',
}

function RailStep({ step, index, onTab }: { step: SetupRailStep; index: number; onTab: (tab: OnboardingTabId) => void }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onTab(step.tab)}
        aria-current={step.state === 'current' ? 'step' : undefined}
        className={`flex h-full w-full min-w-0 items-start gap-2 rounded-sm border px-2.5 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${STATE_RING[step.state]}`}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-3xs font-semibold ${
            step.state === 'done' ? 'border-ok bg-ok text-ok-fg' : step.state === 'current' ? 'border-brand text-brand' : 'border-fg-faint text-fg-faint'
          }`}
        >
          {step.state === 'done' ? '✓' : index + 1}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium leading-snug text-fg">{step.label}</span>
          <span className={`block text-2xs leading-snug ${step.state === 'done' ? 'text-fg-muted' : step.state === 'current' ? 'text-brand' : 'text-fg-faint'}`}>
            {step.state === 'done' ? '' : <span className="sr-only">Not done: </span>}
            {step.detail}
          </span>
        </span>
      </button>
    </li>
  )
}

function NextStepPanel({
  rail,
  project,
  apiKey,
  onMintKey,
  minting,
  onSendTest,
  testing,
  onTab,
}: {
  rail: SetupRail
  project: SetupProject | null
  apiKey: string | null
  onMintKey: () => void
  minting: boolean
  onSendTest: () => void
  testing: boolean
  onTab: (tab: OnboardingTabId) => void
}) {
  const next = rail.next
  const panel = 'mt-3 min-w-0 border-t border-edge-subtle pt-3'

  if (!next) {
    return (
      <div className={panel} data-testid="setup-next-step">
        <p className="text-xs text-fg-secondary">
          Reports from your app reach Mushi and get a plain-English diagnosis.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {rail.firstReportId ? (
            <Btn size="sm" variant="primary" to={`/reports/${rail.firstReportId}`}>
              Open first report
            </Btn>
          ) : (
            <Btn size="sm" variant="primary" to="/reports">
              Open your bugs
            </Btn>
          )}
        </div>
      </div>
    )
  }

  if (next.id === 'project') {
    return (
      <div className={panel} data-testid="setup-next-step">
        <p className="text-xs text-fg-secondary">Name your app. Mushi makes its report key for you.</p>
        <Btn size="sm" variant="primary" className="mt-2" onClick={() => onTab('steps')}>
          Create your app
        </Btn>
      </div>
    )
  }

  if (next.id === 'key') {
    return (
      <div className={panel} data-testid="setup-next-step">
        <p className="text-xs text-fg-secondary">
          Your app sends bugs with a report key. It is shown once, inside the snippet.
        </p>
        <Btn size="sm" variant="primary" className="mt-2" onClick={onMintKey} loading={minting} disabled={minting}>
          Make the report key
        </Btn>
      </div>
    )
  }

  if (next.id === 'sdk' && project) {
    return <SnippetStep project={project} apiKey={apiKey} onTab={onTab} />
  }

  return (
    <div className={panel} data-testid="setup-next-step">
      <p className="text-xs text-fg-secondary">
        {rail.testDiagnosedAt
          ? `Your test bug was diagnosed ${relativeTime(rail.testDiagnosedAt) ?? 'already'}, so the pipeline works. Report a bug from your app with its bug button to finish.`
          : 'Report a bug from your app with its bug button. Mushi diagnoses it in about a minute.'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Btn size="sm" variant="primary" onClick={onSendTest} loading={testing} disabled={testing}>
          {rail.testDiagnosedAt ? 'Send another test bug' : 'Send a test bug'}
        </Btn>
        <span className="text-2xs text-fg-faint">A test bug checks the pipeline; it doesn’t finish this step.</span>
      </div>
    </div>
  )
}

function SnippetStep({ project, apiKey, onTab }: { project: SetupProject; apiKey: string | null; onTab: (tab: OnboardingTabId) => void }) {
  const [copied, setCopied] = useState(false)
  const framework = resolveDefaultSdkFramework(project.project_slug)
  const code = `${installCommand(framework)}\n\n${renderSnippet(framework, project.project_id, apiKey, DEFAULT_SDK_CONFIG, project.project_slug)}`
  const copy = () => {
    void navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => setCopied(false),
    )
  }
  return (
    <div className="mt-3 min-w-0 space-y-2 border-t border-edge-subtle pt-3" data-testid="setup-next-step">
      <p className="text-xs text-fg-secondary">
        Paste this into your app and load any page. The heartbeat shows up here within a minute.
        {apiKey ? null : ' Your report key replaces the placeholder: make one on the SDK tab, or use the one you saved.'}
      </p>
      <CodePanel label="Install and start the SDK" language="tsx" code={code} onCopy={copy} copied={copied} maxHeight="max-h-56" />
      <div className="flex flex-wrap items-center gap-3">
        <Btn size="sm" variant="primary" onClick={copy}>
          {copied ? 'Copied' : 'Copy snippet'}
        </Btn>
        <Link
          to="/onboarding?tab=sdk"
          onClick={(e) => {
            e.preventDefault()
            onTab('sdk')
          }}
          className="text-2xs font-medium text-accent-foreground underline underline-offset-2 hover:text-accent"
        >
          Other frameworks and widget options →
        </Link>
      </div>
    </div>
  )
}
