/**
 * FILE: apps/admin/src/components/providers/ThresholdsDrawer.tsx
 * PURPOSE: Edit one provider account's thresholds (set_provider_thresholds).
 *          The fields come from meta.threshold_keys. Only changed keys are
 *          sent; an emptied field is sent as null, which removes the key.
 *          Balances are dollars, shares 0..1, as upstream stores them.
 */

import { useState } from 'react'
import type { ProviderAccount } from '../../lib/kensaurusOpsTypes'
import { Drawer } from '../Drawer'
import { Btn, Input } from '../ui'

const HINT: Record<string, string> = {
  warn_balance: 'USD, warn at or below',
  crit_balance: 'USD, down at or below',
  warn_pct_used: 'share 0–1, warn at or above',
  crit_pct_used: 'share 0–1, down at or above',
  stale_after_min: 'minutes, 5–10080',
  expected_tier: 'plan name',
  ok_statuses: 'comma separated',
  console_url: 'https://…',
}

const NUMERIC = new Set(['warn_balance', 'crit_balance', 'warn_pct_used', 'crit_pct_used', 'stale_after_min'])

function toText(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

function fromText(key: string, text: string): unknown {
  const t = text.trim()
  if (t === '') return null
  if (NUMERIC.has(key)) return Number(t)
  if (key === 'ok_statuses') return t.split(',').map((s) => s.trim()).filter(Boolean)
  return t
}

/** The patch for changed fields only; null removes a key. */
function thresholdsPatch(keys: readonly string[], current: Record<string, unknown>, draft: Record<string, string>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const k of keys) {
    if (!(k in draft) || draft[k] === toText(current[k])) continue
    patch[k] = fromText(k, draft[k]!)
  }
  return patch
}

export function ThresholdsDrawer({
  account,
  keys,
  busy,
  onClose,
  onSave,
}: {
  account: ProviderAccount | null
  keys: readonly string[]
  busy: boolean
  onClose: () => void
  onSave: (account: ProviderAccount, patch: Record<string, unknown>) => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const current = account?.thresholds ?? {}
  const patch = account ? thresholdsPatch(keys, current, draft) : {}
  const bad = Object.entries(patch).some(([k, v]) => NUMERIC.has(k) && typeof v === 'number' && !Number.isFinite(v))
  const changed = Object.keys(patch).length
  return (
    <Drawer
      open={!!account}
      onClose={() => {
        setDraft({})
        onClose()
      }}
      title={account ? `Thresholds · ${account.label}` : 'Thresholds'}
      width="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-2xs text-fg-muted">{changed > 0 ? `${changed} change${changed === 1 ? '' : 's'}` : 'No changes'}</span>
          <Btn
            size="sm"
            variant="primary"
            loading={busy}
            disabled={changed === 0 || bad || busy}
            onClick={() => {
              if (account) onSave(account, patch)
              setDraft({})
            }}
            data-testid="thresholds-save"
          >
            Save
          </Btn>
        </div>
      }
    >
      {account && (
        <div className="grid grid-cols-1 gap-2" data-testid="thresholds-form">
          {keys.map((k) => (
            <Input
              key={k}
              label={k}
              placeholder={HINT[k] ?? ''}
              inputMode={NUMERIC.has(k) ? 'decimal' : undefined}
              value={k in draft ? draft[k]! : toText(current[k])}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          ))}
        </div>
      )}
    </Drawer>
  )
}
