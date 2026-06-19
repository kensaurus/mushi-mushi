/**
 * SSO posture banner — entitlement, registration failures, pending setup.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { SsoStats } from './types'

interface Props {
  stats: SsoStats
  ssoUnlocked: boolean
  onRefresh?: () => void
  refreshing?: boolean
}

export function SsoStatusBanner({ stats, ssoUnlocked, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="Pick a project first"
        subtitle="SSO configs are per app — choose one in the header switcher."
        action={
          <Link to="/projects">
            <Btn size="sm" variant="ghost">Go to Projects</Btn>
          </Link>
        }
      />
    )
  }

  if (!ssoUnlocked) {
    return (
      <StatusBannerShell
        tone="warn"
        title="SSO requires Enterprise"
        subtitle={`${stats.planDisplayName} on ${projectLabel} does not include SAML/OIDC — upgrade to enable corporate login.`}
        action={
          <Link to="/billing?tab=plans">
            <Btn size="sm" variant="ghost">View plans</Btn>
          </Link>
        }
      />
    )
  }

  const label = stats.topPriorityLabel
  const to = stats.topPriorityTo

  if (stats.topPriority === 'registration_failed') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`IdP registration failed${stats.latestProviderName ? ` — ${stats.latestProviderName}` : ''}`}
        subtitle={label ?? stats.latestFailure ?? 'Open the provider row for the error message.'}
        action={
          onRefresh ? (
            <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing}>
              Refresh
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'pending_setup') {
    return (
      <StatusBannerShell
        tone="warn"
        title="Finish IdP configuration"
        subtitle={label}
        action={to ? <Link to={to}><Btn size="sm" variant="ghost">Continue setup</Btn></Link> : null}
      />
    )
  }

  if (stats.topPriority === 'no_providers') {
    return (
      <StatusBannerShell
        tone="brand"
        title="No identity providers yet"
        subtitle={label}
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`SSO active on ${projectLabel}`}
      subtitle={label}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing}>
            Refresh
          </Btn>
        ) : null
      }
    />
  )
}
