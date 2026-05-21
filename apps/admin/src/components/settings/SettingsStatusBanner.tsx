/**
 * FILE: apps/admin/src/components/settings/SettingsStatusBanner.tsx
 * PURPOSE: Project settings health — BYOK tests, SDK widget, routing hooks.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { SettingsStats, SettingsTabId } from './types'

interface Props {
  stats: SettingsStats
  onTab?: (tab: SettingsTabId) => void
  plainBanner?: boolean
}

export function SettingsStatusBanner({ stats, onTab, plainBanner = false }: Props) {
  const copy = usePageCopy('/settings')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'this project'
  const priority = stats.topPriority ?? (stats.byokKeysFailing > 0 ? 'byok_failing' : !stats.byokAnthropicConfigured ? 'no_anthropic' : 'healthy')

  if (priority === 'byok_failing' || stats.byokKeysFailing > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.byokKeysFailing} API key${stats.byokKeysFailing === 1 ? '' : 's'} failed the last test`
                : `${stats.byokKeysFailing} BYOK key${stats.byokKeysFailing === 1 ? '' : 's'} failing last test`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                'Classification and autofix may fall back to platform keys or error — re-run Test on LLM keys.'}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.byok ?? 'Fix BYOK'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
            {actions.byok ?? 'Fix BYOK'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'no_anthropic' || !stats.byokAnthropicConfigured) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Add your Claude API key' : `No Anthropic BYOK for ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                'Stage-2 classify and autofix prefer your own Claude key — without it the pipeline uses platform keys.'}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.byok ?? 'Add Anthropic key'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
            {actions.byok ?? 'Add Anthropic key'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'sdk_off' || !stats.sdkConfigEnabled) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Reporter widget is off' : 'SDK widget disabled'}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                `Reporter capture and widget config are off for ${projectLabel} — enable in Health tab.`}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.health ?? 'Open Health'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
            {actions.health ?? 'Open Health'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'untested' || stats.byokKeysUntested > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner
                ? `${stats.byokKeysUntested} key${stats.byokKeysUntested === 1 ? '' : 's'} saved but never tested`
                : `${stats.byokKeysUntested} BYOK key${stats.byokKeysUntested === 1 ? '' : 's'} never tested`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                'Run Test on each provider after saving — confirms auth before production traffic.'}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.test ?? 'Test keys'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
            {actions.test ?? 'Test keys'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'routing_optional' || (!stats.slackConfigured && !stats.sentryConfigured)) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Core settings look good' : 'Routing hooks optional'}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                `${projectLabel}: BYOK ${stats.byokKeysPassing > 0 ? 'passing' : 'configured'} · SDK on · Slack/Sentry optional on General.`}
            </p>
          </div>
        </div>
        <Link to={stats.topPriorityTo ?? '/integrations/config'}>
          <Btn size="sm" variant="ghost">{actions.integrations ?? 'Integrations'}</Btn>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? `Settings ready on ${projectLabel}` : `Settings healthy for ${projectLabel}`}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.topPriorityLabel ??
              `${stats.byokKeysPassing} BYOK passing · SDK ${stats.sdkConfigEnabled ? 'on' : 'off'}${stats.stage2Model ? ` · ${stats.stage2Model}` : ''}`}
          </p>
        </div>
      </div>
      {stats.topPriorityTo ? (
        <Link to={stats.topPriorityTo}>
          <Btn size="sm" variant="ghost">{actions.pipeline ?? 'Run pipeline test'}</Btn>
        </Link>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
          {actions.pipeline ?? 'Run pipeline test'}
        </Btn>
      ) : null}
    </div>
  )
}
