/**
 * FILE: apps/admin/src/components/sso/SsoStatusBanner.tsx
 * PURPOSE: SSO registration health — entitlement, IdP status, failure recovery.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { SsoStats, SsoTabId } from './types'

interface Props {
  stats: SsoStats
  onTab?: (tab: SsoTabId) => void
}

export function SsoStatusBanner({ stats, onTab }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.projectId) {
    return (
      <StatusBannerShell
        tone="warn"
        title="No project selected"
        subtitle="SSO configs are per-project — pick an app in the header switcher before registering an IdP."
        action={
          <Link to="/projects">
            <Btn size="sm" variant="ghost">Go to Projects</Btn>
          </Link>
        }
      />
    )
  }

  if (!stats.ssoEntitlement) {
    return (
      <StatusBannerShell
        tone="warn"
        title="SSO requires Pro or Enterprise"
        subtitle={`${stats.planDisplayName} on ${projectLabel} doesn't include SAML/OIDC — upgrade to configure team sign-in.`}
        action={
          <Link to="/billing?tab=plans">
            <Btn size="sm" variant="ghost">View plans</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.failedCount > 0) {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.failedCount} provider registration${stats.failedCount === 1 ? '' : 's'} failed`}
        subtitle={
          <span className="break-words">
            {stats.latestProviderName ? `${stats.latestProviderName}: ` : ''}
            {stats.latestFailure?.slice(0, 160) ?? 'GoTrue rejected the metadata URL — verify IdP metadata is reachable.'}
          </span>
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('setup')}>
              Retry setup
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.manualRequiredCount > 0 && stats.registeredCount === 0) {
    return (
      <StatusBannerShell
        tone="info"
        title="OIDC saved — manual Supabase provisioning required"
        subtitle="Mushi can auto-register SAML 2.0 today. OIDC rows are audit-only until Supabase support wires the tenant."
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('providers')}>
              View configs
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.pendingCount > 0) {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.pendingCount} registration${stats.pendingCount === 1 ? '' : 's'} in progress`}
        subtitle="Waiting on Supabase GoTrue — refresh in a few seconds or open Providers to inspect status."
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('providers')}>
              Check status
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.registeredCount === 0) {
    return (
      <StatusBannerShell
        tone="info"
        title="SSO unlocked — no IdP registered yet"
        subtitle={`Admins on ${projectLabel} still sign in with email/password until you add a SAML metadata URL.`}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('setup')}>
              Add provider
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`${stats.activeCount} active IdP${stats.activeCount === 1 ? '' : 's'} for ${projectLabel}`}
      subtitle={
        <>
          {stats.domainCount} email domain{stats.domainCount === 1 ? '' : 's'} mapped
          {stats.lastRegisteredAt ? (
            <> · last registered <RelativeTime value={stats.lastRegisteredAt} /></>
          ) : null}
        </>
      }
      action={
        onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('providers')}>
            Manage providers
          </Btn>
        ) : null
      }
    />
  )
}
