/**
 * FILE: apps/admin/src/lib/statTooltips/sso.ts
 * PURPOSE: Human-readable StatCard tooltips for the SSO Identity snapshot strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { SsoStats } from '../../components/sso/types'
import { metricTip } from '../metricTooltipBuilder'

export function registeredCountTooltip(stats: SsoStats): MetricTooltipData {
  const takeaway =
    stats.registeredCount > 0
      ? `${stats.registeredCount} provider${stats.registeredCount === 1 ? '' : 's'} registered with GoTrue (${stats.activeCount} active · ${stats.totalConfigs} total configs).`
      : stats.ssoEntitlement
        ? 'SSO unlocked but no providers registered — complete Setup tab wizard.'
        : 'SSO requires Pro+ plan — upgrade before registering SAML/OIDC providers.'

  return metricTip(
    'SSO provider configs successfully registered with Supabase GoTrue.',
    'registeredCount = sso_configs with registration_status = registered. activeCount = is_active true. totalConfigs = all rows.',
    takeaway,
    stats.registeredCount === 0 && stats.ssoEntitlement
      ? { tone: 'info', text: 'No registered providers — finish Setup tab.' }
      : !stats.ssoEntitlement
        ? { tone: 'info', text: 'SSO locked on current plan — Pro+ required.' }
        : undefined,
  )
}

export function registeredCountDetail(stats: SsoStats): string {
  return `${stats.activeCount} active · ${stats.totalConfigs} total configs`
}

export function pendingFailedTooltip(stats: SsoStats): MetricTooltipData {
  const takeaway =
    stats.failedCount > 0
      ? `${stats.failedCount} provider${stats.failedCount === 1 ? '' : 's'} failed registration${stats.pendingCount > 0 ? ` · ${stats.pendingCount} pending.` : '.'}${stats.latestFailure ? ' See latest error on Providers tab.' : ''}`
      : stats.pendingCount > 0
        ? `${stats.pendingCount} registration${stats.pendingCount === 1 ? '' : 's'} pending GoTrue confirmation.`
        : stats.manualRequiredCount > 0
          ? `${stats.manualRequiredCount} OIDC provider${stats.manualRequiredCount === 1 ? '' : 's'} need manual GoTrue steps.`
          : 'No pending or failed registrations.'

  return metricTip(
    'SSO configs awaiting or failing GoTrue registration (pending / failed counts).',
    'pendingCount and failedCount from sso_configs registration_status. manualRequiredCount = OIDC configs needing operator action in Supabase dashboard.',
    takeaway,
    stats.failedCount > 0
      ? { tone: 'warn', text: `${stats.failedCount} failed — fix metadata URL or certificates on Providers tab.` }
      : stats.manualRequiredCount > 0
        ? { tone: 'info', text: `${stats.manualRequiredCount} OIDC manual step${stats.manualRequiredCount === 1 ? '' : 's'} required.` }
        : undefined,
  )
}

export function pendingFailedDetail(stats: SsoStats): string {
  return stats.manualRequiredCount > 0 ? `${stats.manualRequiredCount} OIDC manual` : 'GoTrue registration state'
}

export function domainCountTooltip(stats: SsoStats): MetricTooltipData {
  const takeaway =
    stats.domainCount > 0
      ? `${stats.domainCount} email domain${stats.domainCount === 1 ? '' : 's'} route login through SSO — users on those domains skip password auth.`
      : 'No SSO domains configured — add company email domains on each provider.'

  return metricTip(
    'Email domains that trigger SSO login instead of password auth.',
    'Sums distinct domains arrays on active sso_configs rows.',
    takeaway,
    stats.domainCount === 0 && stats.registeredCount > 0
      ? { tone: 'info', text: 'Register domains on providers or SSO will not route users.' }
      : undefined,
  )
}

export function domainCountDetail(): string {
  return 'Domains routed to SSO on login'
}

export function planGateTooltip(stats: SsoStats): MetricTooltipData {
  const takeaway =
    stats.ssoEntitlement
      ? `SSO unlocked on ${stats.planDisplayName} — register SAML or OIDC providers on Setup tab.`
      : `SSO locked on ${stats.planDisplayName} — upgrade to Pro+ to enable enterprise identity.`

  return metricTip(
    'Whether the current plan includes SSO entitlement (Unlocked vs Locked).',
    'ssoEntitlement from plan entitlements table; planDisplayName is the human-readable tier name.',
    takeaway,
    !stats.ssoEntitlement
      ? { tone: 'info', text: `${stats.planDisplayName} · Pro+ required for SSO.` }
      : undefined,
  )
}

export function planGateDetail(stats: SsoStats): string {
  return `${stats.planDisplayName} · Pro+ required`
}
