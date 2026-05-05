import { useState } from 'react'
import { Btn, Card, Badge, ErrorAlert } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'

/**
 * Crawler & synthetic-monitor settings card.
 *
 * Surfaces the project_settings row that drives `inventory-crawler` and
 * `synthetic-monitor`. Lets the user:
 *   - point the crawler at a different origin (preview URL, localhost, etc.)
 *   - configure auth so the crawler can fetch behind login (cookie / bearer)
 *   - enable/disable the 15-min synthetic probe
 *
 * The auth-token field is **write-only**: the server never returns the
 * cleartext value once stored — only the discriminator (`type`) and any
 * non-sensitive shape (cookie name, scripted login_path, etc.). This lets us
 * tell the user "yes, a bearer token is stored" without exposing it again.
 */
interface SettingsPayload {
  crawler_base_url: string | null
  crawler_auth: {
    type: string
    config: {
      name?: string | null
      domain?: string | null
      login_path?: string | null
      has_value?: boolean
      has_token?: boolean
    }
  } | null
  synthetic_monitor_enabled: boolean
  synthetic_monitor_target_url: string | null
  synthetic_monitor_cadence_minutes: number
}

type AuthType = 'none' | 'cookie' | 'bearer'

interface Props {
  projectId: string
}

export function CrawlerSettingsCard({ projectId }: Props) {
  const toast = useToast()
  const path = `/v1/admin/inventory/${projectId}/settings`
  const q = usePageData<SettingsPayload>(path, { deps: [projectId] })

  const [editing, setEditing] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [authType, setAuthType] = useState<AuthType>('none')
  const [cookieName, setCookieName] = useState('')
  const [cookieValue, setCookieValue] = useState('')
  const [cookieDomain, setCookieDomain] = useState('')
  const [bearerToken, setBearerToken] = useState('')
  const [synthEnabled, setSynthEnabled] = useState(false)
  const [synthTarget, setSynthTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const data = q.data

  const startEdit = () => {
    setBaseUrl(data?.crawler_base_url ?? '')
    const t = data?.crawler_auth?.type
    setAuthType(t === 'cookie' || t === 'bearer' ? t : 'none')
    setCookieName(data?.crawler_auth?.config?.name ?? '')
    setCookieDomain(data?.crawler_auth?.config?.domain ?? '')
    setCookieValue('')
    setBearerToken('')
    setSynthEnabled(data?.synthetic_monitor_enabled ?? false)
    setSynthTarget(data?.synthetic_monitor_target_url ?? '')
    setErr(null)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setErr(null)
    try {
      const patch: Record<string, unknown> = {
        crawler_base_url: baseUrl.trim() || null,
        synthetic_monitor_enabled: synthEnabled,
        synthetic_monitor_target_url: synthTarget.trim() || null,
      }
      if (authType === 'none') {
        patch.crawler_auth_config = null
      } else if (authType === 'cookie') {
        if (!cookieName.trim()) {
          setErr('Cookie name is required')
          setSaving(false)
          return
        }
        if (!cookieValue.trim()) {
          setErr('Cookie value is required (paste from browser DevTools → Application → Cookies)')
          setSaving(false)
          return
        }
        patch.crawler_auth_config = {
          type: 'cookie',
          config: {
            name: cookieName.trim(),
            value: cookieValue.trim(),
            ...(cookieDomain.trim() ? { domain: cookieDomain.trim() } : {}),
          },
        }
      } else if (authType === 'bearer') {
        if (!bearerToken.trim()) {
          setErr('Bearer token is required')
          setSaving(false)
          return
        }
        patch.crawler_auth_config = {
          type: 'bearer',
          config: { token: bearerToken.trim() },
        }
      }
      const res = await apiFetch(path, { method: 'PATCH', body: JSON.stringify(patch) })
      if (res.ok) {
        toast.success('Crawler settings saved', 'Run crawler from the action bar to pick up the change.')
        setEditing(false)
        q.reload()
      } else {
        setErr(res.error?.message ?? 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  if (q.loading && !data) {
    return (
      <Card className="p-4">
        <p className="text-2xs text-fg-muted">Loading crawler settings…</p>
      </Card>
    )
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-fg">Crawler & probes</h3>
          <p className="text-2xs text-fg-muted mt-0.5 max-w-prose">
            Where the inventory crawler should fetch each <code className="font-mono">page.path</code> from,
            and how it should authenticate. The crawler runs on demand (Run crawler) and the synthetic
            monitor runs every 15 minutes when enabled.
          </p>
        </div>
        {!editing && (
          <Btn type="button" size="sm" variant="ghost" onClick={startEdit}>
            {data?.crawler_base_url ? 'Edit' : 'Configure'}
          </Btn>
        )}
      </div>

      {!editing && (
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          <SettingRow label="Base URL">
            {data?.crawler_base_url ? (
              <code className="font-mono text-fg">{data.crawler_base_url}</code>
            ) : (
              <span className="text-fg-faint">— falls back to inventory.app.preview_url / staging_url / base_url</span>
            )}
          </SettingRow>
          <SettingRow label="Auth">
            {data?.crawler_auth ? (
              <span className="flex items-center gap-2">
                <Badge className="bg-info-muted text-info border border-info/25 font-mono">
                  {data.crawler_auth.type}
                </Badge>
                {data.crawler_auth.type === 'cookie' && data.crawler_auth.config.name && (
                  <span className="text-fg-muted font-mono text-2xs">
                    {data.crawler_auth.config.name}
                    {data.crawler_auth.config.domain ? ` @ ${data.crawler_auth.config.domain}` : ''}
                  </span>
                )}
                {(data.crawler_auth.config.has_token || data.crawler_auth.config.has_value) && (
                  <span className="text-fg-faint text-2xs">(secret stored)</span>
                )}
              </span>
            ) : (
              <span className="text-fg-faint">none — only public pages will succeed</span>
            )}
          </SettingRow>
          <SettingRow label="Synthetic monitor">
            {data?.synthetic_monitor_enabled ? (
              <Badge className="bg-ok-muted text-ok border border-ok/25 font-mono">
                enabled · every {data.synthetic_monitor_cadence_minutes} min
              </Badge>
            ) : (
              <Badge className="bg-surface-overlay text-fg-muted border border-edge-subtle font-mono">
                disabled
              </Badge>
            )}
          </SettingRow>
          <SettingRow label="Synthetic target">
            {data?.synthetic_monitor_target_url ? (
              <code className="font-mono text-fg-secondary">{data.synthetic_monitor_target_url}</code>
            ) : (
              <span className="text-fg-faint">— same as crawler base URL</span>
            )}
          </SettingRow>
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          <Field label="Crawler base URL" hint="Origin to prepend to each page.path. e.g. https://staging.example.com or http://localhost:3000.">
            <input
              type="url"
              className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1 text-xs font-mono"
              placeholder="https://your-app.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </Field>

          <Field label="Auth" hint="Cookie auth fetches one URL with a Cookie header; bearer adds Authorization: Bearer <token>. Both store the secret in jsonb on project_settings.">
            <div className="flex gap-1.5">
              {(['none', 'cookie', 'bearer'] as AuthType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAuthType(t)}
                  className={`text-2xs font-mono px-2 py-1 rounded-sm border ${
                    authType === t
                      ? 'bg-brand/15 text-brand border-brand/40'
                      : 'bg-surface-overlay text-fg-muted border-edge-subtle hover:bg-surface-overlay/80'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>

          {authType === 'cookie' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Cookie name">
                <input
                  type="text"
                  className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1 text-xs font-mono"
                  placeholder="sb-access-token"
                  value={cookieName}
                  onChange={(e) => setCookieName(e.target.value)}
                />
              </Field>
              <Field label="Domain (optional)">
                <input
                  type="text"
                  className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1 text-xs font-mono"
                  placeholder=".example.com"
                  value={cookieDomain}
                  onChange={(e) => setCookieDomain(e.target.value)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Cookie value"
                  hint="Paste from DevTools → Application → Cookies. Stored in plaintext on project_settings.crawler_auth_config — use a dedicated test account."
                >
                  <textarea
                    className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1 text-xs font-mono"
                    rows={2}
                    placeholder="eyJhbGciOi…"
                    value={cookieValue}
                    onChange={(e) => setCookieValue(e.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}

          {authType === 'bearer' && (
            <Field
              label="Bearer token"
              hint="Pasted as-is into Authorization: Bearer <token>. Stored in plaintext on project_settings."
            >
              <textarea
                className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1 text-xs font-mono"
                rows={2}
                placeholder="eyJhbGciOi…"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
              />
            </Field>
          )}

          <div className="border-t border-edge-subtle pt-3 space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={synthEnabled}
                onChange={(e) => setSynthEnabled(e.target.checked)}
              />
              <span>Enable synthetic monitor (probes each Action every 15 min)</span>
            </label>
            {synthEnabled && (
              <Field label="Synthetic target URL (optional override)">
                <input
                  type="url"
                  className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1 text-xs font-mono"
                  placeholder="https://prod.example.com"
                  value={synthTarget}
                  onChange={(e) => setSynthTarget(e.target.value)}
                />
              </Field>
            )}
          </div>

          {err && <ErrorAlert message={err} />}

          <div className="flex gap-2">
            <Btn type="button" size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Btn>
            <Btn type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Btn>
          </div>
        </div>
      )}
    </Card>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-2xs uppercase text-fg-faint w-32 shrink-0 pt-0.5">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-2xs font-medium text-fg-muted uppercase tracking-wider block">{label}</label>
      {children}
      {hint && <p className="text-2xs text-fg-faint leading-relaxed">{hint}</p>}
    </div>
  )
}
