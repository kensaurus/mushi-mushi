/**
 * FILE: apps/admin/src/components/settings/SettingsStatusBanner.tsx
 * PURPOSE: Project settings health — BYOK tests, SDK widget, routing hooks.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { SettingsStats, SettingsTabId } from './types'

interface Props {
  stats: SettingsStats
  onTab?: (tab: SettingsTabId) => void
}

export function SettingsStatusBanner({ stats, onTab }: Props) {
  const projectLabel = stats.projectName ?? 'this project'

  if (stats.byokKeysFailing > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.byokKeysFailing} BYOK key{stats.byokKeysFailing === 1 ? '' : 's'} failing last test
            </p>
            <p className="text-2xs text-fg-muted">
              Classification and autofix may fall back to platform keys or error — open LLM keys (BYOK) and re-run Test.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
            Fix BYOK
          </Btn>
        ) : null}
      </div>
    )
  }

  if (!stats.byokAnthropicConfigured) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No Anthropic BYOK for {projectLabel}</p>
            <p className="text-2xs text-fg-muted">
              Stage-2 classify and autofix prefer your own Claude key — without it the pipeline uses platform keys (may rate-limit on busy orgs).
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
            Add Anthropic key
          </Btn>
        ) : null}
      </div>
    )
  }

  if (!stats.sdkConfigEnabled) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">SDK widget disabled</p>
            <p className="text-2xs text-fg-muted">
              Reporter capture and widget config are off for {projectLabel} — enable in Dev tools or verify Health &amp; test.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
            Open Health
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.byokKeysUntested > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {stats.byokKeysUntested} BYOK key{stats.byokKeysUntested === 1 ? '' : 's'} never tested
            </p>
            <p className="text-2xs text-fg-muted">
              Run Test on each provider after saving — confirms auth before production traffic hits the pipeline.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
            Test keys
          </Btn>
        ) : null}
      </div>
    )
  }

  if (!stats.slackConfigured && !stats.sentryConfigured) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Routing hooks optional</p>
            <p className="text-2xs text-fg-muted">
              {projectLabel}: BYOK {stats.byokKeysPassing > 0 ? 'passing' : 'configured'} · SDK on · no Slack/Sentry on General yet.
            </p>
          </div>
        </div>
        <Link to="/integrations/config">
          <Btn size="sm" variant="ghost">Integrations</Btn>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Settings healthy for {projectLabel}</p>
          <p className="text-2xs text-fg-muted">
            {stats.byokKeysPassing} BYOK passing · SDK {stats.sdkConfigEnabled ? 'on' : 'off'}
            {stats.stage2Model ? ` · ${stats.stage2Model}` : ''}
            {stats.reporterNotificationsEnabled ? ' · reporter notifications on' : ''}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
          Run pipeline test
        </Btn>
      ) : null}
    </div>
  )
}
