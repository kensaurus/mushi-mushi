import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Card, Btn, Loading, ErrorAlert, EmptyState, Input, SelectField } from '../components/ui'

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

const HEALTH_CHIP: Record<StorageSetting['health_status'], string> = {
  unknown: 'bg-fg-muted/10 text-fg-muted',
  healthy: 'bg-emerald-500/10 text-emerald-500',
  degraded: 'bg-amber-500/10 text-amber-500',
  failing: 'bg-red-500/10 text-red-500',
}

export function StoragePage() {
  const [settings, setSettings] = useState<StorageSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Partial<StorageSetting>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)

  const fetchAll = async () => {
    setLoading(true); setError(false)
    const res = await apiFetch<{ settings: StorageSetting[] }>('/v1/admin/storage')
    if (res.ok && res.data) setSettings(res.data.settings)
    else setError(true)
    setLoading(false)
  }

  useEffect(() => { void fetchAll() }, [])

  const draftFor = (s: StorageSetting): Partial<StorageSetting> => drafts[s.project_id] ?? {}
  const merged = (s: StorageSetting): StorageSetting => ({ ...s, ...draftFor(s) })

  const updateDraft = (projectId: string, patch: Partial<StorageSetting>) => {
    setDrafts((prev) => ({ ...prev, [projectId]: { ...(prev[projectId] ?? {}), ...patch } }))
  }

  const save = async (projectId: string) => {
    const patch = drafts[projectId]
    if (!patch) return
    setSavingId(projectId)
    const res = await apiFetch(`/v1/admin/storage/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
    setSavingId(null)
    if (!res.ok) {
      alert(res.error?.message ?? 'Save failed')
      return
    }
    setDrafts((prev) => ({ ...prev, [projectId]: {} }))
    await fetchAll()
  }

  const checkHealth = async (projectId: string) => {
    setCheckingId(projectId)
    await apiFetch(`/v1/admin/storage/${projectId}/health`, { method: 'POST' })
    setCheckingId(null)
    await fetchAll()
  }

  if (loading) return <Loading />
  if (error) return <ErrorAlert message="Failed to load storage settings." onRetry={fetchAll} />

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

      {settings.length === 0 ? (
        <EmptyState
          title="No storage overrides"
          description="All projects currently use the cluster default Supabase bucket. Click Save below to create your first override."
        />
      ) : null}

      {settings.map((s) => {
        const m = merged(s)
        const dirty = Object.keys(draftFor(s)).length > 0
        return (
          <Card key={s.project_id} className="p-3">
            <div className="flex items-center justify-between mb-3">
              <code className="text-3xs opacity-70">{s.project_id}</code>
              <div className="flex items-center gap-2">
                <span className={`inline-flex rounded px-2 py-0.5 text-3xs ${HEALTH_CHIP[s.health_status]}`}>
                  {s.health_status.toUpperCase()}
                </span>
                {s.last_health_check_at ? (
                  <span className="text-3xs opacity-60">
                    Checked {new Date(s.last_health_check_at).toLocaleString()}
                  </span>
                ) : null}
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
                onChange={(e) => updateDraft(s.project_id, { region: e.target.value })}
              />
              <Input
                label="Endpoint (S3-compatible only)"
                value={m.endpoint ?? ''}
                placeholder="https://s3.us-east-1.amazonaws.com"
                onChange={(e) => updateDraft(s.project_id, { endpoint: e.target.value })}
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
                onChange={(e) => updateDraft(s.project_id, { access_key_vault_ref: e.target.value })}
              />
              <Input
                label="Secret key Vault ref"
                value={m.secret_key_vault_ref ?? ''}
                placeholder="mushi_s3_secret_key_<project>"
                onChange={(e) => updateDraft(s.project_id, { secret_key_vault_ref: e.target.value })}
              />
              {m.provider === 'gcs' ? (
                <Input
                  label="GCS service-account Vault ref"
                  value={m.service_account_vault_ref ?? ''}
                  placeholder="mushi_gcs_sa_<project>"
                  onChange={(e) => updateDraft(s.project_id, { service_account_vault_ref: e.target.value })}
                />
              ) : null}
              <Input
                label="KMS Key ID (optional)"
                value={m.kms_key_id ?? ''}
                onChange={(e) => updateDraft(s.project_id, { kms_key_id: e.target.value })}
              />
            </div>

            {s.last_health_error ? (
              <p className="mt-2 text-3xs text-red-400">Last error: {s.last_health_error}</p>
            ) : null}

            <div className="mt-3 flex items-center justify-end gap-2">
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => checkHealth(s.project_id)}
                disabled={savingId === s.project_id || checkingId === s.project_id}
              >
                {checkingId === s.project_id ? 'Checking…' : 'Health check'}
              </Btn>
              <Btn
                size="sm"
                onClick={() => save(s.project_id)}
                disabled={!dirty || savingId === s.project_id || checkingId === s.project_id}
              >
                {savingId === s.project_id ? 'Saving…' : 'Save'}
              </Btn>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
