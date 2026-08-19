/**
 * FILE: apps/admin/src/components/sidebar/NavRailFlyout.tsx
 * PURPOSE: Body of the hover / focus flyout used by the collapsed sidebar rail.
 *
 * An icon-only rail shows no labels, so this panel is where the destination
 * actually gets explained: its name, the plain-English one-liner from
 * navRegistry's `paletteDescription`, and the same live count the rail badge is
 * showing. Rendered as Tooltip `content`, so it inherits the shared primitive's
 * portal, side-flipping, and viewport clamping — no new popover machinery.
 *
 * Everything here is inline-level (`span`) because Tooltip renders its content
 * inside a `<span role="tooltip">`.
 */

import type { HealthTone } from '../../lib/useNavCounts'

const TONE_DOT: Record<HealthTone, string> = {
  idle: 'bg-fg-faint',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
}

export interface NavRailFlyoutProps {
  /** Nav label — the accessible name the rail icon stands in for. */
  title: string
  /** Plain-English explanation. */
  description?: string | null
  /** Live context, e.g. "3 untriaged reports". */
  status?: { tone: HealthTone; label: string } | null
  /** Trailing chip — PDCA stage letter, or a plan gate like "Pro". */
  kicker?: { label: string; className: string } | null
  /** Foot note for keyboard affordances, e.g. "Press [ to expand". */
  hint?: string | null
}

/**
 * Type scale is deliberate: the Tooltip surface is `text-2xs`, so the title
 * steps up one notch to `text-xs` and the description stays at body size. That
 * single step is enough to read as a heading without turning a nav hint into a
 * card.
 */
export function NavRailFlyout({
  title,
  description,
  status,
  kicker,
  hint,
}: NavRailFlyoutProps) {
  return (
    <span className="block text-left">
      <span className="flex items-baseline gap-2">
        <span className="text-xs font-semibold leading-tight text-fg">{title}</span>
        {kicker && (
          <span
            className={`ml-auto shrink-0 rounded-xs px-1 py-px text-3xs font-bold uppercase leading-none tracking-wide ${kicker.className}`}
          >
            {kicker.label}
          </span>
        )}
      </span>
      {description && (
        <span className="mt-1 block text-2xs leading-relaxed text-fg-muted">
          {description}
        </span>
      )}
      {status && (
        <span className="mt-1.5 flex items-center gap-1.5 border-t border-edge-subtle pt-1.5 text-2xs font-medium text-fg-secondary">
          <span
            aria-hidden="true"
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`}
          />
          <span>{status.label}</span>
        </span>
      )}
      {hint && <span className="mt-1.5 block text-2xs text-fg-faint">{hint}</span>}
    </span>
  )
}
