/**
 * FILE: apps/admin/src/components/sso/SsoStatusBanner.tsx
 * PURPOSE: SSO registration health — entitlement, IdP status, failure recovery.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { SsoStats, SsoTabId } from './types'

interface Props {
  stats: SsoStats
  onTab?: (tab: SsoTabId) => void
}

export function SsoStatusBanner({ stats, onTab }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.projectId) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No project selected</p>
            <p className="text-2xs text-fg-muted">
              SSO configs are per-project — pick an app in the header switcher before registering an IdP.
            </p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="ghost">Go to Projects</Btn>
        </Link>
      </div>
    )
  }

  if (!stats.ssoEntitlement) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">SSO requires Pro or Enterprise</p>
            <p className="text-2xs text-fg-muted">
              {stats.planDisplayName} on {projectLabel} doesn&apos;t include SAML/OIDC — upgrade to configure team sign-in.
            </p>
          </div>
        </div>
        <Link to="/billing?tab=plans">
          <Btn size="sm" variant="ghost">View plans</Btn>
        </Link>
      </div>
    )
  }

  if (stats.failedCount > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.failedCount} provider registration{stats.failedCount === 1 ? '' : 's'} failed
            </p>
            <p className="text-2xs text-fg-muted break-words">
              {stats.latestProviderName ? `${stats.latestProviderName}: ` : ''}
              {stats.latestFailure?.slice(0, 160) ?? 'GoTrue rejected the metadata URL — verify IdP metadata is reachable.'}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('setup')}>
            Retry setup
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.manualRequiredCount > 0 && stats.registeredCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">OIDC saved — manual Supabase provisioning required</p>
            <p className="text-2xs text-fg-muted">
              Mushi can auto-register SAML 2.0 today. OIDC rows are audit-only until Supabase support wires the tenant.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('providers')}>
            View configs
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.pendingCount > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.pendingCount} registration{stats.pendingCount === 1 ? '' : 's'} in progress
            </p>
            <p className="text-2xs text-fg-muted">
              Waiting on Supabase GoTrue — refresh in a few seconds or open Providers to inspect status.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('providers')}>
            Check status
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.registeredCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">SSO unlocked — no IdP registered yet</p>
            <p className="text-2xs text-fg-muted">
              Admins on {projectLabel} still sign in with email/password until you add a SAML metadata URL.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('setup')}>
            Add provider
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {stats.activeCount} active IdP{stats.activeCount === 1 ? '' : 's'} for {projectLabel}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.domainCount} email domain{stats.domainCount === 1 ? '' : 's'} mapped
            {stats.lastRegisteredAt ? (
              <> · last registered <RelativeTime value={stats.lastRegisteredAt} /></>
            ) : null}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('providers')}>
          Manage providers
        </Btn>
      ) : null}
    </div>
  )
}
