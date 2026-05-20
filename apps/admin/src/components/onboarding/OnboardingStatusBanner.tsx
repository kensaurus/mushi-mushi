/**
 * FILE: apps/admin/src/components/onboarding/OnboardingStatusBanner.tsx
 * PURPOSE: Setup wizard health — next step, SDK mismatch, pipeline proof.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { OnboardingStats, OnboardingTabId } from './types'

interface Props {
  stats: OnboardingStats
  onTab?: (tab: OnboardingTabId) => void
  onRunTest?: () => void
  testing?: boolean
}

export function OnboardingStatusBanner({ stats, onTab, onRunTest, testing }: Props) {
  const projectLabel = stats.projectName ?? 'your project'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Create your first project to begin</p>
            <p className="text-2xs text-fg-muted">
              A project groups bug reports from one app — name it after your product, then mint an ingest key.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('steps')}>
            Create project
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.setupDone) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
          <div>
            <p className="text-xs font-medium text-ok">Required setup complete for {projectLabel}</p>
            <p className="text-2xs text-fg-muted">
              {stats.reportCount} report{stats.reportCount === 1 ? '' : 's'} ingested
              {stats.fixCount > 0 ? ` · ${stats.fixCount} fix${stats.fixCount === 1 ? '' : 'es'} dispatched` : ''}
              — SDK tab stays handy for new environments.
            </p>
          </div>
        </div>
        <Link to="/dashboard">
          <Btn size="sm" variant="ghost">Open dashboard</Btn>
        </Link>
      </div>
    )
  }

  if (stats.sdkHostMismatch) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">SDK is talking to a different backend</p>
            <p className="text-2xs text-fg-muted break-words font-mono">
              Admin: {stats.adminEndpointHost ?? '—'} · SDK last seen: {stats.sdkEndpointHost ?? '—'}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('sdk')}>
            Fix SDK URL
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.nextStepId === 'first_report_received' && stats.hasApiKey) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">Key ready — prove the pipeline</p>
            <p className="text-2xs text-fg-muted">
              Send a test report on {projectLabel} so Reports and the dashboard light up before you ship.
            </p>
          </div>
        </div>
        {onRunTest ? (
          <Btn size="sm" variant="ghost" onClick={onRunTest} loading={testing} disabled={testing}>
            Send test report
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('verify')}>
            Verify connection
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.nextStepId === 'sdk_installed' && stats.hasApiKey) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Install the SDK in your app</p>
            <p className="text-2xs text-fg-muted">
              Paste the snippet on the SDK tab — we&apos;ll detect heartbeat traffic on {projectLabel} automatically.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('sdk')}>
            View SDK snippet
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
        <div>
          <p className="text-xs font-medium text-warn">
            Next: {stats.nextStepLabel ?? 'Continue setup'}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.requiredComplete}/{stats.requiredTotal} required steps done on {projectLabel}
            {stats.optionalComplete > 0 ? ` · ${stats.optionalComplete} optional extras complete` : ''}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('steps')}>
          Continue setup
        </Btn>
      ) : null}
    </div>
  )
}

