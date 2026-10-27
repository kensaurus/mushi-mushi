/**
 * FILE: apps/admin/src/components/credits/CreditCountdowns.tsx
 * PURPOSE: The top of /credits (console journeys 2026-10-27): "are my
 *          expiring credits being used?" answered with one countdown card per
 *          key, soonest first: days left, the date, a used-vs-left bar and
 *          one line each. Cursor shares no balance (ADR 0028), so its card
 *          counts fixes; Firecrawl's card shows its real balance.
 *
 *          The page's one primary action sits in the status line: "Turn on
 *          spend-down" for the soonest-expiring Cursor key that is idle and
 *          that this user may change. Every other switch stays further down.
 */

import { useState } from 'react'
import { Card, PageStatus, ResultChip, Btn } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { describeByokError } from '../../lib/byokErrors'
import { creditCountdowns, type CreditCountdown } from '../../lib/creditPlan'
import type { SpendDownKeyStatus } from '../settings/spendDown'
import { canChangeSpendDown } from './CursorLevers'
import type { FirecrawlBalance } from './FirecrawlLevers'

interface Props {
  keys: SpendDownKeyStatus[] | null
  balance: FirecrawlBalance | null
  canManageOrg: boolean
  now: Date
  onChanged: () => void
}

const BAR_TONE: Record<CreditCountdown['tone'], string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-fg-faint',
}

const DAYS_TONE: Record<CreditCountdown['tone'], string> = {
  ok: 'text-fg',
  warn: 'text-warn',
  danger: 'text-danger',
  neutral: 'text-fg-muted',
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

export function CreditCountdowns({ keys, balance, canManageOrg, now, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)
  if (keys == null) return <p className="text-xs text-fg-muted">Reading your keys…</p>

  const cards = creditCountdowns({ cursorKeys: keys, firecrawl: balance, now })
  const idle = cards.filter((c) => c.idle)
  const turnOn = idle
    .map((c) => keys.find((k) => k.id === c.id))
    .find((k): k is SpendDownKeyStatus => k != null && canChangeSpendDown(k, canManageOrg))

  async function enable(k: SpendDownKeyStatus) {
    setBusy(true)
    const res = await apiFetch(`/v1/admin/byok/keys/${k.id}/spend-down`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) })
    setBusy(false)
    setNotice(
      res.ok
        ? { ok: true, message: 'Spend-down on.' }
        : { ok: false, message: describeByokError(res.error, 'Not saved. Retry in a moment.').message },
    )
    if (res.ok) onChanged()
  }

  if (cards.length === 0) {
    return (
      <PageStatus
        tone="neutral"
        sentence="None of your keys has an expiry date yet. Add one to a Cursor key in Settings → AI keys and Mushi can spend it on your bugs before it lapses."
        ariaLabel="Expiring credits"
        data-testid="credit-countdowns"
      />
    )
  }

  const soonest = cards[0]
  const sentence =
    idle.length > 0
      ? `${plural(idle.length, 'Cursor key has', 'Cursor keys have')} an expiry date but spend-down is off. Turn it on so the credits fix bugs.`
      : `Every key with an expiry date is being spent. The soonest, ${soonest.name}, ${soonest.verb} in ${plural(soonest.daysLeft, 'day')}.`

  return (
    <div className="space-y-3" data-testid="credit-countdowns">
      <PageStatus
        tone={idle.length > 0 ? (idle.some((c) => c.tone === 'danger') ? 'danger' : 'warn') : 'ok'}
        sentence={sentence}
        ariaLabel="Expiring credits"
        action={
          turnOn ? (
            <Btn size="sm" variant="primary" loading={busy} onClick={() => void enable(turnOn)}>
              Turn on spend-down
            </Btn>
          ) : null
        }
      />
      {notice && <ResultChip tone={notice.ok ? 'success' : 'error'}>{notice.message}</ResultChip>}
      <ul aria-label="Credits by expiry date" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.id} className="min-w-0">
            <CountdownCard card={c} />
          </li>
        ))}
      </ul>
      {cards.some((c) => c.provider === 'cursor') && (
        <p className="text-2xs text-fg-muted">Cursor doesn&apos;t report a balance, so its cards count fixes instead of credits.</p>
      )}
    </div>
  )
}

function CountdownCard({ card }: { card: CreditCountdown }) {
  const pct = card.of && card.of > 0 ? Math.min(100, Math.round((card.used / card.of) * 100)) : 0
  return (
    <Card className="h-full p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-fg" title={card.name}>
          {card.name}
        </p>
        <p className="shrink-0 text-right leading-none">
          <span className={`text-2xl font-semibold tabular-nums ${DAYS_TONE[card.tone]}`}>{card.daysLeft}</span>
          <span className="ml-1 text-2xs text-fg-muted">{card.daysLeft === 1 ? 'day' : 'days'}</span>
        </p>
      </div>
      <p className="mt-0.5 text-2xs text-fg-muted">
        {card.daysLeft === 0 ? (card.verb === 'expires' ? 'Expired' : 'Resets today') : `${card.verb === 'expires' ? 'Expires' : 'Resets'} ${card.date}`}
      </p>
      <div
        role="meter"
        aria-label={card.usedLine}
        aria-valuemin={0}
        aria-valuemax={card.of ?? 0}
        aria-valuenow={card.used}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay"
      >
        <div className={`h-full rounded-full ${BAR_TONE[card.tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-fg-secondary">{card.usedLine}</p>
      <p className={`mt-0.5 text-xs ${card.idle ? 'text-warn' : 'text-fg-muted'}`}>{card.leftLine}</p>
    </Card>
  )
}
