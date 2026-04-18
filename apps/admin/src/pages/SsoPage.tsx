import { useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { PageHeader, PageHelp, Card, Badge, Btn, Input, SelectField, Loading, ErrorAlert, EmptyState } from '../components/ui'
import { useToast } from '../lib/toast'

interface SsoConfig {
  id: string
  provider_type: string
  provider_name: string
  metadata_url: string | null
  entity_id: string | null
  acs_url: string | null
  is_active: boolean
  sso_provider_id: string | null
  registration_status: 'pending' | 'registered' | 'failed' | 'disabled'
  registration_error: string | null
  registered_at: string | null
  domains: string[] | null
}

interface RegisterResult {
  id: string
  providerId?: string
  acsUrl?: string
  entityId?: string
  status: 'registered' | 'pending'
  hint?: string
}

const REGISTRATION_TONE: Record<SsoConfig['registration_status'], string> = {
  registered: 'bg-ok-muted text-ok',
  pending: 'bg-warn/10 text-warn',
  failed: 'bg-danger-subtle text-danger',
  disabled: 'bg-surface-overlay text-fg-muted',
}

export function SsoPage() {
  const { data, loading, error, reload } = usePageData<{ configs: SsoConfig[] }>('/v1/admin/sso')
  const configs = data?.configs ?? []
  const [form, setForm] = useState({ providerType: 'saml', providerName: '', metadataUrl: '', entityId: '', domains: '' })
  const [submitting, setSubmitting] = useState(false)
  const [lastRegister, setLastRegister] = useState<RegisterResult | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const toast = useToast()

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
    const domains = form.domains.split(',').map((s) => s.trim()).filter(Boolean)
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
        res.data.status === 'registered' ? 'Identity provider registered' : 'Identity provider saved',
        form.providerName,
      )
      setLastRegister(res.data)
      setForm({ providerType: 'saml', providerName: '', metadataUrl: '', entityId: '', domains: '' })
      reload()
    } else {
      toast.error('Failed to add provider', res.error?.message)
    }
  }

  const disconnectProvider = async (config: SsoConfig) => {
    if (!confirm(`Disconnect ${config.provider_name}? Existing sessions remain valid until expiry, but new logins will fail.`)) return
    setDisconnecting(config.id)
    const res = await apiFetch(`/v1/admin/sso/${config.id}`, { method: 'DELETE' })
    setDisconnecting(null)
    if (res.ok) {
      toast.success(`${config.provider_name} disconnected`)
      reload()
    } else {
      toast.error('Failed to disconnect', res.error?.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="SSO Configuration" />

      <PageHelp
        title="About SSO"
        whatIsIt="Single Sign-On lets your team log in via your corporate identity provider (Okta, Azure AD, Google Workspace, etc.) instead of email + password."
        useCases={[
          'Centrally enforce MFA, password policy, and offboarding',
          'Automatically provision new admins when they join your IdP group',
          'Pass an enterprise security review (SAML 2.0 or OIDC)',
        ]}
        howToUse="Add your IdP's metadata URL and entity ID below. Then in your IdP, configure the ACS URL and audience as shown in the docs. Test with a non-admin user first."
      />

      <Card className="p-3 space-y-3">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Add Identity Provider</h3>
        <div className="grid grid-cols-2 gap-2">
          <SelectField value={form.providerType} onChange={(e) => setForm({ ...form, providerType: e.currentTarget.value })}>
            <option value="saml">SAML 2.0</option>
            <option value="oidc">OpenID Connect</option>
          </SelectField>
          <Input placeholder="Provider name (e.g. Okta)" value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} />
          <Input
            placeholder={form.providerType === 'saml' ? 'Metadata URL (required)' : 'Metadata URL (optional)'}
            value={form.metadataUrl}
            onChange={(e) => setForm({ ...form, metadataUrl: e.target.value })}
          />
          <Input placeholder="Entity ID (optional, parsed from metadata)" value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} />
          <Input
            placeholder="Email domains (comma-separated, e.g. acme.com,acme.io)"
            value={form.domains}
            onChange={(e) => setForm({ ...form, domains: e.target.value })}
            className="col-span-2"
          />
        </div>
        <Btn onClick={addProvider} disabled={submitting}>{submitting ? 'Registering…' : 'Add Provider'}</Btn>
        <p className="text-2xs text-fg-faint">
          {form.providerType === 'saml'
            ? 'On submit, Mushi calls the Supabase Auth Admin API to register the SAML provider. We surface the resulting ACS URL + Entity ID below for you to paste into your IdP.'
            : 'OIDC is recorded but not yet auto-registered (Supabase enterprise tier required). Use SAML for self-service.'}
        </p>
      </Card>

      {lastRegister?.status === 'registered' && (
        <Card className="p-3 border border-ok/30 bg-ok-muted/20 space-y-2">
          <h3 className="text-xs font-medium text-ok uppercase tracking-wider">Provider registered — finish IdP setup</h3>
          <p className="text-2xs text-fg-secondary">
            Paste these values into your identity provider so it can post SAML responses back to Supabase Auth.
          </p>
          <div className="grid grid-cols-1 gap-1.5 text-2xs">
            {lastRegister.acsUrl && (
              <div>
                <div className="text-fg-faint">ACS URL (Reply URL)</div>
                <div className="font-mono text-fg break-all">{lastRegister.acsUrl}</div>
              </div>
            )}
            {lastRegister.entityId && (
              <div>
                <div className="text-fg-faint">Audience / Entity ID</div>
                <div className="font-mono text-fg break-all">{lastRegister.entityId}</div>
              </div>
            )}
            {lastRegister.providerId && (
              <div>
                <div className="text-fg-faint">Supabase provider id</div>
                <div className="font-mono text-fg break-all">{lastRegister.providerId}</div>
              </div>
            )}
          </div>
        </Card>
      )}

      {loading ? <Loading /> : error ? <ErrorAlert message={`Failed to load SSO configs: ${error}`} onRetry={reload} /> : configs.length === 0 ? (
        <EmptyState
          title="No identity providers configured"
          description="Add a provider above. Until at least one is registered, all admins continue to log in via email and password."
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
                      <div className="text-2xs text-danger mt-0.5 break-words max-w-xs" title={c.registration_error}>
                        {c.registration_error}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-fg-muted uppercase font-mono">{c.provider_type}</td>
                  <td className="py-1.5 px-3 text-fg-muted font-mono text-2xs">
                    {c.domains && c.domains.length > 0 ? c.domains.join(', ') : '—'}
                  </td>
                  <td className="py-1.5 px-3">
                    <Badge className={REGISTRATION_TONE[c.registration_status]}>
                      {c.registration_status}
                    </Badge>
                  </td>
                  <td className="py-1.5 px-3 text-fg-muted font-mono text-2xs break-all">
                    {c.sso_provider_id ?? '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {c.registration_status !== 'disabled' && (
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => disconnectProvider(c)}
                        disabled={disconnecting === c.id}
                      >
                        {disconnecting === c.id ? 'Disconnecting…' : 'Disconnect'}
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
