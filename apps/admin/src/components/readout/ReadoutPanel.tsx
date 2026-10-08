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

import type { ReactNode } from 'react'
import { DisclosurePanel, FreshnessPill, type SectionFreshness } from '../ui'

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
  // order-last: in the page's flex stack the panel sits under the page's own content.
  return (
    <div className="order-last">
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
    </div>
  )
}
