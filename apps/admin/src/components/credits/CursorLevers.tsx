/**
 * FILE: apps/admin/src/components/credits/CursorLevers.tsx
 * PURPOSE: /credits, Cursor half: each Cursor key's expiry and spend-down
 *          (ADR 0028) as one switch, naming the model it runs on, and review
 *          follow-ups (ADR 0032) with the model each round uses. The forms
 *          with every field stay in Settings → AI keys; this is the on/off view.
 */

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { ResultChip, Toggle } from '../ui'
import { PanelFetchNote } from '../PanelFetchNote'
import { apiFetch, type ApiResult } from '../../lib/supabase'
import { describeByokError } from '../../lib/byokErrors'
import { expiryLabel } from '../../lib/creditPlan'
import { cursorModelLabel } from '../../lib/cursorModelLabel'
import { spendDownLine, spendDownOutOfWork, type SpendDownKeyStatus, type SpendDownResponse } from '../settings/spendDown'
import type { ReviewFollowupsResponse } from '../settings/reviewFollowups'

interface Props {
  spendDown: SpendDownResponse | null
  /**
   * Spend-down failed and this view must not treat a missing payload as
   * "no Cursor key". An empty `keys` array after a successful read still
   * means there is no key.
   */
  spendDownFailed?: boolean
  followups: ReviewFollowupsResponse | null
  /** True only while the first follow-up read is in flight. */
  followupsLoading?: boolean
  followupsError?: string | null
  onRetryFollowups?: () => void
  now: Date
  onChanged: () => void
}

function canChange(k: SpendDownKeyStatus, canManageOrg: boolean): boolean {
  if (k.scope === 'universal') return k.ownedByMe === true
  if (k.scope === 'organization') return canManageOrg
  return true
}

export function CursorLevers({ spendDown, spendDownFailed = false, followups, followupsLoading = false, followupsError, onRetryFollowups, now, onChanged }: Props) {
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

  // No-key depends only on a successful empty spend-down read. Follow-up
  // loading and errors render beside that prompt; they do not replace it.
  const showNoKey = keys.length === 0 && spendDown != null && !spendDownFailed
  if (!showNoKey && keys.length === 0 && !fu && !followupsLoading && !followupsError) return null

  return (
    <div className="space-y-3">
      {showNoKey && (
        <p className="text-sm text-fg-muted">
          No Cursor key yet. <Link className="text-brand hover:underline" to="/settings?tab=byok">Add one in Settings → AI keys</Link>{' '}
          and Mushi can send open bugs to Cursor before its credits expire.
        </p>
      )}
      {keys.length > 0 && (
        <p className="text-xs text-fg-muted">The Cursor keys the open app can use. Another app&apos;s keys show when you switch to it.</p>
      )}
      {keys.length > 0 && (
        <ul className="divide-y divide-edge-subtle">
          {keys.map((k) => {
            const line = spendDownLine(k)
            const modelName = cursorModelLabel(k.model) ?? "each app's Cursor model"
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
                <p className="text-xs text-fg-secondary">
                  {line.text} Runs on {modelName}.{' '}
                  <Link className="text-brand hover:underline" to="/settings?tab=byok">Change</Link>
                </p>
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
      )}

      {followupsLoading && !fu && <p className="text-xs text-fg-muted">Reading review follow-ups…</p>}
      {followupsError && (
        <PanelFetchNote
          stale={Boolean(fu)}
          message="Couldn't load review follow-ups."
          onRetry={onRetryFollowups}
        />
      )}
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
            {' '}Rounds run on {cursorModelLabel(fu.model) ?? "each app's model"}
            {fu.escalationModel ? `; the last round on ${cursorModelLabel(fu.escalationModel)}` : ''}.
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
