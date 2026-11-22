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
 *
 * Sweep 2026-11-18: one mark per source (its state pill; the bound apps are icons with no
 * second ✓), and two or more sources of one kind sit under one heading ("Google Play · 4").
 */

import { useState } from 'react'
import { Btn, Callout, DisclosurePanel, Input, Section, SelectField, Textarea } from '../ui'
import { TimedLoading } from './TimedLoading'
import { MoreActionsMenu } from '../signal/MoreActionsMenu'
import { StatusMark, StatusPill, type RunStatus } from '../signal/StatusMark'
import { AppIconChips, type IconFor } from './AppIconChips'
import { usePageData } from '../../lib/usePageData'
import { ActionsCard } from './ActionsCard'
import { BrandIcon } from '../ui/BrandIcon'
import { apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { ORG_ADMIN_ONLY_HINT, useOrgCanManage } from '../../lib/useOrgCanManage'
import { ConfirmDialog } from '../ConfirmDialog'
import { PageLoadError } from '../PageLoadError'

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

const STATUS: Record<Instance['status'], { label: string; status: RunStatus }> = {
  connected: { label: 'Connected', status: 'passed' },
  not_connected: { label: 'Not connected', status: 'idle' },
  blocked: { label: 'Blocked', status: 'slow' },
  error: { label: 'Error', status: 'failed' },
  unknown: { label: 'Not checked', status: 'idle' },
}

/**
 * Sources in list order, two or more of one kind under one heading; a kind with one source
 * stays a plain row. Inside a group the name drops the repeated "Google Play · " prefix.
 * @internal Exported for ConnectorsCard.test.tsx.
 */
export function groupConnectors<T extends Pick<Instance, 'kind' | 'display_name'>>(instances: readonly T[], titleOf: (kind: string) => string): Array<{ kind: string; title: string; items: Array<{ instance: T; name: string }> }> {
  const byKind = new Map<string, T[]>()
  for (const i of instances) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i])
  return [...byKind.entries()].map(([kind, items]) => {
    const title = titleOf(kind)
    const strip = (n: string) => {
      const rest = n.startsWith(`${title} · `) ? n.slice(title.length + 3).trim() : n
      return rest || n
    }
    return { kind, title, items: items.map((instance) => ({ instance, name: items.length > 1 ? strip(instance.display_name) : instance.display_name })) }
  })
}

/** What each addable kind needs in its config and binding, in plain words. */
const FORM: Record<string, { configKey?: string; configLabel?: string; configOptions?: string[]; bindingLabel: string; credentialLabel: string }> = {
  llm_usage: { configKey: 'provider', configLabel: 'Provider', configOptions: ['openai', 'anthropic'], bindingLabel: 'OpenAI project id or Anthropic workspace id', credentialLabel: 'Admin key (read the cost report)' },
  http: { configKey: 'endpoint', configLabel: 'Your https endpoint', bindingLabel: 'Id your endpoint uses for this app', credentialLabel: 'Signing secret (shared with your endpoint)' },
  app_store_connect: { bindingLabel: 'App Store app id (numbers)', credentialLabel: 'API key JSON: {"keyId","issuerId","privateKey"}' },
  play_console: { configKey: 'package', configLabel: 'Android package', bindingLabel: 'Android package name', credentialLabel: 'Service account key (JSON)' },
  revenuecat: { bindingLabel: 'RevenueCat project id', credentialLabel: 'v2 secret key (read-only)' },
}

/** How each connector that can act names its actions and its write key. */
const ACT_COPY: Record<string, { name: string; note: string; label: string; done: string }> = {
  play_console: { name: 'Release actions', note: 'Releases (rollout %, promote a track) need a separate write key, and each one still needs approval below.', label: 'Write key (JSON)', done: 'Release actions are on. Each one still needs approval.' },
  revenuecat: { name: 'Payment actions', note: 'Attaching products to a package, or granting a support entitlement, needs a separate RevenueCat v2 secret key with write permissions (project_configuration:packages:read_write, customer_information:customers:read_write). Each one still needs approval below.', label: 'Write key (v2 secret key)', done: 'Payment actions are on. Each one still needs approval.' },
}

export function ConnectorsCard({
  orgId,
  projects,
  iconFor,
  hiddenIds,
}: {
  orgId: string
  projects: Array<{ projectId: string; name: string }>
  iconFor?: IconFor
  /** Apps kept but hidden (the public demo): never drawn as a bound app or offered to bind. */
  hiddenIds?: ReadonlySet<string>
}) {
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
  const [bindDraft, setBindDraft] = useState<Record<string, { projectId: string; externalId: string }>>({})
  const nameOf = (id: string) => projects.find((p) => p.projectId === id)?.name ?? id.slice(0, 8)
  const iconOf: IconFor = (id) => iconFor?.(id) ?? { project_id: id, project_name: nameOf(id), project_slug: '' }
  // The one inline panel a row's More menu opened: bind another app, or the write actions.
  const [open, setOpen] = useState<{ id: string; what: 'bind' | 'act' } | null>(null)
  const form = FORM[kind]
  // Every write here is for owners and admins (QA 177). Remove deletes the
  // stored credential, so it asks first (QA 44).
  const { canManage } = useOrgCanManage(orgId)
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null)

  const act = async (fn: () => Promise<{ ok: boolean; error?: { message?: string } | null }>, okText: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fn()
      setNotice(res.ok ? { tone: 'info', text: okText } : { tone: 'danger', text: actionErrorText(res.error, 'That did not work. Try again in a minute.') })
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
      <p className="mb-3 text-xs text-fg-muted">Optional. Each one lets Mushi Mushi read one more thing it checks. Read-only unless you turn on more, and any release action still needs your approval each time.</p>
      {error && <PageLoadError error={error} resource="connected sources" endpoint={path} onRetry={reload} />}
      {canManage === false && <p className="mb-2 text-xs text-fg-muted">Adding, checking and removing sources: {ORG_ADMIN_ONLY_HINT}</p>}
      <TimedLoading waiting={loading && !data && !error} text="Reading connectors…" what="Connected sources" onRetry={reload} testId="portfolio-connectors-not-checked" />
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
            <>
            {/* "6 connected" once; a row carries a pill only when it is not connected (round 3: a green
                "Connected" on all six rows). */}
            {data.instances.some((i) => i.status === 'connected') && (
              <p className="flex items-center gap-1.5 text-2xs font-semibold text-fg-secondary" data-testid="connectors-count">
                <StatusMark status="passed" />
                {data.instances.filter((i) => i.status === 'connected').length} connected
              </p>
            )}
            <ul className="flex flex-col divide-y divide-edge-subtle">
              {groupConnectors(data.instances, (k) => data.available.find((a) => a.kind === k)?.title ?? k).flatMap((g) => {
                const one = (i: Instance, shownName: string, nested: boolean) => {
                const st = STATUS[i.status] ?? STATUS.unknown
                const canAct = (data.available.find((a) => a.kind === i.kind)?.actions.length ?? 0) > 0
                const copy = ACT_COPY[i.kind] ?? ACT_COPY.play_console
                const actOn = i.enabled_capabilities.includes('act')
                const panel = open?.id === i.id ? open.what : null
                const bound = new Map(i.bindings.filter((b) => !hiddenIds?.has(b.projectId)).map((b) => [b.projectId, b.externalId]))
                return (
                  <li key={i.id} className={`py-1.5 ${nested ? 'pl-5' : ''}`} data-testid={`connector-${i.id}`}>
                    {/* One line: the source, its state pill, the apps bound to it as icons, and one More
                        menu. The "glot.it → 6761582648 · …" string and the two big dropdowns are gone;
                        each app's id is its icon's tooltip (2026-11-18 preview). */}
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      {!nested && <BrandIcon brand={connectorBrand(i)} size={14} decorative />}
                      <span className="min-w-0 truncate text-xs font-semibold text-fg" title={i.display_name}>{shownName}</span>
                      {i.status === 'connected' ? <span className="sr-only">Connected</span> : <StatusPill status={st.status} label={st.label} />}
                      {bound.size > 0 && (
                        <span className="inline-flex min-w-0 items-center gap-1" data-testid="connector-bindings">
                          <span className="sr-only">{`${bound.size} ${bound.size === 1 ? 'app' : 'apps'} bound:`}</span>
                          <AppIconChips projectIds={[...bound.keys()]} iconFor={iconOf} titleFor={(id) => `${nameOf(id)} → ${bound.get(id) ?? ''}`} />
                        </span>
                      )}
                      {canManage !== false && (
                        <span className="ml-auto shrink-0">
                          <MoreActionsMenu
                            label={i.display_name}
                            testId={`connector-more-${i.id}`}
                            actions={[
                              { key: 'check', label: 'Check', disabled: busy, onSelect: () => void act(() => apiFetchMutate(`${path}/${i.id}/probe`, { method: 'POST', body: '{}' }), 'Checked again.') },
                              ...(FORM[i.kind] ? [{ key: 'bind', label: 'Bind another app…', disabled: busy, onSelect: () => setOpen({ id: i.id, what: 'bind' }) }] : []),
                              ...(canAct ? [{ key: 'act', label: `${copy.name} (${actOn ? 'on' : 'off'})…`, disabled: busy, onSelect: () => setOpen({ id: i.id, what: 'act' }) }] : []),
                              { key: 'remove', label: 'Remove', danger: true, disabled: busy, onSelect: () => setConfirmRemove({ id: i.id, name: i.display_name }) },
                            ]}
                          />
                        </span>
                      )}
                    </div>
                    {i.status_reason && <p className="mt-0.5 text-2xs text-fg-muted">{i.status_reason}</p>}
                    {panel === 'act' && (
                      <div className="mt-1.5 flex flex-col gap-2 rounded-sm border border-edge-subtle p-2.5" data-testid={`connector-act-${i.id}`}>
                        <p className="text-2xs text-fg-muted">{copy.note}</p>
                        <Textarea label={copy.label} rows={2} value={writeKey[i.id] ?? ''} onChange={(e) => setWriteKey({ ...writeKey, [i.id]: e.target.value })} spellCheck={false} />
                        <div className="flex gap-2">
                          <Btn size="sm" disabled={busy || !(writeKey[i.id] ?? '').trim()} onClick={() => act(() => apiFetchMutate(`${path}/${i.id}`, { method: 'PATCH', body: JSON.stringify({ writeCredential: writeKey[i.id], enabledCapabilities: [...new Set([...i.enabled_capabilities, 'act'])] }) }), copy.done)}>Turn on</Btn>
                          {actOn && <Btn size="sm" variant="ghost" disabled={busy} onClick={() => act(() => apiFetchMutate(`${path}/${i.id}`, { method: 'PATCH', body: JSON.stringify({ writeCredential: null }) }), `${copy.name} are off and the write key is deleted.`)}>Turn off</Btn>}
                          <Btn size="sm" variant="ghost" onClick={() => setOpen(null)}>Close</Btn>
                        </div>
                      </div>
                    )}
                    {panel === 'bind' && FORM[i.kind] && (
                      <div className="mt-1.5 grid grid-cols-1 gap-2 rounded-sm border border-edge-subtle p-2.5 sm:grid-cols-2" data-testid={`connector-bind-${i.id}`}>
                        <SelectField label="App" value={bindDraft[i.id]?.projectId ?? ''} onChange={(e) => setBindDraft({ ...bindDraft, [i.id]: { projectId: e.target.value, externalId: bindDraft[i.id]?.externalId ?? '' } })}>
                          <option value="">Choose…</option>
                          {projects.filter((p) => !bound.has(p.projectId)).map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
                        </SelectField>
                        <Input label={FORM[i.kind].bindingLabel} value={bindDraft[i.id]?.externalId ?? ''} onChange={(e) => setBindDraft({ ...bindDraft, [i.id]: { projectId: bindDraft[i.id]?.projectId ?? '', externalId: e.target.value } })} />
                        <div className="flex gap-2">
                          <Btn
                            size="sm"
                            disabled={busy || !bindDraft[i.id]?.projectId || !bindDraft[i.id]?.externalId.trim()}
                            onClick={() => act(async () => {
                              const draft = bindDraft[i.id]
                              const res = await apiFetchMutate(`${path}/${i.id}`, { method: 'PATCH', body: JSON.stringify({ bindings: [...i.bindings, { projectId: draft.projectId, externalId: draft.externalId.trim(), role: 'primary' }] }) })
                              if (res.ok) {
                                setBindDraft({ ...bindDraft, [i.id]: { projectId: '', externalId: '' } })
                                setOpen(null)
                              }
                              return res
                            }, 'Bound. It is read with the next daily collection.')}
                          >
                            Bind
                          </Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setOpen(null)}>Close</Btn>
                        </div>
                      </div>
                    )}
                  </li>
                )
                }
                if (g.items.length === 1) return [one(g.items[0]!.instance, g.items[0]!.name, false)]
                return [
                  <li key={`kind:${g.kind}`} className="flex items-center gap-2 py-1.5" data-testid={`connector-group-${g.kind}`}>
                    <BrandIcon brand={connectorBrand(g.items[0]!.instance)} size={14} decorative />
                    <span className="text-xs font-semibold text-fg">{g.title}</span>
                    <span className="font-mono text-2xs font-bold tabular-nums text-fg-secondary">{g.items.length}</span>
                  </li>,
                  ...g.items.map((x) => one(x.instance, x.name, true)),
                ]
              })}
            </ul>
            </>
          )}
          <ActionsCard
            orgId={orgId}
            connectors={data.instances
              .filter((i) => i.enabled_capabilities.includes('act'))
              .map((i) => ({ id: i.id, name: i.display_name, actions: data.available.find((a) => a.kind === i.kind)?.actions ?? [] }))}
          />
          {canManage !== false && (
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SelectField label="For which app" value={bindProject} onChange={(e) => setBindProject(e.target.value)}>
                  <option value="">Not bound yet</option>
                  {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
                </SelectField>
                <Input label={form?.bindingLabel ?? 'External id'} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
              </div>
              <div>
                <Btn size="sm" onClick={create} loading={busy} disabled={busy}>Connect</Btn>
              </div>
            </div>
          </DisclosurePanel>
          )}
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${confirmRemove.name}?`}
          body="Mushi Mushi stops reading this source and deletes its stored credential. To connect it again you will need the credential from the provider."
          confirmLabel="Remove source"
          tone="danger"
          loading={busy}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={async () => {
            await act(() => apiFetchMutate(`${path}/${confirmRemove.id}`, { method: 'DELETE' }), 'Removed, with its stored credential.')
            setConfirmRemove(null)
          }}
        />
      )}
    </Section>
  )
}
