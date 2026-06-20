/**
 * FILE: apps/admin/src/components/onboarding/OnboardingStatusBanner.tsx
 * PURPOSE: Setup wizard health — next step, SDK mismatch, pipeline proof.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { OnboardingStats, OnboardingTabId } from './types'

interface Props {
  stats: OnboardingStats
  onTab?: (tab: OnboardingTabId) => void
  onRunTest?: () => void
  testing?: boolean
  /** Quick/Beginner: plain-language titles and verb-led CTAs. */
  plainLanguage?: boolean
}

export function OnboardingStatusBanner({
  stats,
  onTab,
  onRunTest,
  testing,
  plainLanguage = false,
}: Props) {
  const projectLabel = stats.projectName ?? 'your project'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainLanguage ? 'Name your app first' : 'Create your first project to begin'}
        subtitle={
          plainLanguage
            ? 'One project holds all bugs and fixes for a single app.'
            : 'A project groups bug reports from one app — name it after your product, then mint an ingest key.'
        }
        action={
          stats.nextStepTo ? (
            <Link to={stats.nextStepTo}>
              <Btn size="sm" variant="ghost">{plainLanguage ? 'Name your app' : 'Open create form'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('steps')}>
              {plainLanguage ? 'Name your app' : 'Open create form'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.setupDone) {
    return (
      <StatusBannerShell
        tone="ok"
        title={plainLanguage ? `${projectLabel} is ready` : `Required setup complete for ${projectLabel}`}
        subtitle={
          plainLanguage
            ? `${stats.reportCount} test bug${stats.reportCount === 1 ? '' : 's'} received — send real bugs from your app anytime.`
            : `${stats.reportCount} report${stats.reportCount === 1 ? '' : 's'} ingested${stats.fixCount > 0 ? ` · ${stats.fixCount} fix${stats.fixCount === 1 ? '' : 'es'} dispatched` : ''} — SDK tab stays handy for new environments.`
        }
        action={
          <Link to="/reports">
            <Btn size="sm" variant="ghost">{plainLanguage ? 'See bugs' : 'Open dashboard'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.sdkHostMismatch) {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainLanguage ? 'Widget is pointing at the wrong server' : 'SDK is talking to a different backend'}
        subtitle={
          <>
            Admin: <span className="font-mono">{stats.adminEndpointHost ?? '—'}</span> · SDK last seen:{' '}
            <span className="font-mono">{stats.sdkEndpointHost ?? '—'}</span>
          </>
        }
        action={
          stats.nextStepTo ? (
            <Link to={stats.nextStepTo}>
              <Btn size="sm" variant="ghost">{plainLanguage ? 'Fix widget URL' : 'Fix SDK URL'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('sdk')}>
              {plainLanguage ? 'Fix widget URL' : 'Fix SDK URL'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.nextStepId === 'first_report_received' && stats.hasApiKey) {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainLanguage ? 'Send one test bug' : 'Key ready — prove the pipeline'}
        subtitle={
          plainLanguage
            ? 'Confirms bugs from your app show up in Mushi before you ship.'
            : `Send a test report on ${projectLabel} so Reports and the dashboard light up before you ship.`
        }
        action={
          onRunTest ? (
            <Btn size="sm" variant="ghost" onClick={onRunTest} loading={testing} disabled={testing}>
              {plainLanguage ? 'Send test bug' : 'Send test report'}
            </Btn>
          ) : stats.nextStepTo ? (
            <Link to={stats.nextStepTo}>
              <Btn size="sm" variant="ghost">{plainLanguage ? 'Test connection' : 'Verify connection'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('verify')}>
              {plainLanguage ? 'Test connection' : 'Verify connection'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.nextStepId === 'sdk_installed' && stats.hasApiKey) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainLanguage ? 'Paste the widget in your app' : 'Install the SDK in your app'}
        subtitle={
          plainLanguage
            ? 'Copy the snippet — we detect when your app starts sending bugs.'
            : `Paste the snippet on the SDK tab — we'll detect heartbeat traffic on ${projectLabel} automatically.`
        }
        action={
          stats.nextStepTo ? (
            <Link to={stats.nextStepTo}>
              <Btn size="sm" variant="ghost">{plainLanguage ? 'Get snippet' : 'View SDK snippet'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('sdk')}>
              {plainLanguage ? 'Get snippet' : 'View SDK snippet'}
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="warn"
      title={
        plainLanguage
          ? stats.nextStepLabel ?? 'Finish setup'
          : stats.nextStepLabel ?? 'Continue setup'
      }
      subtitle={
        plainLanguage
          ? `${stats.requiredComplete} of ${stats.requiredTotal} steps done`
          : `${stats.requiredComplete}/${stats.requiredTotal} required steps done on ${projectLabel}${stats.optionalComplete > 0 ? ` · ${stats.optionalComplete} optional extras complete` : ''}`
      }
      action={
        stats.nextStepTo ? (
          <Link to={stats.nextStepTo}>
            <Btn size="sm" variant="ghost">{plainLanguage ? 'Continue' : 'Continue setup'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('steps')}>
            {plainLanguage ? 'Continue' : 'Continue setup'}
          </Btn>
        ) : null
      }
    />
  )
}
