/**
 * FILE: apps/admin/src/components/settings/SettingsStatusBanner.tsx
 * PURPOSE: Project settings health — BYOK tests, SDK widget, routing hooks.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.byokKeysFailing} API key${stats.byokKeysFailing === 1 ? '' : 's'} failed the last test`
            : `${stats.byokKeysFailing} BYOK key${stats.byokKeysFailing === 1 ? '' : 's'} failing last test`
        }
        subtitle={
          stats.topPriorityLabel ??
          'Classification and autofix may fall back to platform keys or error — re-run Test on LLM keys.'
        }
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.byok ?? 'Fix BYOK'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
              {actions.byok ?? 'Fix BYOK'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'no_anthropic' || !stats.byokAnthropicConfigured) {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Add your Claude API key' : `No Anthropic BYOK for ${projectLabel}`}
        subtitle={
          stats.topPriorityLabel ??
          'Stage-2 classify and autofix prefer your own Claude key — without it the pipeline uses platform keys.'
        }
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.byok ?? 'Add Anthropic key'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
              {actions.byok ?? 'Add Anthropic key'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'sdk_off' || !stats.sdkConfigEnabled) {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Reporter widget is off' : 'SDK widget disabled'}
        subtitle={
          stats.topPriorityLabel ??
          `Reporter capture and widget config are off for ${projectLabel} — enable in Health tab.`
        }
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.health ?? 'Open Health'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
              {actions.health ?? 'Open Health'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'untested' || stats.byokKeysUntested > 0) {
    return (
      <StatusBannerShell
        tone="info"
        title={
          plainBanner
            ? `${stats.byokKeysUntested} key${stats.byokKeysUntested === 1 ? '' : 's'} saved but never tested`
            : `${stats.byokKeysUntested} BYOK key${stats.byokKeysUntested === 1 ? '' : 's'} never tested`
        }
        subtitle={
          stats.topPriorityLabel ??
          'Run Test on each provider after saving — confirms auth before production traffic.'
        }
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.test ?? 'Test keys'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('byok')}>
              {actions.test ?? 'Test keys'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'routing_optional' || (!stats.slackConfigured && !stats.sentryConfigured)) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Core settings look good' : 'Routing hooks optional'}
        subtitle={
          stats.topPriorityLabel ??
          `${projectLabel}: BYOK ${stats.byokKeysPassing > 0 ? 'passing' : 'configured'} · SDK on · Slack/Sentry optional on General.`
        }
        action={
          <Link to={stats.topPriorityTo ?? '/integrations/config'}>
            <Btn size="sm" variant="ghost">{actions.integrations ?? 'Integrations'}</Btn>
          </Link>
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? `Settings ready on ${projectLabel}` : `Settings healthy for ${projectLabel}`}
      subtitle={
        stats.topPriorityLabel ??
        `${stats.byokKeysPassing} BYOK passing · SDK ${stats.sdkConfigEnabled ? 'on' : 'off'}${stats.stage2Model ? ` · ${stats.stage2Model}` : ''}`
      }
      action={
        stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.pipeline ?? 'Run pipeline test'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
            {actions.pipeline ?? 'Run pipeline test'}
          </Btn>
        ) : null
      }
    />
  )
}
