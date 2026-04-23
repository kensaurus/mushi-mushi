/**
 * FILE: apps/admin/src/components/StagedChangesBanner.tsx
 * PURPOSE: Wave T.3.6 — thin, sticky banner shown below the filter rail
 *          when realtime INSERT events are staged waiting for the user to
 *          apply them. Pairs with `useStagedRealtime`.
 *
 * DESIGN NOTES:
 *   - Brand-toned strip, not a toast — the state is durable until the user
 *     acts, and it lives in-page below the filters where the scroll
 *     position is already anchored.
 *   - Two actions: "Apply" (flush buffer + reload) and "Discard" (reset
 *     count without reload; the banner hides).
 *   - `aria-live="polite"` so screen-reader users get a lightweight
 *     announcement ("3 new rows available") without interrupting.
 */

import { memo } from 'react'

interface StagedChangesBannerProps {
  count: number
  onApply: () => void
  onDiscard: () => void
  /** Label for the noun being staged — defaults to "new row". Use
   *  "report", "fix", etc. for clarity in screen readers. */
  noun?: string
  className?: string
}

function StagedChangesBannerInner({
  count,
  onApply,
  onDiscard,
  noun = 'new row',
  className = '',
}: StagedChangesBannerProps) {
  if (count <= 0) return null
  const nounPlural = count === 1 ? noun : `${noun}s`
  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={`${count} ${nounPlural} available`}
      className={`sticky top-0 z-10 mb-2 flex items-center gap-2 rounded-sm border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs backdrop-blur motion-safe:animate-mushi-fade-in ${className}`}
    >
      <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-brand mushi-pulse" />
      <span className="text-fg">
        <strong className="font-semibold tabular-nums">{count}</strong>{' '}
        <span className="text-fg-secondary">{nounPlural} available</span>
      </span>
      <span aria-hidden="true" className="text-fg-faint">·</span>
      <button
        type="button"
        onClick={onApply}
        className="text-2xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-sm"
      >
        Apply
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="text-2xs text-fg-muted hover:text-fg-secondary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-sm"
      >
        Discard
      </button>
    </div>
  )
}

export const StagedChangesBanner = memo(StagedChangesBannerInner)
