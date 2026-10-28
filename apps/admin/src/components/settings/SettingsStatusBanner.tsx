/**
 * FILE: apps/admin/src/components/settings/SettingsStatusBanner.tsx
 * PURPOSE: The one line at the top of Settings: the most important thing to
 *          do, with its button. Key problems are counted from the same
 *          saved-keys list the AI keys rows use (`keySummary`), so the banner
 *          and the rows always agree; the server's counts are only used when
 *          that list could not be read. Sentry counts as set up when a DSN
 *          is saved, or when the shared Integrations verdict is Working
 *          (auth token + org slug, issues coming in) — a DSN-only flag left
 *          the banner on "connect Sentry" while that row said Working.
 *          Quick mode lands on the tab this banner's button opens
 *          (settingsModeUx.resolveQuickSettingsTab).
 */

import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { KeySummary } from './keyStatus'
import type { SettingsStats, SettingsTabId } from './types'
import { slackAlertsReady } from './slackAlertStatus'
import type { ConnectionView } from '../../lib/integrationConnection'

interface Props {
  stats: SettingsStats
  /** Counts from keyStatus.summarizeKeys; null when the key list is unavailable. */
  keySummary?: KeySummary | null
  /** A usable Anthropic key exists (pooled or legacy). */
  hasAnthropicKey?: boolean
  /**
   * The shared Integrations Sentry verdict (`useSentryConnection`). Null
   * while that read is still unknown. A Working verdict counts like a
   * saved DSN.
   */
  sentry?: ConnectionView | null
  onTab?: (tab: SettingsTabId) => void
  plainBanner?: boolean
}

type BannerPriority =
  | 'keys_attention'
  | 'keys_expiring'
  | 'no_anthropic'
  | 'sdk_off'
  | 'keys_unchecked'
  | 'routing_optional'
  | 'slack_incomplete'
  | 'healthy'

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Pure: which banner to show. Exported for tests. */
export function settingsBannerPriority(
  stats: SettingsStats,
  keySummary: KeySummary | null | undefined,
  hasAnthropicKey: boolean,
  sentry?: ConnectionView | null,
): BannerPriority {
  const attention = keySummary ? keySummary.attention : stats.byokKeysFailing
  const unchecked = keySummary ? keySummary.checking : stats.byokKeysUntested
  if (attention > 0) return 'keys_attention'
  if ((keySummary ? keySummary.expiring : (stats.byokKeysExpiring ?? 0)) > 0) return 'keys_expiring'
  if (!hasAnthropicKey) return 'no_anthropic'
  if (!stats.sdkConfigEnabled) return 'sdk_off'
  if (unchecked > 0) return 'keys_unchecked'
  // slackConfigured is "any Slack field is saved". That includes a channel
  // id with no bot, which cannot send. slackCanPost is the send check.
  if (stats.slackConfigured && stats.slackCanPost === false) return 'slack_incomplete'
  // A saved DSN counts. So does the same Working verdict the Integrations
  // card shows (token + org slug, issues imported) — otherwise this banner
  // stays on the connect-Sentry nudge while that row says Working. Null
  // (still loading, or the read failed) and any other state do not count.
  const sentryReady = stats.sentryConfigured || sentry?.state === 'working'
  if (!slackAlertsReady(stats) && !sentryReady) return 'routing_optional'
  return 'healthy'
}

export function SettingsStatusBanner({
  stats,
  keySummary = null,
  hasAnthropicKey = stats.byokAnthropicConfigured,
  sentry = null,
  onTab,
}: Props) {
  const copy = usePageCopy('/settings')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'this project'
  const priority = settingsBannerPriority(stats, keySummary, hasAnthropicKey, sentry)
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
    case 'slack_incomplete':
      return (
        <StatusBannerShell
          tone="warn"
          title="Slack alerts cannot be sent yet"
          subtitle="A Slack setting is saved, but nothing can post. Add Mushi to Slack and pick a channel, or paste a webhook."
          action={go('general', 'Finish Slack setup')}
        />
      )
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
