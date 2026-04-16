import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, Card, Input, Btn, Loading, ErrorAlert } from '../components/ui'

interface Integration {
  id: string
  integration_type: string
  is_active: boolean
  last_synced_at: string | null
}

const PROVIDERS = [
  { type: 'jira', label: 'Jira', fields: ['baseUrl', 'email', 'apiToken', 'projectKey'] },
  { type: 'linear', label: 'Linear', fields: ['apiKey', 'teamId'] },
  { type: 'github', label: 'GitHub Issues', fields: ['token', 'owner', 'repo'] },
  { type: 'pagerduty', label: 'PagerDuty', fields: ['routingKey'] },
]

export function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [configValues, setConfigValues] = useState<Record<string, string>>({})

  function loadIntegrations() {
    setLoading(true)
    setError(false)
    apiFetch<{ integrations: Integration[] }>('/v1/admin/integrations')
      .then((d) => {
        if (d.ok && d.data) setIntegrations(d.data.integrations)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadIntegrations() }, [])

  const saveIntegration = async () => {
    if (!selectedProvider) return
    await apiFetch('/v1/admin/integrations', { method: 'POST', body: JSON.stringify({ type: selectedProvider, config: configValues }) })
    setSelectedProvider('')
    setConfigValues({})
  }

  const provider = PROVIDERS.find((p) => p.type === selectedProvider)

  if (loading) return <Loading text="Loading integrations..." />
  if (error) return <ErrorAlert message="Failed to load integrations." onRetry={loadIntegrations} />

  return (
    <div className="space-y-4">
      <PageHeader title="Integrations" />

      <div className="grid grid-cols-4 gap-2">
        {PROVIDERS.map((p) => {
          const active = integrations.find((i) => i.integration_type === p.type)
          return (
            <Btn
              key={p.type}
              variant="ghost"
              onClick={() => setSelectedProvider(p.type)}
              className={`!p-3 !rounded-md !text-left !items-start !flex-col !h-auto ${
                active?.is_active ? '!border-ok/40 !bg-ok-muted/20' : ''
              }`}
            >
              <span className="text-sm font-medium text-fg">{p.label}</span>
              <span className="text-2xs text-fg-faint mt-0.5">{active?.is_active ? 'Connected' : 'Not configured'}</span>
            </Btn>
          )
        })}
      </div>

      {provider && (
        <Card className="p-3 space-y-3">
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Configure {provider.label}</h3>
          <div className="space-y-2">
            {provider.fields.map((field) => (
              <Input
                key={field}
                placeholder={field}
                value={configValues[field] ?? ''}
                onChange={(e) => setConfigValues({ ...configValues, [field]: e.target.value })}
                type={field.toLowerCase().includes('token') || field.toLowerCase().includes('key') ? 'password' : 'text'}
              />
            ))}
          </div>
          <Btn onClick={saveIntegration}>Save</Btn>
        </Card>
      )}
    </div>
  )
}
