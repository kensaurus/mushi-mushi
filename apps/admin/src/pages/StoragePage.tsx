/**
 * FILE: apps/admin/src/pages/StoragePage.tsx
 * PURPOSE: BYO Storage configuration. The previous version only rendered cards
 *          for projects that already had a `project_storage_settings` row,
 *          which left brand-new accounts staring at a dead empty state. We now
 *          fetch the user's owned projects and render a configurable card per
 *          project, pre-filled with the cluster defaults. Saving any field
 *          PUTs to /v1/admin/storage/:projectId which upserts the row so the
 *          first save creates the override automatically.
 */

import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { StorageStatusBanner } from '../components/storage/StorageStatusBanner'
import { EMPTY_STORAGE_STATS, type StorageStats, type StorageTabId } from '../components/storage/types'
import { PageHeader, PageHelp, Card, Btn, Badge, ErrorAlert, Input, SelectField, Section, StatCard, SegmentedControl } from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SetupNudge } from '../components/SetupNudge'
import { useToast } from '../lib/toast'
import { PageActionBar } from '../components/PageActionBar'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'

type Provider = 'supabase' | 's3' | 'r2' | 'gcs' | 'minio'

interface HealthDebugStep {
  step: string
  ok: boolean
  ms: number
  detail?: string
}

interface StorageSetting {
  project_id: string
  provider: Provider
  bucket: string
  region: string | null
  endpoint: string | null
  path_prefix: string
  signed_url_ttl_secs: number
  use_signed_urls: boolean
  access_key_vault_ref: string | null
  secret_key_vault_ref: string | null
  service_account_vault_ref: string | null
  kms_key_id: string | null
  encryption_required: boolean
  health_status: 'unknown' | 'healthy' | 'degraded' | 'failing'
  last_health_check_at: string | null
  last_health_error: string | null
  last_health_debug: HealthDebugStep[] | null
}

interface OwnedProject {
  id: string
  name: string
}

interface StorageUsageRow {
  project_id: string
  object_count: number
  last_write_at: string | null
}

const HEALTH_CHIP: Record<StorageSetting['health_status'], string> = {
  unknown: 'bg-fg-muted/10 text-fg-muted border-edge-subtle',
  healthy: 'bg-ok/15 text-ok border-ok/30',
  degraded: 'bg-warn/15 text-warn border-warn/30',
  failing: 'bg-danger/15 text-danger border-danger/30',
}

// New cards (no DB row yet) need a sensible baseline so the user can hit Save
// without filling every field. These match the cluster defaults.
function defaultsFor(projectId: string): StorageSetting {
  return {
    project_id: projectId,
    provider: 'supabase',
    bucket: 'mushi-public',
    region: null,
    endpoint: null,
    path_prefix: 'mushi-mushi/',
    signed_url_ttl_secs: 3600,
    use_signed_urls: true,
    access_key_vault_ref: null,
    secret_key_vault_ref: null,
    service_account_vault_ref: null,
    kms_key_id: null,
    encryption_required: false,
    health_status: 'unknown',
    last_health_check_at: null,
    last_health_error: null,
    last_health_debug: null,
  }
}

interface ValidationHint {
  field: string
  message: string
  blocking: boolean
}

function validateProvider(m: StorageSetting): ValidationHint[] {
  const hints: ValidationHint[] = []
  const p = m.provider

  if (p === 'minio' && !m.endpoint) {
    hints.push({ field: 'endpoint', message: 'MinIO requires an explicit endpoint URL.', blocking: true })
  }
  if (p === 'gcs' && !m.service_account_vault_ref) {
    hints.push({ field: 'service_account_vault_ref', message: 'GCS requires a service-account Vault reference.', blocking: true })
  }
  if (['s3', 'r2', 'minio'].includes(p)) {
    if (!m.access_key_vault_ref) {
      hints.push({ field: 'access_key_vault_ref', message: `${p.toUpperCase()} requires an Access key Vault reference.`, blocking: true })
    }
    if (!m.secret_key_vault_ref) {
      hints.push({ field: 'secret_key_vault_ref', message: `${p.toUpperCase()} requires a Secret key Vault reference.`, blocking: true })
    }
  }
  if (p === 's3' && !m.region) {
    hints.push({ field: 'region', message: 'AWS S3 requires a region (e.g. us-east-1).', blocking: true })
  }
  if (p === 'r2' && m.region && m.region.toLowerCase() !== 'auto') {
    hints.push({ field: 'region', message: 'Cloudflare R2 ignores the region field — set it to "auto" or leave blank.', blocking: false })
  }
  return hints
}

const STORAGE_TABS: Array<{ id: StorageTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Bucket health summary, PageHero decide/act/verify, and active-project posture.',
  },
  {
    id: 'configure',
    label: 'Configure',
    description: 'Per-project provider, bucket, Vault refs, and health-probe debug log.',
  },
  {
    id: 'usage',
    label: 'Usage',
    description: 'Screenshot object counts and last-write timestamps per owned project.',
  },
]

function isStorageTab(value: string | null): value is StorageTabId {
  return STORAGE_TABS.some((t) => t.id === value)
}

export function StoragePage() {
  const copy = usePageCopy('/storage')
  const activeProjectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const activeTab: StorageTabId = isStorageTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = STORAGE_TABS.find((t) => t.id === activeTab) ?? STORAGE_TABS[0]

  const statsPath = activeProjectId ? '/v1/admin/storage/stats' : null
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<StorageStats>(statsPath)
  const stats = statsData ?? EMPTY_STORAGE_STATS

  const settingsQuery = usePageData<{ settings: StorageSetting[] }>(
    activeProjectId ? '/v1/admin/storage' : null,
  )
  const projectsQuery = usePageData<{ projects: OwnedProject[] }>(
    activeProjectId ? '/v1/admin/projects' : null,
  )
  const usageQuery = usePageData<{ usage: StorageUsageRow[] }>(
    activeProjectId ? '/v1/admin/storage/usage' : null,
  )
  const settings = settingsQuery.data?.settings ?? []
  const projects = projectsQuery.data?.projects ?? []
  const usageRows = usageQuery.data?.usage ?? []
  const loading = settingsQuery.loading || projectsQuery.loading
  const error = settingsQuery.error ?? projectsQuery.error
  const reloadAll = useCallback(() => {
    reloadStats()
    settingsQuery.reload()
    projectsQuery.reload()
    usageQuery.reload()
  }, [reloadStats, settingsQuery, projectsQuery, usageQuery])

  useRealtimeReload(['project_storage_settings'], reloadAll)

  const setActiveTab = useCallback(
    (id: StorageTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const usageByProject = useMemo(
    () => new Map(usageRows.map((u) => [u.project_id, u])),
    [usageRows],
  )

  // Drafts only carry fields the user has touched. We merge them on top of the
  // existing setting (or the defaults for un-configured projects) at render.
  const [drafts, setDrafts] = useState<Record<string, Partial<StorageSetting>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  // Live debug steps from the most recent health probe (not yet persisted to DB)
  const [liveDebug, setLiveDebug] = useState<Record<string, HealthDebugStep[]>>({})
  // Which cards have their debug panel open
  const [debugOpen, setDebugOpen] = useState<Record<string, boolean>>({})
  const toast = useToast()

  // Show one card per owned project. Projects with an existing row use their
  // saved values; the rest get a synthesised "default" row that the user can
  // edit and save (the PUT endpoint upserts so the first save creates the row).
  const cards: Array<{ setting: StorageSetting; existing: boolean }> = useMemo(() => {
    const byId = new Map(settings.map((s) => [s.project_id, s]))
    return projects.map((p) => {
      const existing = byId.get(p.id)
      return existing
        ? { setting: existing, existing: true }
        : { setting: defaultsFor(p.id), existing: false }
    })
  }, [settings, projects])

  const draftFor = (projectId: string): Partial<StorageSetting> => drafts[projectId] ?? {}
  const merged = (s: StorageSetting): StorageSetting => ({ ...s, ...draftFor(s.project_id) })

  const updateDraft = (projectId: string, patch: Partial<StorageSetting>) => {
    setDrafts((prev) => ({ ...prev, [projectId]: { ...(prev[projectId] ?? {}), ...patch } }))
  }

  const save = async (projectId: string, isFirstSave: boolean) => {
    const patch = drafts[projectId] ?? {}
    const payload = isFirstSave
      ? { ...defaultsFor(projectId), ...patch }
      : patch
    if (!payload || Object.keys(payload).length === 0) return
    setSavingId(projectId)
    const res = await apiFetch(`/v1/admin/storage/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    setSavingId(null)
    if (!res.ok) {
      toast.error('Save failed', res.error?.message)
      return
    }
    toast.success(isFirstSave ? 'Storage configured' : 'Storage settings saved')
    setDrafts((prev) => ({ ...prev, [projectId]: {} }))
    reloadAll()
  }

  const checkHealth = async (projectId: string) => {
    setCheckingId(projectId)
    const res = await apiFetch<{ healthy: boolean; error: string | null; debug: HealthDebugStep[] }>(
      `/v1/admin/storage/${projectId}/health`,
      { method: 'POST' },
    )
    setCheckingId(null)

    if (res.data?.debug) {
      setLiveDebug((prev) => ({ ...prev, [projectId]: res.data!.debug }))
      // Auto-open the debug panel so the user sees the output immediately
      setDebugOpen((prev) => ({ ...prev, [projectId]: true }))
    }

    if (res.data?.healthy) {
      toast.success('Health check passed', 'Bucket is reachable and accepts writes.')
    } else {
      const errMsg = res.data?.error ?? res.error?.message
      toast.error('Health check failed', errMsg)
    }
    reloadAll()
  }

  const failingBuckets = stats.failingCount
  const degradedBuckets = stats.degradedCount
  const storageAction = useNextBestAction({
    scope: 'storage',
    approachingQuotaPct: null,
    failedUploadsLastHour: failingBuckets,
  })
  const storageSeverity: 'crit' | 'warn' | 'ok' | 'neutral' =
    stats.configuredCount === 0 && stats.projectCount > 0
      ? 'neutral'
      : failingBuckets > 0
        ? 'crit'
        : degradedBuckets > 0
          ? 'warn'
          : 'ok'

  const criticalCount = stats.failingCount + (stats.neverProbedCount > 0 && stats.activeProjectConfigured ? 1 : 0)

  usePublishPageContext({
    route: '/storage',
    title: `${activeTabMeta.label} · Storage`,
    summary: activeTabMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'configure' as const,
        label: 'Configure',
        count: stats.failingCount > 0 ? stats.failingCount : stats.configuredCount > 0 ? stats.configuredCount : undefined,
      },
      {
        id: 'usage' as const,
        label: 'Usage',
        count: stats.totalObjects > 0 ? stats.totalObjects : undefined,
      },
    ],
    [stats.failingCount, stats.configuredCount, stats.totalObjects],
  )

  const usageTable = (
    <Card className="p-3">
      <div className="text-xs font-medium uppercase tracking-wider mb-2" data-dav-anchor="storage:verify">
        Per-project usage
      </div>
      <p className="text-2xs text-fg-muted mb-2">
        Counts uploaded screenshots and the most recent write timestamp. Helpful to spot a project burning through
        storage or to confirm a quiet project before changing its provider.
      </p>
      {usageRows.length === 0 ? (
        <p className="text-2xs text-fg-muted">No screenshot uploads recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-fg-muted uppercase tracking-wider text-3xs">
              <tr className="border-b border-edge-subtle">
                <th className="py-1.5 text-left">Project</th>
                <th className="text-right">Objects</th>
                <th className="text-left pl-3">Last write</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const u = usageByProject.get(p.id)
                const isActive = p.id === activeProjectId
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-edge-subtle/40 ${isActive ? 'bg-brand/5' : ''}`}
                  >
                    <td className="py-1.5">
                      {p.name}
                      {isActive ? (
                        <span className="ml-1.5 text-3xs text-brand uppercase">Active</span>
                      ) : null}
                    </td>
                    <td className="text-right font-mono">{(u?.object_count ?? 0).toLocaleString()}</td>
                    <td className="pl-3 text-fg-muted">
                      {u?.last_write_at ? new Date(u.last_write_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )

  const renderProjectCard = ({ setting: s, existing }: { setting: StorageSetting; existing: boolean }) => {
        const m = merged(s)
        const dirty = Object.keys(draftFor(s.project_id)).length > 0
        const projectName = projects.find((p) => p.id === s.project_id)?.name ?? s.project_id
        const hints = validateProvider(m)
        const blockingHints = hints.filter((h) => h.blocking)
        const warnHints = hints.filter((h) => !h.blocking)
        const saveBlocked = existing ? (!dirty || blockingHints.length > 0) : blockingHints.length > 0
        const debugSteps = liveDebug[s.project_id] ?? s.last_health_debug ?? null
        const isDebugOpen = debugOpen[s.project_id] ?? false
        const isActive = s.project_id === activeProjectId

        return (
          <Card key={s.project_id} className={`p-3 ${isActive ? 'ring-1 ring-brand/40' : ''}`}>
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-fg truncate">
                  {projectName}
                  {isActive ? <span className="ml-1.5 text-3xs text-brand uppercase">Active</span> : null}
                </div>
                <code className="text-3xs opacity-70 font-mono wrap-anywhere">{s.project_id}</code>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!existing ? (
                  <span className="inline-flex rounded px-2 py-0.5 text-3xs bg-info/10 text-info border border-info/30">
                    Using cluster default — save to override
                  </span>
                ) : (
                  <>
                    <span className={`inline-flex rounded px-2 py-0.5 text-3xs border ${HEALTH_CHIP[s.health_status]}`}>
                      {s.health_status.toUpperCase()}
                    </span>
                    {s.last_health_check_at ? (
                      <span className="text-2xs text-fg-muted">
                        Checked {new Date(s.last_health_check_at).toLocaleString()}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SelectField
                label="Provider"
                helpId="storage.provider"
                value={m.provider}
                onChange={(e) => updateDraft(s.project_id, { provider: e.target.value as Provider })}
              >
                <option value="supabase">Supabase Storage (default)</option>
                <option value="s3">AWS S3</option>
                <option value="r2">Cloudflare R2</option>
                <option value="gcs">Google Cloud Storage</option>
                <option value="minio">MinIO (self-hosted)</option>
              </SelectField>
              <Input
                label="Bucket"
                helpId="storage.bucket"
                value={m.bucket}
                onChange={(e) => updateDraft(s.project_id, { bucket: e.target.value })}
              />
              <Input
                label="Region"
                helpId="storage.region"
                value={m.region ?? ''}
                placeholder={m.provider === 'r2' ? 'auto' : 'us-east-1'}
                onChange={(e) => updateDraft(s.project_id, { region: e.target.value || null as unknown as string })}
              />
              <Input
                label="Endpoint (S3-compatible only)"
                helpId="storage.endpoint"
                value={m.endpoint ?? ''}
                placeholder="https://s3.us-east-1.amazonaws.com"
                onChange={(e) => updateDraft(s.project_id, { endpoint: e.target.value || null as unknown as string })}
              />
              <Input
                label="Path prefix"
                helpId="storage.path_prefix"
                value={m.path_prefix}
                placeholder="mushi-mushi/"
                onChange={(e) => updateDraft(s.project_id, { path_prefix: e.target.value })}
              />
              <Input
                label="Signed URL TTL (seconds)"
                helpId="storage.signed_url_ttl_secs"
                type="number"
                value={String(m.signed_url_ttl_secs)}
                onChange={(e) => updateDraft(s.project_id, { signed_url_ttl_secs: parseInt(e.target.value, 10) || 3600 })}
              />
              <Input
                label="Access key Vault ref"
                helpId="storage.access_key_ref"
                value={m.access_key_vault_ref ?? ''}
                placeholder="mushi_s3_access_key_<project>"
                onChange={(e) => updateDraft(s.project_id, { access_key_vault_ref: e.target.value || null as unknown as string })}
              />
              <Input
                label="Secret key Vault ref"
                helpId="storage.secret_key_ref"
                value={m.secret_key_vault_ref ?? ''}
                placeholder="mushi_s3_secret_key_<project>"
                onChange={(e) => updateDraft(s.project_id, { secret_key_vault_ref: e.target.value || null as unknown as string })}
              />
              {m.provider === 'gcs' ? (
                <Input
                  label="GCS service-account Vault ref"
                  value={m.service_account_vault_ref ?? ''}
                  placeholder="mushi_gcs_sa_<project>"
                  onChange={(e) => updateDraft(s.project_id, { service_account_vault_ref: e.target.value || null as unknown as string })}
                />
              ) : null}
              <Input
                label="KMS Key ID (optional)"
                helpId="storage.kms_key_id"
                value={m.kms_key_id ?? ''}
                onChange={(e) => updateDraft(s.project_id, { kms_key_id: e.target.value || null as unknown as string })}
              />
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={m.use_signed_urls}
                  onChange={(e) => updateDraft(s.project_id, { use_signed_urls: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-edge-subtle accent-brand"
                />
                <span>
                  Use signed URLs
                  <span className="ml-1 text-fg-muted text-2xs">(serve uploads via short-lived links)</span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={m.encryption_required}
                  onChange={(e) => updateDraft(s.project_id, { encryption_required: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-edge-subtle accent-brand"
                />
                <span>
                  Require encryption
                  <span className="ml-1 text-fg-muted text-2xs">(reject uploads without server-side encryption)</span>
                </span>
              </label>
            </div>

            {(blockingHints.length > 0 || warnHints.length > 0) && (
              <div className="mt-3 space-y-1">
                {blockingHints.map((h) => (
                  <p key={h.field} className="text-2xs text-danger flex items-start gap-1">
                    <span className="shrink-0 font-bold">✕</span>
                    {h.message}
                  </p>
                ))}
                {warnHints.map((h) => (
                  <p key={h.field} className="text-2xs text-warn flex items-start gap-1">
                    <span className="shrink-0 font-bold">!</span>
                    {h.message}
                  </p>
                ))}
              </div>
            )}

            {existing && s.last_health_error ? (
              <p className="mt-2 text-2xs text-danger">Last error: {s.last_health_error}</p>
            ) : null}

            {existing && debugSteps && debugSteps.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  className="text-2xs text-fg-muted hover:text-fg flex items-center gap-1 focus:outline-none"
                  onClick={() => setDebugOpen((prev) => ({ ...prev, [s.project_id]: !prev[s.project_id] }))}
                >
                  <span className={`inline-block transition-transform duration-150 ${isDebugOpen ? 'rotate-90' : ''}`}>▶</span>
                  <span>{isDebugOpen ? 'Hide' : 'Show'} debug log</span>
                  <span className="opacity-50">({debugSteps.length} steps)</span>
                </button>
                {isDebugOpen && (
                  <div className="mt-1 overflow-x-auto rounded border border-edge-subtle bg-surface-overlay">
                    <table className="w-full text-2xs font-mono">
                      <thead className="text-fg-muted uppercase tracking-wider text-3xs border-b border-edge-subtle">
                        <tr>
                          <th className="py-1 px-2 text-left">Step</th>
                          <th className="px-2">Result</th>
                          <th className="px-2 text-right">ms</th>
                          <th className="px-2 text-left">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debugSteps.map((step, i) => (
                          <tr key={i} className="border-b border-edge-subtle/40">
                            <td className="py-1 px-2">{step.step}</td>
                            <td className={`px-2 text-center font-semibold ${step.ok ? 'text-ok' : 'text-danger'}`}>
                              {step.ok ? '✓' : '✕'}
                            </td>
                            <td className="px-2 text-right text-fg-muted">{step.ms}</td>
                            <td className="px-2 text-fg-muted truncate max-w-xs" title={step.detail}>{step.detail ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => checkHealth(s.project_id)}
                disabled={!existing || savingId === s.project_id || checkingId === s.project_id}
                loading={checkingId === s.project_id}
                title={!existing ? 'Save the configuration first to enable health checks' : undefined}
                data-dav-anchor="storage:act"
              >
                Health check
              </Btn>
              <Btn
                size="sm"
                onClick={() => save(s.project_id, !existing)}
                disabled={saveBlocked || savingId === s.project_id || checkingId === s.project_id}
                loading={savingId === s.project_id}
              >
                {existing ? 'Save' : 'Save & enable'}
              </Btn>
            </div>
          </Card>
        )
  }

  const activeCard = cards.find((c) => c.setting.project_id === activeProjectId)

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={copy?.title ?? 'Storage'}
          description={copy?.description ?? 'Per-project BYO bucket configuration for screenshots and attachments.'}
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Storage backends are scoped per project — pick mushi-mushi (or your app) first."
        />
      </div>
    )
  }

  if ((statsLoading && !statsData) || loading) {
    return <TableSkeleton rows={5} columns={4} showFilters label="Loading storage" />
  }
  if (statsError) {
    return <ErrorAlert message={`Failed to load storage stats: ${statsError}`} onRetry={reloadAll} />
  }
  if (error) {
    return <ErrorAlert message={error} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Storage'}
        projectScope={stats.projectName ?? undefined}
        description={
          copy?.description ??
          'Per-project BYO bucket configuration for screenshots, intelligence PDFs, and fix attachments.'
        }
      >
        <Badge className={stats.activeProjectHealthStatus === 'healthy' ? 'bg-ok-muted text-ok' : stats.activeProjectHealthStatus === 'failing' ? 'bg-danger-subtle text-danger' : 'bg-warn/10 text-warn'}>
          {stats.activeProjectHealthStatus.toUpperCase()}
        </Badge>
      </PageHeader>

      <StorageStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onHealthCheck={activeProjectId ? () => checkHealth(activeProjectId) : undefined}
        checking={checkingId === activeProjectId}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Storage sections"
        size="sm"
      />

      <Section title="Storage snapshot" freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <p className="mb-3 text-2xs text-fg-muted">{activeTabMeta.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Healthy"
            value={`${stats.healthyCount}/${stats.configuredCount}`}
            accent={stats.failingCount > 0 ? 'text-danger' : stats.healthyCount > 0 ? 'text-ok' : undefined}
            hint={`${stats.failingCount} failing · ${stats.degradedCount} degraded`}
          />
          <StatCard
            label="Screenshots"
            value={stats.activeProjectObjects.toLocaleString()}
            accent={stats.activeProjectObjects > 0 ? 'text-brand' : undefined}
            hint={`${stats.totalObjects.toLocaleString()} total across projects`}
          />
          <StatCard
            label="Provider"
            value={stats.activeProjectProvider}
            accent="text-info"
            hint={stats.activeProjectConfigured ? 'Custom override saved' : 'Cluster Supabase default'}
          />
          <StatCard
            label="Unconfigured"
            value={stats.unconfiguredCount}
            accent={stats.unconfiguredCount > 0 ? 'text-warn' : 'text-ok'}
            hint={`${stats.neverProbedCount} never probed`}
          />
        </div>
      </Section>

      {activeTab === 'overview' && (
        <>
          <PageHero
            scope="storage"
            title="Storage"
            kicker="Bucket health"
            decide={{
              label:
                storageSeverity === 'crit'
                  ? 'Buckets are failing uploads'
                  : storageSeverity === 'warn'
                    ? 'Bucket health is degraded'
                    : storageSeverity === 'ok'
                      ? 'Buckets are healthy'
                      : 'Using cluster defaults',
              metric: stats.configuredCount === 0 ? '—' : `${stats.healthyCount}/${stats.configuredCount} healthy`,
              summary:
                storageSeverity === 'crit'
                  ? 'Failing buckets drop screenshot uploads silently — rotate credentials or re-run the probe.'
                  : storageSeverity === 'warn'
                    ? 'Degraded buckets still accept uploads but have recent errors — probe before users hit them.'
                    : storageSeverity === 'ok'
                      ? `${stats.configuredCount} bucket${stats.configuredCount === 1 ? '' : 's'} configured and passing probes.`
                      : 'Save a BYO override on Configure to pin screenshots to S3, R2, GCS, or MinIO.',
              severity: storageSeverity,
              anchor: 'storage:decide',
              evidence:
                stats.configuredCount > 0
                  ? {
                      kind: 'metric-breakdown',
                      items: [
                        { label: 'Buckets', value: stats.configuredCount, tone: 'neutral' },
                        { label: 'Healthy', value: stats.healthyCount, tone: stats.healthyCount > 0 ? 'ok' : 'neutral' },
                        { label: 'Degraded', value: stats.degradedCount, tone: stats.degradedCount > 0 ? 'warn' : 'ok' },
                        { label: 'Failing', value: stats.failingCount, tone: stats.failingCount > 0 ? 'crit' : 'ok' },
                      ],
                    }
                  : undefined,
              missingConfigIds: !stats.activeProjectConfigured ? ['storage.provider', 'storage.bucket'] : [],
            }}
            act={storageAction}
            actAnchor="storage:act"
            actEvidence={
              storageAction
                ? {
                    kind: 'rule-trace',
                    why: storageAction.reason ?? storageAction.title,
                    threshold: failingBuckets > 0 ? `${failingBuckets} bucket${failingBuckets === 1 ? '' : 's'} failing` : undefined,
                  }
                : undefined
            }
            verify={{
              label: stats.lastHealthCheckAt ? 'Latest probe' : 'Awaiting probe',
              detail: stats.lastHealthCheckAt
                ? `${stats.healthyCount} healthy · ${stats.degradedCount} degraded · ${stats.failingCount} failing`
                : 'Run health check on Configure',
              to: '/health?fn=storage-probe',
              secondaryTo: '/audit?source=storage',
              secondaryLabel: 'Audit log',
              anchor: 'storage:verify',
              evidence:
                stats.configuredCount > 0
                  ? {
                      kind: 'metric-breakdown',
                      items: [
                        { label: 'Healthy', value: stats.healthyCount, tone: stats.healthyCount > 0 ? 'ok' : 'neutral' },
                        { label: 'Degraded', value: stats.degradedCount, tone: stats.degradedCount > 0 ? 'warn' : 'ok' },
                        { label: 'Failing', value: stats.failingCount, tone: stats.failingCount > 0 ? 'crit' : 'ok' },
                      ],
                    }
                  : undefined,
            }}
          />

          <PageActionBar scope="storage" action={storageAction} />

          <PageHelp
            title={copy?.help?.title ?? 'About BYO Storage'}
            whatIsIt={
              copy?.help?.whatIsIt ??
              "Per-project storage backend for screenshots and attachments. Defaults to the cluster's Supabase Storage."
            }
            useCases={
              copy?.help?.useCases ?? [
                'Pin screenshots to your existing AWS account for invoice consolidation',
                'Use Cloudflare R2 to dodge S3 egress fees on heavy report volumes',
                'Self-host with MinIO inside an air-gapped enterprise network',
              ]
            }
            howToUse={
              copy?.help?.howToUse ??
              'Configure tab saves provider + bucket. Health check runs a write probe and shows step-by-step debug output.'
            }
          />

          {usageTable}
          {activeCard ? (
            <div data-dav-anchor="storage:decide">{renderProjectCard(activeCard)}</div>
          ) : cards.length === 0 ? (
            <SetupNudge
              requires={['project_created']}
              emptyTitle="No projects yet"
              emptyDescription="Create a project first — every project gets its own storage backend."
            />
          ) : null}
        </>
      )}

      {activeTab === 'configure' && (
        <>
          <PageHelp
            title={copy?.help?.title ?? 'About BYO Storage'}
            whatIsIt={activeTabMeta.description}
            useCases={copy?.help?.useCases ?? []}
            howToUse={copy?.help?.howToUse ?? 'Save before running health check on a new override.'}
          />
          {cards.length === 0 ? (
            <SetupNudge
              requires={['project_created']}
              emptyTitle="No projects yet"
              emptyDescription="Create a project first — every project gets its own storage backend."
            />
          ) : (
            <div data-dav-anchor="storage:decide" className="space-y-3">
              {cards.map((card) => renderProjectCard(card))}
            </div>
          )}
        </>
      )}

      {activeTab === 'usage' && usageTable}
    </div>
  )
}
