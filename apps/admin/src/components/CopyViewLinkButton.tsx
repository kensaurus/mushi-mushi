/**
 * FILE: apps/admin/src/components/CopyViewLinkButton.tsx
 * PURPOSE: One-click share for the current filtered admin view.
 *
 * Now an icon-only affordance (link glyph + copy semantics) so the
 * action bar reads as a row of consistent 28×28 chrome buttons rather
 * than a wide "Copy view" pill that wraps on narrower viewports. The
 * tooltip still surfaces the meaning ("Copy view link") and we flip to
 * a check + green tone for ~1.5s on success — same visual language as
 * the rest of the admin's copy buttons.
 */

import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useToast } from '../lib/toast'
import { Tooltip } from './ui'

function currentViewUrl(location: ReturnType<typeof useLocation>): string {
  const relative = `${location.pathname}${location.search}${location.hash}`
  return new URL(`${import.meta.env.BASE_URL.replace(/\/$/, '')}${relative}`, window.location.origin).toString()
}

export function CopyViewLinkButton() {
  const location = useLocation()
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const url = currentViewUrl(location)
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
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-edge-subtle bg-surface-raised/60 shadow-card motion-safe:transition-colors hover:border-brand/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
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
      </button>
    </Tooltip>
  )
}
