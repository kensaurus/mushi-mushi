/**
 * FILE: apps/admin/src/components/credits/CursorLevers.tsx
 * PURPOSE: /credits, Cursor half: each Cursor key's expiry and spend-down
 *          (ADR 0028) as one switch, and review follow-ups (ADR 0032) with
 *          the model each round uses. The forms with every field stay in
 *          Settings → AI keys; this is the on/off view.
 */

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { ResultChip, Toggle } from '../ui'
import { apiFetch, type ApiResult } from '../../lib/supabase'
import { describeByokError } from '../../lib/byokErrors'
import { expiryLabel } from '../../lib/creditPlan'
import { spendDownLine, spendDownOutOfWork, type SpendDownKeyStatus, type SpendDownResponse } from '../settings/spendDown'
import type { ReviewFollowupsResponse } from '../settings/reviewFollowups'

interface Props {
  spendDown: SpendDownResponse | null
  followups: ReviewFollowupsResponse | null
  now: Date
  onChanged: () => void
}

function canChange(k: SpendDownKeyStatus, canManageOrg: boolean): boolean {
  if (k.scope === 'universal') return k.ownedByMe === true
  if (k.scope === 'organization') return canManageOrg
  return true
}

export function CursorLevers({ spendDown, followups, now, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)
  const keys = spendDown?.keys ?? []
  const canManageOrg = followups?.canManage === true
  const fu = followups?.available ? followups.settings : undefined

  async function save(id: string, request: () => Promise<ApiResult<unknown>>, done: string) {
    setBusy(id)
    const res = await request()
    setBusy(null)
    setNotice(
      res.ok
        ? { ok: true, message: done }
        : { ok: false, message: describeByokError(res.error, 'Not saved. Retry in a moment.').message },
    )
    if (res.ok) onChanged()
  }

  if (keys.length === 0 && !fu) {
    return (
      <p className="text-sm text-fg-muted">
        No Cursor key yet. <Link className="text-brand hover:underline" to="/settings?tab=byok">Add one in Settings → AI keys</Link>{' '}
        and Mushi can send open bugs to Cursor before its credits expire.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-edge-subtle">
        {keys.map((k) => {
          const line = spendDownLine(k)
          const expiry = expiryLabel(k.creditsExpireAt, now)
          const editable = canChange(k, canManageOrg)
          return (
            <li key={k.id} className="space-y-1 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-mono text-fg-secondary">{k.keyHint ?? '…'}</span>
                  {k.label && <span className="ml-2 text-fg-muted">{k.label}</span>}
                  {expiry && <span className="ml-2 text-xs text-fg-muted">· {expiry}</span>}
                </p>
                <Toggle
                  label="Fix open bugs before the credits expire"
                  checked={k.enabled}
                  disabled={!editable || busy === k.id || (!k.enabled && !k.creditsExpireAt)}
                  onChange={(v) =>
                    void save(
                      k.id,
                      () => apiFetch(`/v1/admin/byok/keys/${k.id}/spend-down`, { method: 'PATCH', body: JSON.stringify({ enabled: v }) }),
                      v ? 'Spend-down on.' : 'Spend-down off.',
                    )
                  }
                />
              </div>
              <p className="text-xs text-fg-secondary">{line.text}</p>
              {!k.enabled && !k.creditsExpireAt && (
                <p className="text-xs text-fg-muted">
                  Set the expiry date first in{' '}
                  <Link className="text-brand hover:underline" to="/settings?tab=byok">Settings → AI keys</Link>.
                </p>
              )}
              {!editable && <p className="text-xs text-fg-muted">An owner or admin of this key can change it.</p>}
              {spendDownOutOfWork(k) && (
                <p className="text-xs text-fg-muted">
                  Nothing left to send right now. Watch more of your sites below to find more bugs.
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {fu && (
        <div className="space-y-1 border-t border-edge-subtle pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg">Review follow-ups</p>
            <Toggle
              label="Send fix-first pull requests back to an agent"
              checked={fu.enabled}
              disabled={!canManageOrg || busy === 'followups'}
              onChange={(v) =>
                void save(
                  'followups',
                  () => apiFetch('/v1/admin/byok/review-followups', { method: 'PATCH', body: JSON.stringify({ enabled: v }) }),
                  v ? 'Review follow-ups on.' : 'Review follow-ups off.',
                )
              }
            />
          </div>
          <p className="text-xs text-fg-secondary">
            When Opus says &ldquo;fix first&rdquo;, a new agent fixes exactly its findings on the same pull request (two rounds at most).
            {' '}Rounds run on {fu.model ?? "each app's model"}
            {fu.escalationModel ? `; the last round on ${fu.escalationModel}` : ''}.
          </p>
          <p className="text-xs text-fg-muted">
            Models, key and daily limit:{' '}
            <Link className="text-brand hover:underline" to="/settings?tab=byok">Settings → AI keys</Link>.
          </p>
        </div>
      )}
      {notice && <ResultChip tone={notice.ok ? 'success' : 'error'}>{notice.message}</ResultChip>}
    </div>
  )
}
