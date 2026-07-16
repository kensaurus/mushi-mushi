/**
 * FILE: apps/admin/src/components/flow-primitives/StageDrawer.tsx
 * PURPOSE: Accessible right-side drawer opened when the user clicks a PDCA
 *          stage node. Thin wrapper around the shared `<Drawer>` primitive
 *          with PDCA-specific chrome (stage accent badge, subtitle, mobile
 *          bottom-sheet rounding).
 *
 *          Parent controls `open`. Focus trap, Esc-close, and backdrop
 *          dismiss are inherited from `Drawer.tsx`.
 */

import type { ReactNode } from 'react'
import { Drawer } from '../Drawer'
import { stageDrawerBelowAppChromeClass } from '../../lib/appChrome'

interface StageDrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Tone chip rendered beside the title — e.g. P/D/C/A letter badge. */
  titleAccent?: ReactNode
  /** Compact "what is this stage" copy under the title. */
  subtitle?: string
  /** Bottom footer; use for primary action buttons. */
  footer?: ReactNode
  children: ReactNode
  /** Extra classes on the sliding panel. */
  className?: string
}

export function StageDrawer({
  open,
  onClose,
  title,
  titleAccent,
  subtitle,
  footer,
  children,
  className = '',
}: StageDrawerProps) {
  const titleNode = (
    <div className="flex items-start gap-2 min-w-0">
      {titleAccent}
      <div className="min-w-0">
        {typeof title === 'string' ? (
          <h3 className="text-sm font-semibold text-fg leading-tight truncate">{title}</h3>
        ) : (
          title
        )}
        {subtitle && (
          <p className="text-2xs text-fg-muted mt-0.5 leading-snug line-clamp-2">{subtitle}</p>
        )}
      </div>
    </div>
  )

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={titleNode}
      footer={footer}
      width="md"
      containerClassName={stageDrawerBelowAppChromeClass}
      panelClassName={[
        'rounded-t-lg sm:rounded-none sm:rounded-l-lg border-edge/70 max-h-[92dvh] sm:max-h-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="px-4 py-3">{children}</div>
    </Drawer>
  )
}
