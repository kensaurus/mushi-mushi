/**
 * FILE: ReadoutPanel.tsx
 * PURPOSE: The shell of every page "readout" (API endpoints, raw signals,
 *          project ref): a closed "Developer details" disclosure at the foot
 *          of the page.
 *
 * Each readout used to open as a full Section near the top of its page and
 * repeat the page's own counts next to raw endpoint URLs, so the first screen
 * of 36 pages led with plumbing. The details stay one click away for whoever
 * wires CI or files a support ticket (owner review, 2026-10-08).
 */

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DisclosurePanel, FreshnessPill, type SectionFreshness } from '../ui'

/** Layout renders an element with this id after the page; readouts portal into it. */
export const PAGE_FOOT_SLOT_ID = 'page-foot-slot'

export function ReadoutPanel({
  title,
  freshness,
  children,
}: {
  /** The readout's own name, e.g. "Repo readout"; shown after "Developer details". */
  title: string
  freshness?: SectionFreshness
  /** Accepted for call-site compatibility with Section; the panel has its own chevron. */
  icon?: ReactNode
  /** Accepted for call-site compatibility with Section. */
  className?: string
  /** Accepted for call-site compatibility with Section. */
  action?: ReactNode
  children: ReactNode
}) {
  // Portal into Layout's page-foot slot: order-last only moved the panel inside a
  // flex stack, so on Home it sat mid-page (2026-10-08). Inline when there is no
  // slot (tests, pages rendered outside Layout).
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setSlot(document.getElementById(PAGE_FOOT_SLOT_ID))
  }, [])
  const panel = (
    <DisclosurePanel
      title={
        <span className="text-xs font-medium text-fg-secondary">
          Developer details{' '}
          <span className="font-normal text-fg-muted">
            · {title.replace(/\s*readout$/i, '')} endpoints and raw signals
          </span>
        </span>
      }
      trailing={freshness ? <FreshnessPill {...freshness} /> : undefined}
    >
      {children}
    </DisclosurePanel>
  )
  return slot ? createPortal(panel, slot) : <div className="order-last">{panel}</div>
}
