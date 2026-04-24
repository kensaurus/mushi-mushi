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
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { PageHeader, PageHelp, Card, Btn, ErrorAlert, Input, SelectField } from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SetupNudge } from '../components/SetupNudge'
import { useToast } from '../lib/toast'
import { PageActionBar } from '../components/PageActionBar'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'

type Provider = 'supabase' | 's3' | 'r2' | 'gcs' | 'minio'

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
  }
}

export function StoragePage() {
  const settingsQuery = usePageData<{ settings: StorageSetting[] }>('/v1/admin/storage')
  const projectsQuery = usePageData<{ projects: OwnedProject[] }>('/v1/admin/projects')
  const usageQuery = usePageData<{ usage: StorageUsageRow[] }>('/v1/admin/storage/usage')
  const settings = settingsQuery.data?.settings ?? []
  const projects = projectsQuery.data?.projects ?? []
  const usageRows = usageQuery.data?.usage ?? []
  const loading = settingsQuery.loading || projectsQuery.loading
  const error = settingsQuery.error ?? projectsQuery.error
  const reloadAll = useCallback(() => {
    settingsQuery.reload()
    projectsQuery.reload()
    usageQuery.reload()
  }, [settingsQuery, projectsQuery, usageQuery])

  const usageByProject = useMemo(
    () => new Map(usageRows.map((u) => [u.project_id, u])),
    [usageRows],
  )

  // Drafts only carry fields the user has touched. We merge them on top of the
  // existing setting (or the defaults for un-configured projects) at render.
  const [drafts, setDrafts] = useState<Record<string, Partial<StorageSetting>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
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
    // First save needs to send the full default row so the upsert creates a
    // valid record even if the user only touched one field.
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
    const res = await apiFetch<{ healthy?: boolean; error?: string }>(
      `/v1/admin/storage/${projectId}/health`,
      { method: 'POST' },
    )
    setCheckingId(null)
    if (res.ok) {
      toast.success('Health check complete', 'Status updated below.')
    } else {
      toast.error('Health check failed', res.error?.message)
    }
    reloadAll()
  }

  const failingBuckets = settings.filter((s) => s.health_status === 'failing').length
  const degradedBuckets = settings.filter((s) => s.health_status === 'degraded').length
  const healthyBuckets = settings.filter((s) => s.health_status === 'healthy').length
  const storageAction = useNextBestAction({
    scope: 'storage',
    approachingQuotaPct: null,
    failedUploadsLastHour: failingBuckets,
  })
  const storageSeverity: 'crit' | 'warn' | 'ok' | 'neutral' =
    settings.length === 0
      ? 'neutral'
      : failingBuckets > 0
        ? 'crit'
        : degradedBuckets > 0
          ? 'warn'
          : 'ok'

  if (loading) return <TableSkeleton rows={5} columns={4} showFilters label="Loading storage" />
  if (error) return <ErrorAlert message={error} onRetry={reloadAll} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Storage"
        description="Per-project bucket usage and retention policy for screenshots, logs, and uploaded artefacts."
      />

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
                  : 'No buckets configured',
          metric:
            settings.length === 0
              ? '—'
              : `${healthyBuckets}/${settings.length} healthy`,
          summary:
            storageSeverity === 'crit'
              ? 'Failing buckets drop screenshot + log uploads silently — rotate credentials or retry.'
              : storageSeverity === 'warn'
                ? 'Degraded buckets still accept uploads but have recent errors — probe before users hit them.'
                : storageSeverity === 'ok'
                  ? `${settings.length} bucket${settings.length === 1 ? '' : 's'} configured and passing probes.`
                  : 'Connect a bucket to retain screenshots + logs beyond the default rolling window.',
          severity: storageSeverity,
        }}
        act={storageAction}
        verify={{
          label: 'Latest probe snapshot',
          detail:
            settings.length === 0
              ? 'No probes run yet'
              : `${healthyBuckets} healthy · ${degradedBuckets} degraded · ${failingBuckets} failing`,
          to: '/health?fn=storage-probe',
          secondaryTo: '/audit?source=storage',
          secondaryLabel: 'Audit log',
        }}
      />

      <PageActionBar scope="storage" action={storageAction} />

      <PageHelp
        title="About BYO Storage"
        whatIsIt="Per-project storage backend for screenshots, intelligence-report PDFs, and fix attachments. Defaults to the cluster's Supabase Storage; switch to AWS S3, Cloudflare R2, Google Cloud Storage, or MinIO to keep customer data inside your existing infrastructure."
        useCases={[
          'Pin screenshots to your existing AWS account for invoice consolidation',
          'Use Cloudflare R2 to dodge S3 egress fees on heavy report volumes',
          'Self-host with MinIO inside an air-gapped enterprise network',
        ]}
        howToUse="Pick a provider, enter your bucket and region, then store credentials in Supabase Vault and reference them by name. Click Health check to verify the backend before flipping new uploads to it."
      />

      {cards.length === 0 ? (
        <SetupNudge
          requires={['project_created']}
          emptyTitle="No projects yet"
          emptyDescription="Create a project first — every project gets its own storage backend, defaulting to the cluster's Supabase Storage."
        />
      ) : null}

      {cards.length > 0 && usageRows.length > 0 && (
        <Card className="p-3">
          <div className="text-xs font-medium uppercase tracking-wider mb-2">Per-project usage</div>
          <p className="text-2xs text-fg-muted mb-2">
            Counts uploaded screenshots and the most recent write timestamp. Helpful to spot a project
            burning through storage or to confirm a quiet project before changing its provider.
          </p>
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
                  return (
                    <tr key={p.id} className="border-b border-edge-subtle/40">
                      <td className="py-1.5">{p.name}</td>
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
        </Card>
      )}

      {cards.map(({ setting: s, existing }) => {
        const m = merged(s)
        const dirty = Object.keys(draftFor(s.project_id)).length > 0
        const projectName = projects.find((p) => p.id === s.project_id)?.name ?? s.project_id
        return (
          <Card key={s.project_id} className="p-3">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-fg truncate">{projectName}</div>
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
            </div>

            {existing && s.last_health_error ? (
              <p className="mt-2 text-2xs text-danger">Last error: {s.last_health_error}</p>
            ) : null}

            <div className="mt-3 flex items-center justify-end gap-2">
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => checkHealth(s.project_id)}
                disabled={!existing || savingId === s.project_id || checkingId === s.project_id}
                loading={checkingId === s.project_id}
                title={!existing ? 'Save the configuration first to enable health checks' : undefined}
              >
                Health check
              </Btn>
              <Btn
                size="sm"
                onClick={() => save(s.project_id, !existing)}
                disabled={(existing && !dirty) || savingId === s.project_id || checkingId === s.project_id}
                loading={savingId === s.project_id}
              >
                {existing ? 'Save' : 'Save & enable'}
              </Btn>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
