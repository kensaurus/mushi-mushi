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

const TONE_TEXT: Record<HealthTone | 'loading', string> = {
  loading: 'text-fg-faint',
  idle: 'text-fg-faint',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
}

export function SidebarHealthDot({ tone, count, label, hideWhenZero = false }: Props) {
  if (hideWhenZero && (count ?? 0) === 0) return null
  const showCount = typeof count === 'number' && count > 0
  return (
    <span
      aria-label={label}
      title={label}
      className="ml-auto inline-flex items-center gap-1 text-2xs font-medium"
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {showCount && (
        <span className={TONE_TEXT[tone]}>{count! > 99 ? '99+' : count}</span>
      )}
    </span>
  )
}
