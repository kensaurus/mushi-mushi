/**
 * FILE: apps/admin/src/components/motion/MotionSegmentedControl.tsx
 * PURPOSE: Segmented control with sliding Framer pill (MicroSegmentedTrack).
 */

import type { SegmentedControlOption } from '../ui/forms'
import { MicroSegmentCell, MicroSegmentedTrack } from '../sidebar/MicroSegmentedTrack'
import { microSegActive, MICRO_SEG } from '../sidebar/SidebarMicroChrome'

export interface MotionSegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedControlOption<T>[]
  onChange: (next: T) => void
  trackId: string
  ariaLabel?: string
  size?: 'sm' | 'md'
  className?: string
}

const SEGMENT_SIZE = {
  sm: 'px-1.5 py-0.5 text-2xs',
  md: 'px-2 py-1 text-2xs font-medium',
} as const

export function MotionSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  trackId,
  ariaLabel,
  size = 'md',
  className = '',
}: MotionSegmentedControlProps<T>) {
  return (
    <MicroSegmentedTrack
      trackId={trackId}
      role="radiogroup"
      aria-label={ariaLabel}
      className={className}
    >
      {options.map((opt) => {
        const active = opt.id === value
        return (
          <MicroSegmentCell key={opt.id} active={active}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.id)}
              className={`${MICRO_SEG} ${SEGMENT_SIZE[size]} ${microSegActive(active)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60`}
            >
              {opt.label}
              {opt.count !== undefined && (
                <span className={`ml-1 font-mono ${active ? 'text-brand-fg/80' : 'text-fg-faint'}`}>
                  {opt.count}
                </span>
              )}
            </button>
          </MicroSegmentCell>
        )
      })}
    </MicroSegmentedTrack>
  )
}
