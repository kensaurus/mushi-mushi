/**
 * FILE: apps/admin/src/components/settings/SettingsStatusBanner.tsx
 * PURPOSE: The one line at the top of Settings: the most important thing to
 *          do, with its button. Key problems are counted from the same
 *          saved-keys list the AI keys rows use (`keySummary`), so the banner
 *          and the rows always agree; the server's counts are only used when
 *          that list could not be read. Slack, Sentry and Integrations use
 *          the same verdicts as those rows (`slackConnection`,
 *          `sentrySettingsState`, integration stats), so this line cannot say
 *          everything is working while another indicator says otherwise.
 *          Quick mode lands on the tab this banner's button opens
 *          (settingsModeUx.resolveQuickSettingsTab).
 */

import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { ConnectionState } from '../ui/ConnectionStatus'
import type { KeySummary } from './keyStatus'
import type { SettingsStats, SettingsTabId } from './types'

interface Props {
  stats: SettingsStats
  /** Counts from keyStatus.summarizeKeys; null when the key list is unavailable. */
  keySummary?: KeySummary | null
  /** A usable Anthropic key exists (pooled or legacy). */
  hasAnthropicKey?: boolean
  onTab?: (tab: SettingsTabId) => void
  plainBanner?: boolean
  /** Slack / Sentry row states, and Integrations connection counts. Omit a field while its read is still in flight. */
  context?: SettingsBannerContext | null
}

/** Extra signals that must agree with the banner. Null fields are "not loaded yet". */
export interface SettingsBannerContext {
  channels?: {
    slack?: ConnectionState
    sentry?: ConnectionState
    slackDetail?: string
    sentryDetail?: string
  } | null
  integrations?: { down: number; attention: number } | null
}

type BannerPriority =
  | 'keys_attention'
  | 'keys_expiring'
  | 'no_anthropic'
  | 'sdk_off'
  | 'keys_unchecked'
  | 'integrations_down'
  | 'integrations_attention'
  | 'slack_attention'
  | 'sentry_attention'
  | 'alerts_unverified'
  | 'routing_optional'
  | 'healthy'

function channelBlock(channels: SettingsBannerContext['channels']): BannerPriority | null {
  if (!channels) return null
  if (channels.slack === 'attention') return 'slack_attention'
  if (channels.sentry === 'attention') return 'sentry_attention'
  if (channels.slack === 'checking' || channels.sentry === 'checking') return 'alerts_unverified'
  return null
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Pure: which banner to show. Exported for tests. */
export function settingsBannerPriority(
  stats: SettingsStats,
  keySummary: KeySummary | null | undefined,
  hasAnthropicKey: boolean,
  context?: SettingsBannerContext | null,
): BannerPriority {
  const attention = keySummary ? keySummary.attention : stats.byokKeysFailing
  const unchecked = keySummary ? keySummary.checking : stats.byokKeysUntested
  if (attention > 0) return 'keys_attention'
  if ((keySummary ? keySummary.expiring : (stats.byokKeysExpiring ?? 0)) > 0) return 'keys_expiring'
  if (!hasAnthropicKey) return 'no_anthropic'
  if (!stats.sdkConfigEnabled) return 'sdk_off'
  if (unchecked > 0) return 'keys_unchecked'
  const down = context?.integrations?.down ?? 0
  const needing = context?.integrations?.attention ?? 0
  if (down > 0) return 'integrations_down'
  if (needing > 0) return 'integrations_attention'
  const channel = channelBlock(context?.channels)
  if (channel) return channel
  if (!stats.slackConfigured && !stats.sentryConfigured) return 'routing_optional'
  return 'healthy'
}

export function SettingsStatusBanner({
  stats,
  keySummary = null,
  hasAnthropicKey = stats.byokAnthropicConfigured,
  onTab,
  context = null,
}: Props) {
  const copy = usePageCopy('/settings')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'this project'
  const priority = settingsBannerPriority(stats, keySummary, hasAnthropicKey, context)
  const channels = context?.channels
  const integrations = context?.integrations
  const go = (tab: SettingsTabId, label: string) =>
    onTab ? (
      <Btn size="sm" variant="primary" onClick={() => onTab(tab)}>
        {label}
      </Btn>
    ) : null

  switch (priority) {
    case 'keys_attention': {
      const n = keySummary ? keySummary.attention : stats.byokKeysFailing
      return (
        <StatusBannerShell
          tone="danger"
          title={`${plural(n, 'key')} ${n === 1 ? 'needs' : 'need'} your attention`}
          subtitle="Rejected, out of quota, expired or replaced. Each one says what to do in AI keys."
          action={go('byok', actions.byok ?? 'Fix keys')}
        />
      )
    }
    case 'keys_expiring': {
      const n = keySummary ? keySummary.expiring : (stats.byokKeysExpiring ?? 0)
      return (
        <StatusBannerShell
          tone="warn"
          title={`${plural(n, 'key')} ${n === 1 ? 'expires' : 'expire'} within a week`}
          subtitle="Create a new key at the provider and add it before the old one stops working."
          action={go('byok', 'Replace keys')}
        />
      )
    }
    case 'no_anthropic':
      return (
        <StatusBannerShell
          tone="info"
          title="Optional: add your own Claude key"
          subtitle="Without one, diagnoses and fixes use the server's shared key. Add your Anthropic key to bill your own account."
          action={go('byok', actions.byok ?? 'Add Claude key')}
        />
      )
    case 'sdk_off':
      return (
        <StatusBannerShell
          tone="warn"
          title="The bug widget is off"
          subtitle={`People using ${projectLabel} can't send bug reports until it is turned on.`}
          action={go('sdk', actions.sdk ?? 'Open SDK & connection')}
        />
      )
    case 'keys_unchecked': {
      const n = keySummary ? keySummary.checking : stats.byokKeysUntested
      return (
        <StatusBannerShell
          tone="info"
          title={`${plural(n, 'key')} not checked yet`}
          subtitle="Mushi won't use a key until the provider accepts it. Press Test on each one."
          action={go('byok', actions.test ?? 'Test keys')}
        />
      )
    }
    case 'integrations_down': {
      const n = integrations?.down ?? 0
      return (
        <StatusBannerShell
          tone="danger"
          title={`${plural(n, 'connection')} ${n === 1 ? 'is' : 'are'} failing`}
          subtitle="Integrations has the reason on each card. Fixes may not land until those are green."
          action={
            <Btn to="/integrations/config" size="sm" variant="primary">
              {actions.integrations ?? 'Review connections'}
            </Btn>
          }
        />
      )
    }
    case 'integrations_attention': {
      const n = integrations?.attention ?? 0
      return (
        <StatusBannerShell
          tone="warn"
          title={`${n} connection${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`}
          subtitle="Saved, but not confirmed. Integrations shows the same count and the fix on each card."
          action={
            <Btn to="/integrations/config" size="sm" variant="primary">
              {actions.integrations ?? 'Review connections'}
            </Btn>
          }
        />
      )
    }
    case 'slack_attention':
      return (
        <StatusBannerShell
          tone="warn"
          title="Slack can't send alerts yet"
          subtitle={channels?.slackDetail ?? 'Add a channel and a way to post, then send a test message.'}
          action={go('general', 'Fix Slack')}
        />
      )
    case 'sentry_attention':
      return (
        <StatusBannerShell
          tone="warn"
          title="Sentry can't receive errors yet"
          subtitle={channels?.sentryDetail ?? "Add the webhook secret, or Mushi can't accept Sentry's deliveries."}
          action={go('general', 'Fix Sentry')}
        />
      )
    case 'alerts_unverified': {
      const slack = channels?.slack === 'checking'
      const sentry = channels?.sentry === 'checking'
      const title = slack && sentry
        ? 'Slack and Sentry are saved — not confirmed yet'
        : slack
          ? 'Slack is saved — not confirmed yet'
          : 'Sentry is saved — not confirmed yet'
      const subtitle = slack && !sentry
        ? (channels?.slackDetail ?? 'Send a test message before treating Slack as working.')
        : !slack && sentry
          ? (channels?.sentryDetail ?? 'The Integrations page shows when Sentry sends its first error.')
          : 'Neither has been confirmed yet. A saved setting is not the same as a working one.'
      return (
        <StatusBannerShell
          tone="info"
          title={title}
          subtitle={subtitle}
          action={go('general', 'Review alerts')}
        />
      )
    }
    case 'routing_optional':
      return (
        <StatusBannerShell
          tone="ok"
          title="Settings are ready"
          subtitle="Optional next step: send bug alerts to Slack, or turn Sentry errors into reports."
          action={
            <Btn to="/integrations/config" size="sm" variant="ghost">
              {actions.integrations ?? 'Integrations'}
            </Btn>
          }
        />
      )
    default:
      return (
        <StatusBannerShell
          tone="ok"
          title={`Settings are ready for ${projectLabel}`}
          subtitle="Everything that is set up is working. Send a test bug any time to check the whole path."
          action={go('sdk', actions.pipeline ?? 'Send a test bug')}
        />
      )
  }
}
