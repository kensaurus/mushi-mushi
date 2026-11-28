/**
 * FILE: apps/admin/src/components/personas/TestAccountsCard.tsx
 * PURPOSE: Whether a first-time user test may sign up (ADR 0073), per app and
 *          off by default: through the app's own test-account hook (it makes
 *          a throwaway account per visitor and deletes it), or, for an app that
 *          signs in on this Mushi, Mushi's own sign-in (operators only). Only an
 *          owner or admin changes it, from the console.
 *
 * Write: PUT /v1/admin/projects/:pid/test-accounts { mode, hookUrl?, rotateSecret? }
 *        The signing secret comes back once, when the hook is first set or the
 *        secret is replaced; this card keeps it in its own state until it is
 *        dismissed, so a reload of the page data does not hide it before it is copied.
 */

import { useId, useState } from 'react'
import { Btn, Callout, Card, CodeValue, DisclosurePanel, Input, SegmentedControl } from '../ui'
import { StatusPill } from '../signal/StatusMark'
import { apiFetchMutate } from '../../lib/supabase'
import type { TestAccountMode, TestAccountsSetting } from '../../lib/personas'

const MODE_WORD: Record<TestAccountMode, string> = {
  off: 'Off',
  hook: "Your app's test-account hook",
  mushi: "This Mushi's own sign-in (operators)",
}

const CREATE_EXAMPLE = `POST <your hook>
X-Mushi-Event: mushi.test_account.create
X-Mushi-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>

{ "event": "mushi.test_account.create", "project_id": "…", "run_id": "…",
  "visitor": 1, "expires_at": "2026-…Z", "persona": { "name": "…", "locale": "ja-JP" } | null }

→ 200 { "email": "…", "password": "…", "name": "…", "id": "…" }`

const EXPIRE_EXAMPLE = `POST <your hook>
X-Mushi-Event: mushi.test_account.expire
X-Mushi-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>

{ "event": "mushi.test_account.expire", "project_id": "…", "run_id": "…",
  "accounts": ["<id or email>", …] }`

export function TestAccountsCard({ projectId, setting, onSaved }: { projectId: string; setting: TestAccountsSetting; onSaved: () => void }) {
  const uid = useId()
  const [mode, setMode] = useState<TestAccountMode>(setting.mode)
  const [hookUrl, setHookUrl] = useState(setting.hookUrl ?? '')
  const [busy, setBusy] = useState<'save' | 'rotate' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)

  const options = (['off', 'hook', ...(setting.canUseMushi || setting.mode === 'mushi' ? (['mushi'] as const) : [])] as TestAccountMode[]).map((m) => ({ id: m, label: MODE_WORD[m] }))
  const urlTrim = hookUrl.trim()
  const urlOk = urlTrim === '' || /^https:\/\/[^\s/]+/i.test(urlTrim)
  const dirty = mode !== setting.mode || (mode === 'hook' && urlTrim !== (setting.hookUrl ?? ''))
  const needsUrl = mode === 'hook' && !urlTrim

  async function put(rotate: boolean) {
    setBusy(rotate ? 'rotate' : 'save')
    setError(null)
    setSaved(null)
    const body: { mode: TestAccountMode; hookUrl?: string | null; rotateSecret?: boolean } = { mode }
    if (mode === 'hook') body.hookUrl = urlTrim || null
    if (rotate) body.rotateSecret = true
    const res = await apiFetchMutate<{ mode: TestAccountMode; hookUrl: string | null; hasSecret: boolean; secret?: string }>(`/v1/admin/projects/${projectId}/test-accounts`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    setBusy(null)
    if (!res.ok) {
      setError(res.error?.message ?? 'Nothing changed. Try again in a minute.')
      return
    }
    if (res.data?.secret) setSecret(res.data.secret)
    setSaved(rotate ? 'A new signing secret is set. The old one stops working now.' : res.data?.mode === 'off' ? 'Test accounts are off.' : 'Saved.')
    onSaved()
  }

  const status = setting.mode === 'off' ? ({ status: 'idle', label: 'Off' } as const) : ({ status: 'passed', label: setting.mode === 'hook' ? 'Hook on' : "Mushi's sign-in" } as const)

  return (
    <Card id="test-accounts" className="flex scroll-mt-4 flex-col gap-3 p-3" data-testid="test-accounts">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-fg">Test accounts</h2>
        <StatusPill status={status.status} label={status.label} />
      </div>
      <p className="max-w-prose text-xs text-fg-secondary">
        A first-time user test stops at your sign-up page unless each visitor can get its own throwaway account. Your app makes them through a small hook you add, and deletes them after the test. Off by default.
      </p>

      {setting.canChange ? (
        <div className="flex flex-col gap-3">
          <SegmentedControl<TestAccountMode> size="sm" wrap ariaLabel="How test accounts are made" value={mode} options={options} onChange={setMode} className="self-start" />
          {mode === 'hook' && (
            <Input
              id={`test-account-hook-${uid}`}
              label="Hook address"
              type="url"
              inputMode="url"
              value={hookUrl}
              onChange={(e) => setHookUrl(e.target.value)}
              placeholder="https://your-app.com/api/mushi-test-accounts"
              spellCheck={false}
              autoCapitalize="off"
              error={!urlOk ? 'Use an address that starts with https://' : undefined}
            />
          )}
          {mode === 'mushi' && <p className="text-2xs text-fg-muted">Only for an app that signs in on this Mushi itself. Visitors get accounts in Mushi’s own sign-in, deleted after a day.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Btn size="sm" onClick={() => void put(false)} loading={busy === 'save'} disabled={!dirty || !urlOk || needsUrl || busy != null}>
              Save
            </Btn>
            {setting.mode === 'hook' && setting.hasSecret && mode === 'hook' && (
              <Btn size="sm" variant="ghost" onClick={() => void put(true)} loading={busy === 'rotate'} disabled={busy != null || !urlOk || needsUrl}>
                Make a new signing secret
              </Btn>
            )}
            {needsUrl && <span className="text-2xs text-fg-muted">Add the hook address first.</span>}
            {saved && !error && <span className="text-2xs text-fg-secondary">{saved}</span>}
            {error && (
              <span role="alert" className="text-2xs text-danger">
                {error}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-2xs text-fg-muted">
          Now: {MODE_WORD[setting.mode]}
          {setting.mode === 'hook' && setting.hookUrl ? ` (${setting.hookUrl})` : ''}. Only an owner or admin of this app can change it.
        </p>
      )}

      {secret && (
        <Callout tone="warn" label="Signing secret, shown once">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-fg-secondary">Copy it into your hook now. You won’t see it again; if it is lost, make a new one.</p>
            <CodeValue value={secret} tone="hash" />
            <Btn size="sm" variant="ghost" className="self-start" onClick={() => setSecret(null)}>
              I copied it
            </Btn>
          </div>
        </Callout>
      )}

      <DisclosurePanel title="How the hook works">
        <div className="flex flex-col gap-2 text-xs text-fg-secondary">
          <p>
            When a test starts, Mushi asks your hook for one account per visitor. Check the signature first: it is an HMAC-SHA256 of <code className="font-mono">{'"<t>.<body>"'}</code> with your signing secret. Answer within 8 seconds.
          </p>
          <CodeValue multiline value={CREATE_EXAMPLE} />
          <p>When the test ends, Mushi asks the hook to delete the accounts it made, signed the same way:</p>
          <CodeValue multiline value={EXPIRE_EXAMPLE} />
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              Delete any account past its <code className="font-mono">expires_at</code> yourself too; the expire call is best effort.
            </li>
            <li>Mushi asks for at most 12 accounts an hour, and does not follow redirects.</li>
            <li>Make accounts that can do nothing outside a test: no payments, no real email.</li>
          </ul>
        </div>
      </DisclosurePanel>
    </Card>
  )
}
