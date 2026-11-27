/**
 * FILE: apps/admin/src/components/SidebarHealthDot.tsx
 * PURPOSE: Tiny coloured indicator pill surfaced next to sidebar nav links.
 *          Generalises the pattern from IntegrationHealthDot so every
 *          PDCA tab can tell the user at a glance whether it needs
 *          attention before they click.
 *
 *          The component is intentionally decorative: the tooltip is the
 *          real affordance (screen readers announce the aria-label; the
 *          dot's colour is redundant). Dots never block navigation.
 */

import type { HealthTone } from '../lib/useNavCounts'
import { CountBadge, type BadgeTone } from './ui/layout'

interface Props {
  /** Health tone. 'idle' renders a muted dot (no issues, no action). */
  tone: HealthTone | 'loading'
  /** Optional count to render as a tiny numeric badge after the dot. */
  count?: number | null
  /** Descriptive label used for aria + tooltip, e.g. "3 failed fixes". */
  label: string
  /** If true, hide the dot when count === 0 so the sidebar stays quiet
   *  on healthy tabs. Defaults to false — explicit green is often the
   *  friendlier choice for a PDCA dashboard. */
  hideWhenZero?: boolean
}

const TONE_DOT: Record<HealthTone | 'loading', string> = {
  loading: 'bg-fg-faint/40',
  idle: 'bg-fg-faint/50',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
}

/** A count is a CountBadge in the tone (fill + edge), not coloured digits. */
const TONE_BADGE: Record<HealthTone | 'loading', BadgeTone> = {
  loading: 'neutral',
  idle: 'neutral',
  ok: 'ok',
  warn: 'warn',
  danger: 'danger',
}

export function SidebarHealthDot({ tone, count, label, hideWhenZero = false }: Props) {
  if (hideWhenZero && (count ?? 0) === 0) return null
  const showCount = typeof count === 'number' && count > 0
  if (showCount) return <CountBadge count={count!} tone={TONE_BADGE[tone]} label={label} className="ml-auto" />
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="ml-auto inline-flex items-center"
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} />
    </span>
  )
}
