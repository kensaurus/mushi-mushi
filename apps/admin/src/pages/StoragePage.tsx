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

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Card, Btn, Loading, ErrorAlert, EmptyState, Input, SelectField } from '../components/ui'
import { useToast } from '../lib/toast'

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
  const [settings, setSettings] = useState<StorageSetting[]>([])
  const [projects, setProjects] = useState<OwnedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Drafts only carry fields the user has touched. We merge them on top of the
  // existing setting (or the defaults for un-configured projects) at render.
  const [drafts, setDrafts] = useState<Record<string, Partial<StorageSetting>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const toast = useToast()

  const fetchAll = async () => {
    setLoading(true)
    setError(null)
    const [settingsRes, projectsRes] = await Promise.all([
      apiFetch<{ settings: StorageSetting[] }>('/v1/admin/storage'),
      apiFetch<{ projects: OwnedProject[] }>('/v1/admin/projects'),
    ])
    if (settingsRes.ok && settingsRes.data) setSettings(settingsRes.data.settings)
    else setError(settingsRes.error?.message ?? 'Failed to load storage settings.')
    if (projectsRes.ok && projectsRes.data) setProjects(projectsRes.data.projects ?? [])
    setLoading(false)
  }

  useEffect(() => { void fetchAll() }, [])

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
    await fetchAll()
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
    await fetchAll()
  }

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={error} onRetry={fetchAll} />

  return (
    <div className="space-y-3">
      <PageHeader title="Storage" />
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
        <EmptyState
          title="No projects yet"
          description="Create a project on the Projects page first — every project gets its own storage backend, defaulting to the cluster's Supabase Storage."
        />
      ) : null}

      {cards.map(({ setting: s, existing }) => {
        const m = merged(s)
        const dirty = Object.keys(draftFor(s.project_id)).length > 0
        const projectName = projects.find((p) => p.id === s.project_id)?.name ?? s.project_id
        return (
          <Card key={s.project_id} className="p-3">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-fg truncate">{projectName}</div>
                <code className="text-3xs opacity-70 font-mono break-all">{s.project_id}</code>
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
                value={m.bucket}
                onChange={(e) => updateDraft(s.project_id, { bucket: e.target.value })}
              />
              <Input
                label="Region"
                value={m.region ?? ''}
                placeholder={m.provider === 'r2' ? 'auto' : 'us-east-1'}
                onChange={(e) => updateDraft(s.project_id, { region: e.target.value || null as unknown as string })}
              />
              <Input
                label="Endpoint (S3-compatible only)"
                value={m.endpoint ?? ''}
                placeholder="https://s3.us-east-1.amazonaws.com"
                onChange={(e) => updateDraft(s.project_id, { endpoint: e.target.value || null as unknown as string })}
              />
              <Input
                label="Path prefix"
                value={m.path_prefix}
                placeholder="mushi-mushi/"
                onChange={(e) => updateDraft(s.project_id, { path_prefix: e.target.value })}
              />
              <Input
                label="Signed URL TTL (seconds)"
                type="number"
                value={String(m.signed_url_ttl_secs)}
                onChange={(e) => updateDraft(s.project_id, { signed_url_ttl_secs: parseInt(e.target.value, 10) || 3600 })}
              />
              <Input
                label="Access key Vault ref"
                value={m.access_key_vault_ref ?? ''}
                placeholder="mushi_s3_access_key_<project>"
                onChange={(e) => updateDraft(s.project_id, { access_key_vault_ref: e.target.value || null as unknown as string })}
              />
              <Input
                label="Secret key Vault ref"
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
                title={!existing ? 'Save the configuration first to enable health checks' : undefined}
              >
                {checkingId === s.project_id ? 'Checking…' : 'Health check'}
              </Btn>
              <Btn
                size="sm"
                onClick={() => save(s.project_id, !existing)}
                disabled={(existing && !dirty) || savingId === s.project_id || checkingId === s.project_id}
              >
                {savingId === s.project_id ? 'Saving…' : existing ? 'Save' : 'Save & enable'}
              </Btn>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
