/**
 * FILE: apps/admin/src/components/ops/SlackBotCard.tsx
 * PURPOSE: Settings → "Slack bot" (docs/execplans/ops-hub-slack.md §5): the
 *          team's own Slack app for the Ops hub. Owners and admins save the
 *          bot token and signing secret (write-only: the server keeps them in
 *          Vault and only ever says "saved"), the #payments / #releases /
 *          #alerts channel ids with a "Post a test" each, and the slash
 *          command name. Shows the two Request URLs to paste into Slack.
 *
 * Data: GET / PUT /v1/admin/ops/slack-settings?org=
 *       POST /v1/admin/ops/slack-settings/test?org=&category=
 */

import { useState } from 'react'
import { Btn, Callout, Card, CopyButton, Input, SecretInput, Toggle } from '../ui'
import { useActiveOrgId } from '../OrgSwitcher'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { docsUrl } from '../../lib/docsUrl'
import { CHIP_TONE, LINK_ACCENT } from '../../lib/chipTone'
import type { OpsCategory, OpsSlackSettings } from '../../lib/opsTypes'

const CATEGORIES: ReadonlyArray<{ id: OpsCategory; label: string; example: string }> = [
  { id: 'payments', label: '#payments', example: 'money in and out' },
  { id: 'releases', label: '#releases', example: 'every production deploy' },
  { id: 'alerts', label: '#alerts', example: 'what broke, and when it is fixed' },
]

/** One status line with a shape: ● on, ▲ needs something, ○ off. */
export function slackBotStatus(s: OpsSlackSettings): { glyph: string; label: string; tone: 'ok' | 'warn' | 'neutral' } {
  const channels = CATEGORIES.filter((c) => s.channels[c.id]).length
  if (!s.botToken && !Object.values(s.webhooks).some(Boolean)) return { glyph: '○', label: 'Not connected', tone: 'neutral' }
  if (!s.signingSecret) return { glyph: '▲', label: 'Needs the signing secret for buttons and commands', tone: 'warn' }
  if (channels === 0) return { glyph: '▲', label: 'Needs at least one channel', tone: 'warn' }
  if (!s.enabled) return { glyph: '○', label: 'Saved, switched off', tone: 'neutral' }
  return { glyph: '●', label: `On · ${channels} of 3 channels`, tone: 'ok' }
}

export function SlackBotCard({ id }: { id?: string }) {
  const orgId = useActiveOrgId()
  const toast = useToast()
  const path = orgId ? `/v1/admin/ops/slack-settings?org=${encodeURIComponent(orgId)}` : null
  const { data, error, errorCode, reload } = usePageData<OpsSlackSettings>(path, { scope: 'enumeration' })
  const [botToken, setBotToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [channels, setChannels] = useState<Partial<Record<OpsCategory, string>>>({})
  const [command, setCommand] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<OpsCategory | null>(null)
  const [results, setResults] = useState<Partial<Record<OpsCategory, { ok: boolean; error?: string }>>>({})

  if (!orgId) return null
  if (errorCode === 'MIGRATION_PENDING') {
    return (
      <Card id={id} className="scroll-mt-6 p-4" data-testid="ops-slack-bot">
        <h2 className="text-sm font-semibold text-fg">Slack bot</h2>
        <p className="text-xs text-fg-muted">Available once database update 20261117120000_ops_hub is applied.</p>
      </Card>
    )
  }
  if (error && !data) {
    return (
      <Card id={id} className="scroll-mt-6 p-4" data-testid="ops-slack-bot">
        <h2 className="text-sm font-semibold text-fg">Slack bot</h2>
        <Callout tone="danger" label="Could not load">{error}</Callout>
      </Card>
    )
  }
  if (!data) return null

  const status = slackBotStatus(data)
  const disabled = !data.canEdit || saving

  async function save(patch: Record<string, unknown>) {
    if (!path) return
    setSaving(true)
    const res = await apiFetchMutate<OpsSlackSettings>(path, { method: 'PUT', scope: 'enumeration', body: JSON.stringify(patch), headers: { 'Content-Type': 'application/json' } })
    setSaving(false)
    if (!res.ok) {
      toast.error('Slack bot not saved', res.error?.message)
      return
    }
    setBotToken('')
    setSigningSecret('')
    setChannels({})
    setCommand(null)
    toast.success('Slack bot saved')
    reload()
  }

  function saveForm() {
    const patch: Record<string, unknown> = {}
    if (botToken.trim()) patch.botToken = botToken.trim()
    if (signingSecret.trim()) patch.signingSecret = signingSecret.trim()
    const ch: Record<string, string | null> = {}
    for (const c of CATEGORIES) {
      const v = channels[c.id]
      if (v !== undefined) ch[c.id] = v.trim() ? v.trim().toUpperCase() : null
    }
    if (Object.keys(ch).length) patch.channels = ch
    if (command !== null && command.trim()) patch.command = command.trim().toLowerCase()
    if (Object.keys(patch).length === 0) {
      toast.info('Nothing to save', 'Type a new value first.')
      return
    }
    void save(patch)
  }

  async function test(category: OpsCategory) {
    if (!orgId) return
    setTesting(category)
    const res = await apiFetchMutate<{ results: Array<{ category: OpsCategory; ok: boolean; error?: string }> }>(
      `/v1/admin/ops/slack-settings/test?org=${encodeURIComponent(orgId)}&category=${category}`,
      { method: 'POST', scope: 'enumeration' },
    )
    setTesting(null)
    const r = res.ok ? res.data?.results.find((x) => x.category === category) : null
    setResults((cur) => ({ ...cur, [category]: r ? { ok: r.ok, error: r.error } : { ok: false, error: res.error?.message ?? 'failed' } }))
  }

  return (
    <Card id={id} className="scroll-mt-6 space-y-3 p-4" data-testid="ops-slack-bot">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Slack bot</h2>
          <p className="max-w-prose text-xs text-fg-muted">
            Your team's own Slack app posts every app's payments, releases and alerts, threads the follow-ups, and answers a slash command. For the whole team, not one app.{' '}
            <a href={docsUrl('/integrations/ops-hub#slack-bot')} target="_blank" rel="noopener noreferrer" className={`font-medium ${LINK_ACCENT}`}>
              How to set it up ↗
            </a>
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-2xs font-semibold ${CHIP_TONE[status.tone]}`} data-testid="ops-slack-status">
          <span aria-hidden="true">{status.glyph}</span> {status.label}
        </span>
      </div>

      {!data.canEdit && <p className="text-xs text-fg-secondary">Only team owners and admins can change the Slack bot.</p>}

      {data.requestUrls && (
        <div className="space-y-1 rounded-md border border-edge-subtle px-3 py-2">
          <p className="text-2xs font-bold tracking-wider text-fg-secondary uppercase">Paste these into your Slack app</p>
          {(
            [
              ['Slash command Request URL', data.requestUrls.commands],
              ['Interactivity Request URL', data.requestUrls.interactions],
            ] as const
          ).map(([label, url]) => (
            <div key={label} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-48 shrink-0 text-fg-secondary">{label}</span>
              <code className="min-w-0 flex-1 truncate font-mono text-2xs text-fg" title={url}>
                {url}
              </code>
              <CopyButton value={url} size="sm" label={`Copy ${label}`} />
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <SecretInput
            label={`Bot token${data.botToken ? ' (saved)' : ''}`}
            placeholder={data.botToken ? 'Saved. Type to replace it' : 'xoxb-…'}
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            disabled={disabled}
          />
          {data.teamId && <p className="mt-0.5 text-2xs text-fg-secondary">Workspace {data.teamId}</p>}
        </div>
        <SecretInput
          label={`Signing secret${data.signingSecret ? ' (saved)' : ''}`}
          placeholder={data.signingSecret ? 'Saved. Type to replace it' : 'Basic Information → Signing Secret'}
          value={signingSecret}
          onChange={(e) => setSigningSecret(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        {CATEGORIES.map((c) => {
          const r = results[c.id]
          return (
            <div key={c.id} className="flex flex-wrap items-end gap-2">
              <div className="w-56 min-w-0">
                <Input
                  label={`${c.label} channel id`}
                  placeholder={data.channels[c.id] ?? 'C0123ABCD'}
                  value={channels[c.id] ?? data.channels[c.id] ?? ''}
                  onChange={(e) => setChannels((cur) => ({ ...cur, [c.id]: e.target.value }))}
                  className="font-mono"
                  disabled={disabled}
                />
              </div>
              <span className="pb-1.5 text-2xs text-fg-secondary">{c.example}</span>
              <Btn size="sm" variant="ghost" onClick={() => void test(c.id)} loading={testing === c.id} disabled={!data.canEdit || (!data.channels[c.id] && !data.webhooks[c.id])} title={`Post a test message to ${c.label}`}>
                Post a test
              </Btn>
              {r && (
                <span className={`pb-1.5 text-2xs font-semibold ${r.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`} title={r.error}>
                  {r.ok ? '✓ Posted' : `✕ ${r.error ?? 'failed'}`}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Input label="Slash command" value={command ?? data.command} onChange={(e) => setCommand(e.target.value)} className="font-mono" disabled={disabled} />
        </div>
        <Toggle label="Post to Slack" checked={data.enabled} onChange={(on) => void save({ enabled: on })} disabled={disabled} />
        <Btn size="sm" onClick={saveForm} loading={saving} disabled={disabled}>
          Save
        </Btn>
      </div>
    </Card>
  )
}
