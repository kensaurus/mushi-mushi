import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, Card, Badge, Btn, Input, SelectField, Loading, ErrorAlert } from '../components/ui'

interface SsoConfig {
  id: string
  provider_type: string
  provider_name: string
  metadata_url: string
  entity_id: string
  is_active: boolean
}

export function SsoPage() {
  const [configs, setConfigs] = useState<SsoConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [form, setForm] = useState({ providerType: 'saml', providerName: '', metadataUrl: '', entityId: '' })

  const fetchConfigs = () => {
    setLoading(true)
    setError(false)
    apiFetch<{ configs: SsoConfig[] }>('/v1/admin/sso')
      .then((d) => {
        if (d.ok && d.data) setConfigs(d.data.configs)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchConfigs() }, [])

  const addProvider = async () => {
    await apiFetch('/v1/admin/sso', { method: 'POST', body: JSON.stringify(form) })
    setForm({ providerType: 'saml', providerName: '', metadataUrl: '', entityId: '' })
    fetchConfigs()
  }

  return (
    <div className="space-y-4">
      <PageHeader title="SSO Configuration" />

      <Card className="p-3 space-y-3">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Add Identity Provider</h3>
        <div className="grid grid-cols-2 gap-2">
          <SelectField value={form.providerType} onChange={(e) => setForm({ ...form, providerType: e.currentTarget.value })}>
            <option value="saml">SAML 2.0</option>
            <option value="oidc">OpenID Connect</option>
          </SelectField>
          <Input placeholder="Provider name (e.g. Okta)" value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} />
          <Input placeholder="Metadata URL" value={form.metadataUrl} onChange={(e) => setForm({ ...form, metadataUrl: e.target.value })} />
          <Input placeholder="Entity ID" value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} />
        </div>
        <Btn onClick={addProvider}>Add Provider</Btn>
      </Card>

      {loading ? <Loading /> : error ? <ErrorAlert message="Failed to load SSO configs." onRetry={fetchConfigs} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-fg-muted border-b border-edge">
                <th className="text-left py-1.5 px-3 font-medium">Provider</th>
                <th className="text-left py-1.5 px-3 font-medium">Type</th>
                <th className="text-left py-1.5 px-3 font-medium">Entity ID</th>
                <th className="text-left py-1.5 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id} className="border-b border-edge-subtle">
                  <td className="py-1.5 px-3 text-fg-secondary">{c.provider_name}</td>
                  <td className="py-1.5 px-3 text-fg-muted uppercase font-mono">{c.provider_type}</td>
                  <td className="py-1.5 px-3 text-fg-muted font-mono">{c.entity_id}</td>
                  <td className="py-1.5 px-3">
                    <Badge className={c.is_active ? 'bg-ok-muted text-ok' : 'bg-surface-overlay text-fg-muted'}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </Badge>
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
