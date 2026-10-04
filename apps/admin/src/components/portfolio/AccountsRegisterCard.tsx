/**
 * AccountsRegisterCard — the accounts and resilience register (Plan 020 §11).
 * Every account the team's apps depend on (Apple, Google Play, AWS, Supabase,
 * Vercel, the registrar, Stripe…): who owns it, whether 2FA is declared on,
 * how many people can get in, a recovery contact, and auto-renew for the
 * registrar and each domain. Names and contacts only, never secrets; the
 * server refuses anything shaped like a key. Exports as Markdown to keep
 * offline or hand to a trusted person.
 *
 * Data: GET    /v1/admin/orgs/:orgId/accounts
 *       GET    /v1/admin/orgs/:orgId/accounts/export   (Markdown, fetched with auth, saved as a file)
 *       POST   /v1/admin/orgs/:orgId/accounts
 *       PATCH  /v1/admin/orgs/:orgId/accounts/:id
 *       DELETE /v1/admin/orgs/:orgId/accounts/:id
 *       PATCH  /v1/admin/orgs/:orgId/domains/:id
 */

import { useState } from 'react'
import { Badge, Btn, Callout, DisclosurePanel, Input, Loading, Section, SelectField } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate, apiFetchRaw } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { ConfirmDialog } from '../ConfirmDialog'
import { PageLoadError } from '../PageLoadError'
import {
  ACCOUNT_PROVIDERS,
  EMPTY_FORM,
  PROVIDER_LABEL,
  accountPayload,
  findingsFor,
  formFromAccount,
  triFrom,
  triLabel,
  triTo,
  type AccountForm,
  type AccountsRegisterResponse,
  type RegisterAccount,
  type TriState,
} from './accountsRegisterView'

export function AccountsRegisterCard({ orgId }: { orgId: string }) {
  const path = `/v1/admin/orgs/${orgId}/accounts`
  const { data, loading, error, reload } = usePageData<AccountsRegisterResponse>(path)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM)
  const [editing, setEditing] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // Removing an account drops its 2FA, owner and recovery notes: ask first (QA 44).
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null)

  const run = async (fn: () => Promise<{ ok: boolean; error?: { message?: string } | null }>, okText: string): Promise<boolean> => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fn()
      setNotice(res.ok ? { tone: 'info', text: okText } : { tone: 'danger', text: actionErrorText(res.error, 'That did not work. Try again in a minute.') })
      return res.ok
    } finally {
      setBusy(false)
      reload()
    }
  }

  const save = async () => {
    const payload = accountPayload(form)
    if (!payload.ok) {
      setNotice({ tone: 'danger', text: payload.error })
      return
    }
    const body = JSON.stringify(payload.body)
    const ok = await run(
      () => (editing
        ? apiFetchMutate<{ id: string }>(`/v1/admin/orgs/${orgId}/accounts/${editing}`, { method: 'PATCH', body })
        : apiFetchMutate<{ id: string }>(`/v1/admin/orgs/${orgId}/accounts`, { method: 'POST', body })),
      editing ? 'Account updated.' : 'Account added to the register.',
    )
    if (ok) {
      setForm(EMPTY_FORM)
      setEditing(null)
      setFormOpen(false)
    }
  }

  const startEdit = (a: RegisterAccount) => {
    setForm(formFromAccount(a))
    setEditing(a.id)
    setFormOpen(true)
    setNotice(null)
  }

  const exportMarkdown = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchRaw(`${path}/export`)
      if (!res.ok) {
        setNotice({ tone: 'danger', text: 'The register could not be exported. Try again in a minute.' })
        return
      }
      const blob = new Blob([await res.text()], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `accounts-register-${new Date().toISOString().slice(0, 10)}.md`
      // Firefox ignores a click on a detached anchor, and revoking the URL in the same tick can
      // cancel the download in Firefox and Safari: attach, click, then clean up on the next tick.
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        a.remove()
        URL.revokeObjectURL(url)
      }, 0)
    } catch {
      setNotice({ tone: 'danger', text: 'The register could not be exported. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  const set = <K extends keyof AccountForm>(k: K, v: AccountForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Section title="Accounts and resilience">
      <p className="mb-3 text-xs text-fg-muted">
        Every account your apps depend on, who owns it, and who else can get in if that person cannot. Names and contacts only: never
        passwords, keys or recovery codes. Everything here is what you declare; Mushi cannot see a provider's own settings.
      </p>
      {error && <PageLoadError error={error} resource="accounts and resilience" endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading the register…" />}
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {data && (
        <div className="flex flex-col gap-3">
          {data.findings.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="To fix in the register">
              {data.findings.map((f) => (
                <li key={`${f.ruleId}:${f.resourceKey ?? ''}`}>
                  <Callout tone="warn" label={f.ruleId === 'account_single_owner' ? 'One person can get in' : 'Auto-renew off'}>
                    <p className="text-xs text-fg">{f.message}</p>
                    <p className="mt-1 text-2xs text-fg-muted">{f.suggestedFix}</p>
                  </Callout>
                </li>
              ))}
            </ul>
          )}

          {data.accounts.length === 0 ? (
            <p className="text-sm text-fg-muted">No accounts recorded yet. Start with the ones that would end the business if you lost them: Apple, Google Play, your registrar and your database host.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-edge-subtle">
              {data.accounts.map((a) => {
                const open = findingsFor(a, data.findings).length > 0
                return (
                  <li key={a.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">
                        {a.name} <span className="text-xs font-normal text-fg-muted">{PROVIDER_LABEL[a.provider]}</span>
                        {open && <Badge tone="warnSubtle" className="ml-2">Look at</Badge>}
                      </p>
                      <p className="text-2xs text-fg-muted">
                        Owner {a.ownerEmail ?? 'not recorded'} · 2FA {triLabel(a.twoFactorDeclared)} · {a.adminCount} {a.adminCount === 1 ? 'person' : 'people'} can get in
                        {' · '}recovery contact {a.recoveryContact ?? 'none'}
                        {a.provider === 'registrar' ? ` · auto-renew ${triLabel(a.autoRenew)}` : ''}
                      </p>
                    </div>
                    {data.canEdit && (
                      <div className="flex shrink-0 gap-2">
                        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => startEdit(a)}>Edit</Btn>
                        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove({ id: a.id, name: a.name })}>Remove</Btn>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {data.domains.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-fg">Domains</p>
              <ul className="flex flex-col gap-1">
                {data.domains.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <code className="font-mono text-xs text-fg">{d.domain}</code>
                    {data.canEdit ? (
                      <label className="flex items-center gap-2 text-xs text-fg-muted">
                        Auto-renew
                        <select
                          className="rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs"
                          value={triFrom(d.autoRenew)}
                          disabled={busy}
                          onChange={(e) => run(() => apiFetchMutate(`/v1/admin/orgs/${orgId}/domains/${d.id}`, { method: 'PATCH', body: JSON.stringify({ autoRenew: triTo(e.target.value as TriState) }) }), `Auto-renew for ${d.domain} saved.`)}
                        >
                          <option value="">Not declared</option>
                          <option value="yes">On</option>
                          <option value="no">Off</option>
                        </select>
                      </label>
                    ) : (
                      <span className="text-xs text-fg-muted">Auto-renew {triLabel(d.autoRenew)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Btn size="sm" variant="ghost" onClick={exportMarkdown} disabled={busy}>Download as Markdown</Btn>
            <span className="text-2xs text-fg-faint">Keep a copy offline, or hand it to someone you trust.</span>
          </div>

          {data.canEdit ? (
            <DisclosurePanel
              title={editing ? 'Edit account' : 'Add an account'}
              open={formOpen}
              onOpenChange={(next: boolean) => {
                setFormOpen(next)
                if (!next) {
                  setEditing(null)
                  setForm(EMPTY_FORM)
                }
              }}
            >
              <div className="flex flex-col gap-2 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <SelectField label="Provider" value={form.provider} onChange={(e) => set('provider', e.target.value as AccountForm['provider'])}>
                    {ACCOUNT_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
                  </SelectField>
                  <Input label="Account name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Team or company it is under" maxLength={120} />
                  <Input label="Owner email" type="email" value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} autoComplete="off" maxLength={254} />
                  <SelectField label="2FA on (declared)" value={form.twoFactor} onChange={(e) => set('twoFactor', e.target.value as TriState)}>
                    <option value="">Not declared</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </SelectField>
                  <Input label="People with owner or admin access" type="number" min={1} max={100} value={form.adminCount} onChange={(e) => set('adminCount', e.target.value)} />
                  <Input label="Recovery contact" value={form.recoveryContact} onChange={(e) => set('recoveryContact', e.target.value)} placeholder="A trusted person who can get in" maxLength={200} autoComplete="off" />
                  {form.provider === 'registrar' && (
                    <SelectField label="Auto-renew (declared)" value={form.autoRenew} onChange={(e) => set('autoRenew', e.target.value as TriState)}>
                      <option value="">Not declared</option>
                      <option value="yes">On</option>
                      <option value="no">Off</option>
                    </SelectField>
                  )}
                </div>
                <p className="text-2xs text-fg-faint">Never paste a password, key or recovery code here; anything shaped like one is refused.</p>
                <div className="flex gap-2">
                  <Btn size="sm" onClick={save} loading={busy} disabled={busy}>{editing ? 'Save changes' : 'Add account'}</Btn>
                </div>
              </div>
            </DisclosurePanel>
          ) : (
            <p className="text-2xs text-fg-faint">Only team owners and admins can change the register.</p>
          )}
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${confirmRemove.name} from the register?`}
          body="Its owner, 2FA, recovery and admin notes are deleted from Mushi. The account itself is not touched. To undo, add it again."
          confirmLabel="Remove"
          tone="danger"
          loading={busy}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={async () => {
            await run(() => apiFetchMutate(`${path}/${confirmRemove.id}`, { method: 'DELETE' }), 'Removed from the register.')
            setConfirmRemove(null)
          }}
        />
      )}
    </Section>
  )
}
