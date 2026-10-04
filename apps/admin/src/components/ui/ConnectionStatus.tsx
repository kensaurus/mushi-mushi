/**
 * FILE: apps/admin/src/components/ui/ConnectionStatus.tsx
 * PURPOSE: The one status line every connection card uses (integrations,
 *          settings keys): four states plus "Not checked yet", each with its
 *          fix next to it.
 *
 *   working        green  "Working"           + optional detail ("verified 2h ago")
 *   attention      amber  "Needs attention"   + the specific problem + a button
 *   expiring       amber  "Expires in N days" + a renew button
 *   not_connected  neutral "Not connected"    + a connect button
 *   checking       neutral "Not checked yet"  + a test button
 *
 * Truth rule: a card never says "Working" without a verification timestamp,
 * and never says "Healthy" because a probe of one half (an API token) passed
 * while the other half (inbound events) has never been seen.
 */

import { Btn } from './forms'
import { CHIP_TONE } from '../../lib/chipTone'

export type ConnectionState = 'working' | 'attention' | 'expiring' | 'not_connected' | 'checking'

interface ConnectionStatusAction {
  label: string
  onClick?: () => void
  to?: string
}

interface ConnectionStatusProps {
  state: ConnectionState
  /** Overrides the default chip text for the state. */
  label?: string
  /** One plain-English sentence: what was verified, or what is wrong. */
  detail?: string
  /** ISO timestamp; drives the "Expires in N days" text. */
  expiresAt?: string | null
  action?: ConnectionStatusAction
  className?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A verification older than this no longer proves the connection works. */
const CONNECTION_VERIFIED_FRESH_MS = 7 * DAY_MS
/** Start warning this long before a credential expires. */
const CONNECTION_EXPIRY_WARN_MS = 14 * DAY_MS

function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  return Math.ceil((at - now) / DAY_MS)
}

/**
 * Pure state derivation shared by every connection card.
 *
 * - not configured                 → not_connected
 * - the last check failed          → attention
 * - the credential already expired → attention
 * - expires within 14 days         → expiring
 * - never verified                 → checking ("Not checked yet")
 * - verified longer ago than fresh → attention (re-test)
 * - otherwise                      → working
 */
export function connectionStateFrom(input: {
  configured: boolean
  verifiedAt?: string | null
  lastError?: string | null
  expiresAt?: string | null
  now?: number
  /** Override the freshness window, e.g. for channels only verified by a manual test. */
  staleAfterMs?: number
}): ConnectionState {
  const now = input.now ?? Date.now()
  if (!input.configured) return 'not_connected'
  if (input.lastError) return 'attention'
  const days = daysUntil(input.expiresAt, now)
  if (days != null && days <= 0) return 'attention'
  if (days != null && days * DAY_MS <= CONNECTION_EXPIRY_WARN_MS) return 'expiring'
  const verified = input.verifiedAt ? Date.parse(input.verifiedAt) : NaN
  if (!Number.isFinite(verified)) return 'checking'
  if (now - verified > (input.staleAfterMs ?? CONNECTION_VERIFIED_FRESH_MS)) return 'attention'
  return 'working'
}

const TONE: Record<ConnectionState, string> = {
  working: CHIP_TONE.okSubtle,
  attention: CHIP_TONE.warnSubtle,
  expiring: CHIP_TONE.warnSubtle,
  not_connected: CHIP_TONE.neutral,
  checking: CHIP_TONE.neutral,
}

const DOT: Record<ConnectionState, string> = {
  working: 'bg-ok',
  attention: 'bg-warn',
  expiring: 'bg-warn',
  not_connected: 'bg-fg-faint',
  checking: 'bg-fg-faint',
}

function defaultLabel(state: ConnectionState, expiresAt: string | null | undefined): string {
  switch (state) {
    case 'working':
      return 'Working'
    case 'attention':
      return 'Needs attention'
    case 'expiring': {
      const d = daysUntil(expiresAt)
      return d == null ? 'Expires soon' : `Expires in ${d} day${d === 1 ? '' : 's'}`
    }
    case 'not_connected':
      return 'Not connected'
    case 'checking':
      return 'Not checked yet'
  }
}

export function ConnectionStatus({ state, label, detail, expiresAt, action, className = '' }: ConnectionStatusProps) {
  const text = label ?? defaultLabel(state, expiresAt)
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 ${className}`} data-connection-state={state}>
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ${TONE[state]}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${DOT[state]}`} aria-hidden />
        {text}
      </span>
      {detail ? <span className="text-2xs text-fg-secondary leading-snug min-w-0">{detail}</span> : null}
      {action ? (
        <Btn
          size="sm"
          variant={state === 'not_connected' ? 'primary' : 'ghost'}
          to={action.to}
          onClick={action.onClick}
          type={action.to ? undefined : 'button'}
        >
          {action.label}
        </Btn>
      ) : null}
    </div>
  )
}
