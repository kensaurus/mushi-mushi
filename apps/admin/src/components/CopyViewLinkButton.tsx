/**
 * FILE: apps/admin/src/components/CopyViewLinkButton.tsx
 * PURPOSE: One-click share for the current filtered admin view.
 *
 * A compact 28px-tall chrome button: link glyph plus a short visible
 * "Copy link" label (an icon alone did not say what it does; Mushi report
 * 3d5c1f99). The tooltip adds the detail ("Copy link to this filtered
 * view") and we flip to a check + "Copied" in green for ~1.5s on success.
 * `whitespace-nowrap` + `shrink-0` keep the label on one line and the target
 * at full size in crowded headers (the old wide pill wrapped there).
 */

import { useState } from 'react'
import { useToast } from '../lib/toast'
import { currentAdminViewUrl } from '../lib/reportUrl'
import { Tooltip } from './ui'

export function CopyViewLinkButton() {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const url = currentAdminViewUrl()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast.success('View link copied', 'Filters, project scope, and focus state are encoded in the URL.')
    } catch {
      toast.error('Could not copy link', url)
    }
  }

  return (
    <Tooltip content={copied ? 'View link copied' : 'Copy link to this filtered view'}>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'View link copied' : 'Copy link to this filtered view'}
        className={`inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium border border-edge-subtle bg-surface-raised/60 shadow-card motion-safe:transition-opacity hover:border-brand/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
          copied ? 'text-ok hover:text-ok' : 'text-fg-muted hover:text-fg'
        }`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          {copied ? (
            <polyline points="3,8.5 6.5,12 13,4.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              {/* link / share glyph: chain link with an arrow indicating
                  "outbound URL" — communicates "share this view" better
                  than a plain copy rectangle in this context. */}
              <path d="M6.5 9.5L9.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
              <path
                d="M9 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L12.5 8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7 12l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L3.5 8.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}
        </svg>
        <span>{copied ? 'Copied' : 'Copy link'}</span>
      </button>
    </Tooltip>
  )
}
