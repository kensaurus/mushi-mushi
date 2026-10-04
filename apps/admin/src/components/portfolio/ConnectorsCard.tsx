/**
 * ConnectorsCard — the sources a team has connected (Plan 019 §2b, ADR 0017).
 * Every connector is optional and read-only by default. Credentials go to
 * Vault and are never shown again; "blocked" means an outside party refuses
 * (for example an App Store agreement nobody accepted), not a broken key.
 *
 * Data: GET    /v1/admin/orgs/:orgId/connectors
 *       POST   /v1/admin/orgs/:orgId/connectors
 *       POST   /v1/admin/orgs/:orgId/connectors/:id/probe
 *       DELETE /v1/admin/orgs/:orgId/connectors/:id
 */

import { useState } from 'react'
import { Badge, Btn, Callout, DisclosurePanel, ErrorAlert, Input, Loading, Section, SelectField, Textarea, type BadgeTone } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { ActionsCard } from './ActionsCard'
import { BrandIcon } from '../ui/BrandIcon'
import { apiFetchMutate } from '../../lib/supabase'

interface Instance {
  id: string
  kind: string
  display_name: string
  status: 'connected' | 'not_connected' | 'blocked' | 'error' | 'unknown'
  status_reason: string | null
  granted_scopes: string[]
  enabled_capabilities: string[]
  last_probe_at: string | null
  bindings: Array<{ projectId: string; externalId: string; role: string }>
}

/** The logo to show: the provider for an AI-usage connector, else the connector kind. */
function connectorBrand(i: Pick<Instance, 'kind' | 'display_name'>): string {
  if (i.kind !== 'llm_usage') return i.kind
  if (/anthropic|claude/i.test(i.display_name)) return 'anthropic'
  if (/openai/i.test(i.display_name)) return 'openai'
  return i.kind
}

interface Available {
  kind: string
  title: string
  credentialNote: string
  legacyBacked: boolean
  capabilities: string[]
  actions: string[]
}

interface ConnectorsResponse {
  available: Available[]
  planned: string[]
  instances: Instance[]
  legacy: Array<{ kind: string; project_id: string; ok: boolean; error: string | null; observed_at: string }>
}

const STATUS: Record<Instance['status'], { label: string; tone: BadgeTone }> = {
  connected: { label: 'Connected', tone: 'okSubtle' },
  not_connected: { label: 'Not connected', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'warnSubtle' },
  error: { label: 'Error', tone: 'dangerSubtle' },
  unknown: { label: 'Not checked', tone: 'neutral' },
}

/** What each addable kind needs in its config and binding, in plain words. */
const FORM: Record<string, { configKey?: string; configLabel?: string; configOptions?: string[]; bindingLabel: string; credentialLabel: string }> = {
  llm_usage: { configKey: 'provider', configLabel: 'Provider', configOptions: ['openai', 'anthropic'], bindingLabel: 'OpenAI project id or Anthropic workspace id', credentialLabel: 'Admin key (read the cost report)' },
  http: { configKey: 'endpoint', configLabel: 'Your https endpoint', bindingLabel: 'Id your endpoint uses for this app', credentialLabel: 'Signing secret (shared with your endpoint)' },
  app_store_connect: { bindingLabel: 'App Store app id (numbers)', credentialLabel: 'API key JSON: {"keyId","issuerId","privateKey"}' },
  play_console: { configKey: 'package', configLabel: 'Android package', bindingLabel: 'Android package name', credentialLabel: 'Service account key (JSON)' },
  revenuecat: { bindingLabel: 'RevenueCat project id', credentialLabel: 'v2 secret key (read-only)' },
}

export function ConnectorsCard({ orgId, projects }: { orgId: string; projects: Array<{ projectId: string; name: string }> }) {
  const path = `/v1/admin/orgs/${orgId}/connectors`
  const { data, loading, error, reload } = usePageData<ConnectorsResponse>(path)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const [kind, setKind] = useState('llm_usage')
  const [name, setName] = useState('')
  const [configValue, setConfigValue] = useState('')
  const [credential, setCredential] = useState('')
  const [bindProject, setBindProject] = useState('')
  const [externalId, setExternalId] = useState('')
  const [writeKey, setWriteKey] = useState<Record<string, string>>({})
  const nameOf = (id: string) => projects.find((p) => p.projectId === id)?.name ?? id.slice(0, 8)
  const form = FORM[kind]

  const act = async (fn: () => Promise<{ ok: boolean; error?: { message?: string } | null }>, okText: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fn()
      setNotice(res.ok ? { tone: 'info', text: okText } : { tone: 'danger', text: res.error?.message ?? 'That did not work.' })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const create = () => act(async () => {
    const res = await apiFetchMutate<{ probe: { status: string; reason?: string } }>(path, {
      method: 'POST',
      body: JSON.stringify({
        kind,
        displayName: name || data?.available.find((a) => a.kind === kind)?.title || kind,
        config: form?.configKey && configValue ? { [form.configKey]: configValue } : {},
        ...(credential ? { readCredential: credential } : {}),
        bindings: bindProject && externalId ? [{ projectId: bindProject, externalId }] : [],
      }),
    })
    if (res.ok) {
      setCredential('')
      setName('')
      setExternalId('')
    }
    return res
  }, 'Saved. The credential went to Vault and will not be shown again.')

  return (
    <Section title="Connected sources">
      <p className="mb-3 text-xs text-fg-muted">Optional. Each one lets Mushi read one more thing it checks. Read-only unless you turn on more, and any release action still needs your approval each time.</p>
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading connectors…" />}
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {data && (
        <div className="flex flex-col gap-3">
          {data.instances.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing connected beyond each app's own GitHub, Supabase and Sentry settings.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-edge-subtle">
              {data.instances.map((i) => {
                const st = STATUS[i.status] ?? STATUS.unknown
                return (
                  <li key={i.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-fg">
                        <BrandIcon brand={connectorBrand(i)} size={16} decorative />
                        {i.display_name} <Badge tone={st.tone}>{st.label}</Badge>
                      </p>
                      {i.status_reason && <p className="text-xs text-fg-muted">{i.status_reason}</p>}
                      {i.bindings.length > 0 && <p className="text-2xs text-fg-faint">{i.bindings.map((b) => `${nameOf(b.projectId)} → ${b.externalId}`).join(' · ')}</p>}
                    </div>
                    {(data.available.find((a) => a.kind === i.kind)?.actions.length ?? 0) > 0 && (
                      <div className="w-full sm:w-auto">
                        <DisclosurePanel title={i.enabled_capabilities.includes('act') ? 'Release actions: on' : 'Release actions: off'}>
                          <div className="flex flex-col gap-2 p-3">
                            <p className="text-2xs text-fg-muted">Releases (rollout %, promote a track) need a separate write key, and each one still needs approval below.</p>
                            <Textarea label="Write key (JSON)" rows={2} value={writeKey[i.id] ?? ''} onChange={(e) => setWriteKey({ ...writeKey, [i.id]: e.target.value })} spellCheck={false} />
                            <div className="flex gap-2">
                              <Btn size="sm" disabled={busy || !(writeKey[i.id] ?? '').trim()} onClick={() => act(() => apiFetchMutate(`${path}/${i.id}`, { method: 'PATCH', body: JSON.stringify({ writeCredential: writeKey[i.id], enabledCapabilities: [...new Set([...i.enabled_capabilities, 'act'])] }) }), 'Release actions are on. Each one still needs approval.')}>Turn on</Btn>
                              {i.enabled_capabilities.includes('act') && <Btn size="sm" variant="ghost" disabled={busy} onClick={() => act(() => apiFetchMutate(`${path}/${i.id}`, { method: 'PATCH', body: JSON.stringify({ writeCredential: null }) }), 'Release actions are off and the write key is deleted.')}>Turn off</Btn>}
                            </div>
                          </div>
                        </DisclosurePanel>
                      </div>
                    )}
                    <div className="flex shrink-0 gap-2">
                      <Btn size="sm" variant="ghost" disabled={busy} onClick={() => act(() => apiFetchMutate(`${path}/${i.id}/probe`, { method: 'POST', body: '{}' }), 'Checked again.')}>Check</Btn>
                      <Btn size="sm" variant="ghost" disabled={busy} onClick={() => act(() => apiFetchMutate(`${path}/${i.id}`, { method: 'DELETE' }), 'Removed, with its stored credential.')}>Remove</Btn>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <ActionsCard
            orgId={orgId}
            connectors={data.instances
              .filter((i) => i.enabled_capabilities.includes('act'))
              .map((i) => ({ id: i.id, name: i.display_name, actions: data.available.find((a) => a.kind === i.kind)?.actions ?? [] }))}
          />
          <DisclosurePanel title="Add a source">
            <div className="flex flex-col gap-2 p-3">
              <SelectField label="Kind" value={kind} onChange={(e) => { setKind(e.target.value); setConfigValue('') }}>
                {data.available.filter((a) => !a.legacyBacked).map((a) => <option key={a.kind} value={a.kind}>{a.title}</option>)}
              </SelectField>
              <p className="text-2xs text-fg-muted">{data.available.find((a) => a.kind === kind)?.credentialNote}</p>
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown in this list" />
              {form?.configKey && (form.configOptions ? (
                <SelectField label={form.configLabel} value={configValue} onChange={(e) => setConfigValue(e.target.value)}>
                  <option value="">Choose…</option>
                  {form.configOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </SelectField>
              ) : (
                <Input label={form.configLabel} value={configValue} onChange={(e) => setConfigValue(e.target.value)} />
              ))}
              <Textarea label={form?.credentialLabel ?? 'Credential'} value={credential} onChange={(e) => setCredential(e.target.value)} rows={3} autoComplete="off" spellCheck={false} />
              <div className="grid gap-2 sm:grid-cols-2">
                <SelectField label="For which app" value={bindProject} onChange={(e) => setBindProject(e.target.value)}>
                  <option value="">Not bound yet</option>
                  {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
                </SelectField>
                <Input label={form?.bindingLabel ?? 'External id'} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
              </div>
              <div>
                <Btn size="sm" onClick={create} loading={busy} disabled={busy}>Connect</Btn>
              </div>
              {data.planned.length > 0 && <p className="text-2xs text-fg-faint">Planned, not built yet: {data.planned.join(', ')}.</p>}
            </div>
          </DisclosurePanel>
        </div>
      )}
    </Section>
  )
}
