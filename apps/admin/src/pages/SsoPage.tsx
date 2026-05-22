/**
 * FILE: apps/admin/src/pages/SsoPage.tsx
 * PURPOSE: Enterprise SSO console — URL-driven tabs, health banner, KPI strip.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { SetupNudge } from '../components/SetupNudge'
import { SsoStatusBanner } from '../components/sso/SsoStatusBanner'
import {
  EMPTY_SSO_STATS,
  type SsoConfig,
  type SsoRegistrationStatus,
  type SsoStats,
  type SsoTabId,
} from '../components/sso/types'
import {
  domainCountDetail,
  domainCountTooltip,
  pendingFailedDetail,
  pendingFailedTooltip,
  planGateDetail,
  planGateTooltip,
  registeredCountDetail,
  registeredCountTooltip,
} from '../lib/statTooltips/sso'
import { ssoLinks } from '../lib/statCardLinks'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Btn,
  Input,
  SelectField,
  ErrorAlert,
  EmptyState,
  CodeValue,
  Section,
  StatCard,
  SegmentedControl,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { useToast } from '../lib/toast'
import { useEntitlements } from '../lib/useEntitlements'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import { ConfirmDialog } from '../components/ConfirmDialog'

interface RegisterResult {
  id: string
  providerId?: string
  acsUrl?: string
  entityId?: string
  status: 'registered' | 'pending' | 'manual_required'
  hint?: string
}

const REGISTRATION_TONE: Record<SsoRegistrationStatus, string> = {
  registered: 'bg-ok-muted text-ok',
  pending: 'bg-warn/10 text-warn',
  failed: 'bg-danger-subtle text-danger',
  disabled: 'bg-surface-overlay text-fg-muted',
  manual_required: 'bg-info-muted text-info',
}

const TABS: Array<{ id: SsoTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Registration health, default ACS URL, and next steps for your IdP.',
  },
  {
    id: 'providers',
    label: 'Providers',
    description: 'All SAML/OIDC configs for this project — status, domains, and disconnect.',
  },
  {
    id: 'setup',
    label: 'Setup',
    description: 'Register a new identity provider via Supabase GoTrue Admin API.',
  },
]

function isTabId(value: string | null): value is SsoTabId {
  return TABS.some((t) => t.id === value)
}

export function SsoPage() {
  const copy = usePageCopy('/sso')
  const activeProjectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const entitlements = useEntitlements()
  const ssoUnlocked = entitlements.has('sso')

  const param = searchParams.get('tab')
  const activeTab: SsoTabId = isTabId(param) ? param : 'overview'
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const statsPath = activeProjectId ? '/v1/admin/sso/stats' : null
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt,
    isValidating,
  } = usePageData<SsoStats>(statsPath)
  const stats = statsData ?? EMPTY_SSO_STATS

  const listPath = activeProjectId ? '/v1/admin/sso' : null
  const { data, loading, error, reload: reloadList } = usePageData<{ configs: SsoConfig[] }>(listPath)
  const configs = data?.configs ?? []

  const reloadAll = useCallback(() => {
    reloadStats()
    reloadList()
  }, [reloadStats, reloadList])

  useRealtimeReload(['enterprise_sso_configs'], reloadAll)

  const setActiveTab = useCallback(
    (id: SsoTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const criticalCount =
    (stats.ssoEntitlement ? 0 : 1) +
    stats.failedCount +
    stats.pendingCount +
    (stats.registeredCount === 0 && stats.ssoEntitlement ? 1 : 0)

  usePublishPageContext({
    route: '/sso',
    title: `${activeTabMeta.label} · SSO`,
    summary: activeTabMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'providers' as const,
        label: 'Providers',
        count: stats.totalConfigs > 0 ? stats.totalConfigs : undefined,
      },
      {
        id: 'setup' as const,
        label: 'Setup',
        count: stats.failedCount > 0 ? stats.failedCount : undefined,
      },
    ],
    [stats.totalConfigs, stats.failedCount],
  )

  const [form, setForm] = useState({
    providerType: 'saml',
    providerName: '',
    metadataUrl: '',
    entityId: '',
    domains: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [lastRegister, setLastRegister] = useState<RegisterResult | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [pendingDisconnect, setPendingDisconnect] = useState<SsoConfig | null>(null)

  const addProvider = async () => {
    if (!form.providerName.trim()) {
      toast.error('Missing fields', 'Provider name is required.')
      return
    }
    if (form.providerType === 'saml' && !form.metadataUrl.trim()) {
      toast.error('Missing fields', 'SAML registration requires a metadata URL.')
      return
    }
    setSubmitting(true)
    const domains = form.domains
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const res = await apiFetch<RegisterResult>('/v1/admin/sso', {
      method: 'POST',
      body: JSON.stringify({
        providerType: form.providerType,
        providerName: form.providerName,
        metadataUrl: form.metadataUrl || undefined,
        entityId: form.entityId || undefined,
        domains,
      }),
    })
    setSubmitting(false)
    if (res.ok && res.data) {
      toast.success(
        res.data.status === 'registered'
          ? 'Identity provider registered'
          : 'Identity provider saved',
        form.providerName,
      )
      setLastRegister(res.data)
      setForm({
        providerType: 'saml',
        providerName: '',
        metadataUrl: '',
        entityId: '',
        domains: '',
      })
      reloadAll()
      setActiveTab('overview')
    } else {
      toast.error('Failed to add provider', res.error?.message)
    }
  }

  const confirmDisconnectProvider = async () => {
    if (!pendingDisconnect) return
    const config = pendingDisconnect
    setDisconnecting(config.id)
    const res = await apiFetch(`/v1/admin/sso/${config.id}`, { method: 'DELETE' })
    setDisconnecting(null)
    setPendingDisconnect(null)
    if (res.ok) {
      toast.success(`${config.provider_name} disconnected`)
      reloadAll()
    } else {
      toast.error('Failed to disconnect', res.error?.message)
    }
  }

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader title={copy?.title ?? 'Single sign-on'} />
        <ContainedBlock tone="muted" className="mb-1">
          <p className="text-xs leading-relaxed text-fg-muted">
            {copy?.description ??
              'Configure SAML or OIDC for your team. JIT-provisioning on first login is enabled by default.'}
          </p>
        </ContainedBlock>
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="SSO configs are scoped to the active project — pick mushi-mushi (or your app) first."
        />
      </div>
    )
  }

  if ((statsLoading && !statsData) || (loading && !data)) {
    return <PanelSkeleton rows={6} label="Loading SSO" />
  }
  if (statsError) {
    return <ErrorAlert message={`Failed to load SSO stats: ${statsError}`} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Single sign-on'}
        projectScope={stats.projectName ?? undefined}
      >
        {stats.ssoEntitlement ? (
          <Badge className="bg-ok-muted text-ok">SSO enabled</Badge>
        ) : (
          <Badge className="bg-warn/10 text-warn">{stats.planDisplayName} — upgrade for SSO</Badge>
        )}
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            'Configure SAML or OIDC for your team. JIT-provisioning on first login is enabled by default.'}
        </p>
      </ContainedBlock>

      <SsoStatusBanner stats={stats} onTab={setActiveTab} />

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="SSO sections"
        size="sm"
      />

      <Section title="Identity snapshot" freshness={{ at: lastFetchedAt, isValidating }}>
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Registered"
            value={stats.registeredCount}
            accent={stats.registeredCount > 0 ? 'text-ok' : undefined}
            tooltip={registeredCountTooltip(stats)}
            detail={registeredCountDetail(stats)}
            to={ssoLinks.registered}
          />
          <StatCard
            label="Pending / failed"
            value={`${stats.pendingCount} / ${stats.failedCount}`}
            accent={stats.failedCount > 0 ? 'text-danger' : stats.pendingCount > 0 ? 'text-warn' : undefined}
            tooltip={pendingFailedTooltip(stats)}
            detail={pendingFailedDetail(stats)}
            to={ssoLinks.pendingFailed}
          />
          <StatCard
            label="Email domains"
            value={stats.domainCount}
            accent={stats.domainCount > 0 ? 'text-info' : undefined}
            tooltip={domainCountTooltip(stats)}
            detail={domainCountDetail()}
            to={ssoLinks.emailDomains}
          />
          <StatCard
            label="Plan gate"
            value={stats.ssoEntitlement ? 'Unlocked' : 'Locked'}
            accent={stats.ssoEntitlement ? 'text-ok' : 'text-warn'}
            tooltip={planGateTooltip(stats)}
            detail={planGateDetail(stats)}
            to={ssoLinks.planGate}
          />
        </div>
      </Section>

      {stats.ssoEntitlement && (stats.failedCount > 0 || stats.pendingCount > 0 || stats.manualRequiredCount > 0) && activeTab === 'overview' && (
        <Card
          className={`space-y-3 p-4 ${
            stats.failedCount > 0 ? 'border-danger/30 bg-danger/5' : 'border-warn/30 bg-warn/5'
          }`}
        >
          <SignalChip tone={stats.failedCount > 0 ? 'danger' : 'warn'}>
            Needs attention
          </SignalChip>
          <ContainedBlock tone="warn">
            <p className="text-xs font-medium leading-snug text-fg">
              {stats.failedCount > 0
                ? `${stats.failedCount} provider registration${stats.failedCount === 1 ? '' : 's'} failed${stats.latestFailure ? ` — ${stats.latestFailure}` : ''}.`
                : stats.manualRequiredCount > 0
                  ? `${stats.manualRequiredCount} provider${stats.manualRequiredCount === 1 ? '' : 's'} need manual IdP steps.`
                  : `${stats.pendingCount} registration${stats.pendingCount === 1 ? '' : 's'} still pending.`}
            </p>
          </ContainedBlock>
          <ActionPillRow>
            <ActionPill onClick={() => setActiveTab('providers')} tone="brand">
              Review providers →
            </ActionPill>
            <ActionPill onClick={() => setActiveTab('setup')} tone="neutral">
              Open setup
            </ActionPill>
          </ActionPillRow>
        </Card>
      )}

      <PageHelp
        title={copy?.help?.title ?? 'About SSO'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Single Sign-On lets your team log in via your corporate identity provider (Okta, Azure AD, Google Workspace, etc.) instead of email + password.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Centrally enforce MFA, password policy, and offboarding',
            'Automatically provision new admins when they join your IdP group',
            'Pass an enterprise security review (SAML 2.0)',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Setup tab registers SAML via metadata URL. Overview shows ACS URL to paste into your IdP. Providers lists all configs and errors. Test with a non-owner user before enforcing SSO-only.'
        }
      />

      {!ssoUnlocked && !entitlements.loading && (
        <UpgradePrompt flag="sso" currentPlan={entitlements.planName} />
      )}

      <div
        role="tabpanel"
        id={`sso-panel-${activeTab}`}
        aria-labelledby={`sso-tab-${activeTab}`}
      >
        {activeTab === 'overview' && (
          <div className="space-y-3">
            {stats.defaultAcsUrl && stats.ssoEntitlement && (
              <Card className="space-y-3 p-3 border border-brand/20 bg-brand/5">
                <SignalChip tone="brand">Default SAML ACS URL</SignalChip>
                <ContainedBlock tone="muted">
                  <p className="text-2xs leading-relaxed text-fg-muted">
                    Paste this Reply URL into your IdP (Okta, Azure AD, etc.) when configuring the SAML app for {stats.projectName}.
                  </p>
                </ContainedBlock>
                <CodeValue value={stats.defaultAcsUrl} tone="url" />
              </Card>
            )}
            {stats.registeredCount === 0 && stats.ssoEntitlement && (
              <EmptyState
                title="No registered providers"
                description="Until an IdP is registered, all admins continue to log in via email and password."
                action={
                  <Btn size="sm" onClick={() => setActiveTab('setup')}>
                    Add SAML provider
                  </Btn>
                }
              />
            )}
            {stats.registeredCount > 0 && (
              <Card className="space-y-3 p-3">
                <SignalChip tone="ok">Quick checklist</SignalChip>
                <ContainedBlock tone="muted">
                  <ul className="text-2xs text-fg-secondary space-y-1 list-disc pl-4">
                    <li>ACS URL pasted into your IdP app configuration</li>
                    <li>Email domains listed on the provider match your team&apos;s addresses</li>
                    <li>Test login with a non-admin user before enforcing SSO-only</li>
                    <li>Keep a break-glass admin password until SSO is verified</li>
                  </ul>
                </ContainedBlock>
                <ActionPillRow>
                  <ActionPill onClick={() => setActiveTab('providers')} tone="brand">
                    View all providers →
                  </ActionPill>
                </ActionPillRow>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'providers' && (
          <>
            {loading ? (
              <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading SSO providers" />
            ) : error ? (
              <ErrorAlert message={`Failed to load SSO configs: ${error}`} onRetry={reloadAll} />
            ) : configs.length === 0 ? (
              <EmptyState
                title="No identity providers configured"
                description="Add a provider in Setup. Until at least one is registered, all admins continue to log in via email and password."
                action={
                  ssoUnlocked ? (
                    <Btn size="sm" onClick={() => setActiveTab('setup')}>
                      Open Setup
                    </Btn>
                  ) : undefined
                }
              />
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-fg-muted border-b border-edge">
                      <th className="text-left py-1.5 px-3 font-medium">Provider</th>
                      <th className="text-left py-1.5 px-3 font-medium">Type</th>
                      <th className="text-left py-1.5 px-3 font-medium">Domains</th>
                      <th className="text-left py-1.5 px-3 font-medium">Status</th>
                      <th className="text-left py-1.5 px-3 font-medium">Provider ID</th>
                      <th className="text-right py-1.5 px-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {configs.map((c) => (
                      <tr key={c.id} className="border-b border-edge-subtle align-top">
                        <td className="py-1.5 px-3 text-fg-secondary">
                          <div>{c.provider_name}</div>
                          {c.registration_error && (
                            <ContainedBlock tone="warn" className="mt-1 max-w-xs">
                              <p className="text-2xs text-danger break-words">{c.registration_error}</p>
                            </ContainedBlock>
                          )}
                          {c.acs_url && c.registration_status === 'registered' && (
                            <div className="mt-1">
                              <CodeValue value={c.acs_url} tone="url" />
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-fg-muted uppercase font-mono">
                          {c.provider_type}
                        </td>
                        <td className="py-1.5 px-3">
                          {c.domains && c.domains.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {c.domains.map((d) => (
                                <SignalChip key={d} tone="info" className="font-mono">
                                  {d}
                                </SignalChip>
                              ))}
                            </div>
                          ) : (
                            <SignalChip tone="neutral">—</SignalChip>
                          )}
                        </td>
                        <td className="py-1.5 px-3">
                          <Badge className={REGISTRATION_TONE[c.registration_status]}>
                            {c.registration_status.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="py-1.5 px-3 text-fg-muted font-mono text-2xs wrap-anywhere">
                          {c.sso_provider_id ?? '—'}
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          {c.registration_status !== 'disabled' && ssoUnlocked && (
                            <Btn
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingDisconnect(c)}
                              disabled={disconnecting === c.id}
                              loading={disconnecting === c.id}
                            >
                              Disconnect
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}

        {activeTab === 'setup' && ssoUnlocked && (
          <>
            <Card className="p-3 space-y-3">
              <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">
                Add Identity Provider
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label="Provider type"
                  helpId="sso.provider_type"
                  value={form.providerType}
                  onChange={(e) => setForm({ ...form, providerType: e.currentTarget.value })}
                >
                  <option value="saml">SAML 2.0 (self-service)</option>
                  <option value="oidc">OpenID Connect (audit-only — manual setup)</option>
                </SelectField>
                <Input
                  label="Provider name"
                  placeholder="e.g. Okta"
                  value={form.providerName}
                  onChange={(e) => setForm({ ...form, providerName: e.target.value })}
                />
                <Input
                  label="Metadata URL"
                  helpId="sso.metadata_url"
                  placeholder={form.providerType === 'saml' ? 'Required' : 'Optional'}
                  value={form.metadataUrl}
                  onChange={(e) => setForm({ ...form, metadataUrl: e.target.value })}
                />
                <Input
                  label="Entity ID"
                  helpId="sso.entity_id"
                  placeholder="Optional, parsed from metadata"
                  value={form.entityId}
                  onChange={(e) => setForm({ ...form, entityId: e.target.value })}
                />
                <Input
                  label="Email domains"
                  helpId="sso.allowed_domains"
                  placeholder="acme.com, acme.io"
                  value={form.domains}
                  onChange={(e) => setForm({ ...form, domains: e.target.value })}
                  className="col-span-2"
                />
              </div>
              <Btn onClick={() => void addProvider()} disabled={submitting} loading={submitting}>
                Add Provider
              </Btn>
              <ContainedBlock tone="muted">
                <p className="text-2xs leading-relaxed text-fg-muted">
                  {form.providerType === 'saml'
                    ? 'On submit, Mushi calls the Supabase Auth Admin API to register the SAML provider. We surface the resulting ACS URL + Entity ID on Overview for you to paste into your IdP.'
                    : 'OIDC providers are stored for audit but Mushi cannot auto-register them — Supabase GoTrue does not yet expose an OIDC admin endpoint. For self-service today, use SAML 2.0.'}
                </p>
              </ContainedBlock>
            </Card>

            {lastRegister?.status === 'registered' && (
              <Card className="p-3 border border-ok/30 bg-ok-muted/20 space-y-2">
                <h3 className="text-xs font-medium text-ok uppercase tracking-wider">
                  Provider registered — finish IdP setup
                </h3>
                <p className="text-2xs text-fg-secondary">
                  Paste these values into your identity provider so it can post SAML responses back to Supabase Auth.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {lastRegister.acsUrl && (
                    <div className="space-y-1">
                      <div className="text-3xs font-semibold uppercase tracking-wider text-fg-faint">
                        ACS URL (Reply URL)
                      </div>
                      <CodeValue value={lastRegister.acsUrl} tone="url" />
                    </div>
                  )}
                  {lastRegister.entityId && (
                    <div className="space-y-1">
                      <div className="text-3xs font-semibold uppercase tracking-wider text-fg-faint">
                        Audience / Entity ID
                      </div>
                      <CodeValue value={lastRegister.entityId} tone="hash" />
                    </div>
                  )}
                  {lastRegister.providerId && (
                    <div className="space-y-1">
                      <div className="text-3xs font-semibold uppercase tracking-wider text-fg-faint">
                        Supabase provider id
                      </div>
                      <CodeValue value={lastRegister.providerId} tone="id" />
                    </div>
                  )}
                </div>
              </Card>
            )}
          </>
        )}

        {activeTab === 'setup' && !ssoUnlocked && !entitlements.loading && (
          <EmptyState
            title="Upgrade to configure SSO"
            description="SAML self-service registration requires Pro or Enterprise on this project."
            action={
              <Link to="/billing?tab=plans">
                <Btn size="sm">Compare plans</Btn>
              </Link>
            }
          />
        )}
      </div>

      {pendingDisconnect && (
        <ConfirmDialog
          title={`Disconnect ${pendingDisconnect.provider_name}?`}
          body="Existing logged-in sessions remain valid until they expire, but new SSO logins will fail until the provider is re-registered. Stored metadata is wiped."
          confirmLabel="Disconnect"
          cancelLabel="Keep connected"
          tone="danger"
          loading={disconnecting === pendingDisconnect.id}
          onConfirm={() => void confirmDisconnectProvider()}
          onCancel={() => {
            if (disconnecting !== pendingDisconnect.id) setPendingDisconnect(null)
          }}
        />
      )}
    </div>
  )
}
