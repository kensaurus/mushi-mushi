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
import { agentCreditsTitle, creditsBackLine, type AgentCreditsState } from '../../lib/agentCredits'
import { countdownDisplayTone, countdownStatusTone } from '../../lib/creditsView'

interface Props {
  keys: SpendDownKeyStatus[] | null
  balance: FirecrawlBalance | null
  canManageOrg: boolean
  now: Date
  onChanged: () => void
  /** The fix agents are out of credits (lib/agentCredits.ts): no "Turn on spend-down", no "room for". */
  outOfCredits?: AgentCreditsState | null
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

/**
 * Who can switch on an idle key the viewer cannot: a universal key only by
 * the person who added it (ADR 0031), a shared key by an organization owner
 * or admin. "The key's owner or a team admin" was wrong for the first
 * (2026-10-31: a team admin could not change another member's key).
 */
function whoCanTurnOn(idle: ReadonlyArray<SpendDownKeyStatus | undefined>): string {
  const universal = idle.filter((k) => k?.scope === 'universal').length
  if (universal === idle.length) {
    return `Only the person who added ${idle.length === 1 ? 'it' : 'them'} can turn spend-down on or change the date.`
  }
  return universal === 0
    ? 'Only an organization owner or admin can turn it on.'
    : 'The person who added each key, or an organization owner or admin for shared keys, can turn it on.'
}

export function CreditCountdowns({ keys, balance, canManageOrg, now, onChanged, outOfCredits = null }: Props) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)
  if (keys == null) return <p className="text-xs text-fg-muted">Reading your keys…</p>

  const out = outOfCredits?.out ? outOfCredits : null
  const cards = creditCountdowns({ cursorKeys: keys, firecrawl: balance, outOfCredits: out, now })
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
        sentence="None of your keys has an expiry date yet. Add one to a Cursor key in Settings → AI keys and Mushi Mushi can spend it on your bugs before it lapses."
        ariaLabel="Expiring credits"
        data-testid="credit-countdowns"
      />
    )
  }

  const soonest = cards[0]
  const sentence = out
    ? `${agentCreditsTitle(out)}. ${creditsBackLine(out) ?? ''} Spend-down cannot help until then; the card below says what to do now.`.replace('  ', ' ')
    : idle.length > 0
      ? `${plural(idle.length, 'Cursor key has', 'Cursor keys have')} an expiry date but spend-down is off. ${
          // Only ask for what this person can do: the switch is greyed out
          // for a key someone else owns (2026-10-28).
          turnOn ? 'Turn it on so the credits fix bugs.' : whoCanTurnOn(idle.map((c) => keys.find((k) => k.id === c.id)))
        }`
      : `Every key with an expiry date is being spent. The soonest, ${soonest.name}, ${soonest.verb} in ${plural(soonest.daysLeft, 'day')}.`

  return (
    <div className="space-y-3" data-testid="credit-countdowns">
      <PageStatus
        // Spend-down off is a nudge (amber); only out of credits is a failure (red). Round-2 review.
        tone={countdownStatusTone(Boolean(out), idle.length)}
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
        {liveFirst(cards).map((c) => (
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

/** An expired key's credits are gone: nothing to count against. */
function isExpired(card: CreditCountdown): boolean {
  return card.verb === 'expires' && card.daysLeft === 0
}

/**
 * @internal Exported for tests. Live keys first, expired ones after them, each
 * keeping its order: an expired key led the row with "0 days" and an empty bar.
 */
function liveFirst<T extends CreditCountdown>(cards: readonly T[]): T[] {
  return [...cards.filter((c) => !isExpired(c)), ...cards.filter(isExpired)]
}

function CountdownCard({ card }: { card: CreditCountdown }) {
  const tone = countdownDisplayTone(card)
  const pct = card.of && card.of > 0 ? Math.min(100, Math.round((card.used / card.of) * 100)) : 0
  if (isExpired(card)) {
    // Expired: say so, hatch the bar (nothing left to measure), no "0 of 100 fixes sent today".
    return (
      <Card className="h-full p-3" data-testid="credit-countdown-expired">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-medium text-fg-secondary [overflow-wrap:anywhere]" title={card.name}>
            {card.name}
          </p>
          <p className="shrink-0 text-sm font-semibold text-fg-secondary">Expired</p>
        </div>
        <div aria-hidden="true" className="ci-nodata mt-2 h-1.5 w-full rounded-full border border-edge-subtle" />
        <p className="mt-1.5 text-xs text-fg-muted">{card.leftLine}</p>
      </Card>
    )
  }
  return (
    <Card className="h-full p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        {/* Wraps instead of cutting the key hint ("kenji.sakuramoto (crsr_8821bf7...24…"). */}
        <p className="min-w-0 text-sm font-medium text-fg [overflow-wrap:anywhere]" title={card.name}>
          {card.name}
        </p>
        <p className="shrink-0 text-right leading-none">
          <span className={`text-2xl font-semibold tabular-nums ${DAYS_TONE[tone]}`} data-tone={tone}>{card.daysLeft}</span>
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
        <div className={`h-full rounded-full ${BAR_TONE[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-fg-secondary">{card.usedLine}</p>
      <p className={`mt-0.5 text-xs ${card.idle ? 'text-warn' : 'text-fg-muted'}`}>{card.leftLine}</p>
    </Card>
  )
}
