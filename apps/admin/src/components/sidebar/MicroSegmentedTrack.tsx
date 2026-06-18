/**
 * FILE: apps/admin/src/components/sidebar/MicroSegmentedTrack.tsx
 * PURPOSE: Universal sliding-pill segmented control — Framer layoutId + CSS chrome.
 *
 * USAGE:
 * - Wrap segments in `MicroSegmentedTrack` (provides LayoutGroup + track context).
 * - Each option in `MicroSegmentCell` with `active` prop for the sliding indicator.
 * - Child control keeps `MICRO_SEG` + `microSegActive(active)` classes.
 */

import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import {
  createContext,
  useContext,
  type AriaAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { useMotionTransition } from '../../lib/useMotionTransition'
import { microTapScale } from '../../lib/motion-tokens'
import {
  MICRO_SEG_CELL,
  MICRO_TRACK,
  MICRO_TRACK_INLINE,
  MICRO_TRACK_SLIDING,
  MICRO_TRACK_SOLO,
} from './SidebarMicroChrome'

const MicroTrackContext = createContext<string>('')

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ')
}

export function MicroSegmentedTrack({
  trackId,
  sliding = true,
  inline = false,
  solo = false,
  className,
  children,
  ...rest
}: {
  trackId: string
  /** When false, segments use fill-only active state (no sliding pill). */
  sliding?: boolean
  /** Shrink-to-content width (table toolbars). */
  inline?: boolean
  /** Fixed-width single-segment track (sidebar focus toggle). */
  solo?: boolean
  className?: string
  children: ReactNode
} & Pick<HTMLAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'aria-labelledby'> &
  Pick<AriaAttributes, 'aria-label' | 'aria-labelledby'>) {
  const body = (
    <div
      className={cx(
        MICRO_TRACK,
        sliding && MICRO_TRACK_SLIDING,
        inline && MICRO_TRACK_INLINE,
        solo && MICRO_TRACK_SOLO,
        className,
      )}
      data-micro-track={trackId}
      {...rest}
    >
      <MicroTrackContext.Provider value={trackId}>{children}</MicroTrackContext.Provider>
    </div>
  )

  if (!sliding) return body

  return <LayoutGroup id={trackId}>{body}</LayoutGroup>
}

export function MicroSegmentCell({
  active,
  className,
  children,
}: {
  active: boolean
  className?: string
  children: ReactNode
}) {
  const trackId = useContext(MicroTrackContext)
  const layoutTransition = useMotionTransition()
  const reduceMotion = useReducedMotion()

  return (
    <div className={cx(MICRO_SEG_CELL, className)}>
      <motion.div
        className="sidebar-micro-seg-interaction"
        whileTap={reduceMotion ? undefined : { scale: microTapScale }}
      >
        {active && trackId ? (
          <motion.div
            layoutId={`micro-ind-${trackId}`}
            className="sidebar-micro-indicator"
            transition={layoutTransition}
            initial={false}
            aria-hidden
          />
        ) : null}
        <div className="sidebar-micro-seg-content">{children}</div>
      </motion.div>
    </div>
  )
}
