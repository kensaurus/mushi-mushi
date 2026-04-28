/**
 * FILE: apps/admin/src/components/CopyViewLinkButton.tsx
 * PURPOSE: One-click share for the current filtered admin view.
 */

import { useLocation } from 'react-router-dom'
import { useToast } from '../lib/toast'

function currentViewUrl(location: ReturnType<typeof useLocation>): string {
  const relative = `${location.pathname}${location.search}${location.hash}`
  return new URL(`${import.meta.env.BASE_URL.replace(/\/$/, '')}${relative}`, window.location.origin).toString()
}

export function CopyViewLinkButton() {
  const location = useLocation()
  const toast = useToast()

  const copy = async () => {
    const url = currentViewUrl(location)
    try {
      await navigator.clipboard.writeText(url)
      toast.success('View link copied', 'Filters, project scope, and focus state are encoded in the URL.')
    } catch {
      toast.error('Could not copy link', url)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border border-edge-subtle bg-surface-raised/60 px-2.5 py-1.5 text-2xs font-medium text-fg-muted shadow-card motion-safe:transition-colors hover:border-brand/35 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      Copy view
    </button>
  )
}
