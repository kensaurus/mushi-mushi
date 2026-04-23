/**
 * FILE: apps/admin/src/components/ChartActionsMenu.tsx
 * PURPOSE: Tiny kebab menu that every chart across the Advanced-mode
 *          pages renders in its top-right corner. Turns a passive chart
 *          into something the operator can act on without leaving the
 *          page — export CSV, copy a saved filter link, or jump to the
 *          filtered queue that powers the chart.
 *
 *          All CTAs are optional. Pass only what the chart can support.
 *          If no CTAs are supplied the menu renders nothing — so it's
 *          safe to drop into shared chart shells without blank UI.
 *
 *          Wave R (2026-04-22).
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

export interface ChartActionsMenuProps {
  /** Short aria label identifying which chart the menu belongs to. */
  label: string
  /** Hand back a `Blob` (or string) to download. Caller decides file name via `exportFilename`. */
  onExportCsv?: () => string | Blob
  /** File name for the CSV download. Defaults to `<label>-<yyyy-mm-dd>.csv`. */
  exportFilename?: string
  /** Optional deep-link to the filtered queue/report backing this chart. */
  openFilterTo?: string
  /** Optional label for the filter link. Defaults to "Open filtered queue". */
  openFilterLabel?: string
  /** Optional: copy this URL/query string to the clipboard so the user
   *  can paste it into Slack or an email. The "Copy saved filter link"
   *  menu item only renders when this is a non-empty string — an
   *  undefined or empty value hides the action entirely (it would have
   *  nothing useful to copy otherwise). */
  savedFilterHref?: string
  /** Extra menu items the caller wants to add (e.g. "Pin to dashboard"). */
  extraItems?: Array<{ label: string; onClick: () => void }>
}

export function ChartActionsMenu(props: ChartActionsMenuProps) {
  const {
    label,
    onExportCsv,
    exportFilename,
    openFilterTo,
    openFilterLabel,
    savedFilterHref,
    extraItems = [],
  } = props

  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const hasAnyAction =
    !!onExportCsv || !!openFilterTo || !!savedFilterHref || extraItems.length > 0
  if (!hasAnyAction) return null

  const handleExport = () => {
    if (!onExportCsv) return
    try {
      const out = onExportCsv()
      const blob = typeof out === 'string' ? new Blob([out], { type: 'text/csv' }) : out
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        exportFilename ?? `${label.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      // Defer revocation: some browsers (notably older Safari) start the
      // blob download on the next tick after `a.click()`. Revoking the
      // object URL synchronously can race the download and produce an
      // empty file. A short timeout is safe, cheap, and matches the
      // pattern used in filesaver.js and the MDN download recipe.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } finally {
      setOpen(false)
    }
  }

  const handleCopySavedFilter = async () => {
    // Render guard below ensures `savedFilterHref` is a non-empty
    // string before this button exists — no fallback needed.
    if (!savedFilterHref) return
    try {
      await navigator.clipboard.writeText(savedFilterHref)
    } finally {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${label} actions`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center justify-center h-5 w-5 rounded-sm text-fg-faint hover:text-fg-secondary hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-3.5 w-3.5">
          <circle cx="4" cy="10" r="1.2" fill="currentColor" />
          <circle cx="10" cy="10" r="1.2" fill="currentColor" />
          <circle cx="16" cy="10" r="1.2" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`${label} actions menu`}
          className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-sm border border-edge bg-surface-root shadow-raised py-1"
        >
          {onExportCsv && (
            <button
              type="button"
              role="menuitem"
              onClick={handleExport}
              className="w-full text-left px-2.5 py-1 text-xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
            >
              Export CSV
            </button>
          )}
          {savedFilterHref && (
            <button
              type="button"
              role="menuitem"
              onClick={handleCopySavedFilter}
              className="w-full text-left px-2.5 py-1 text-xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
            >
              Copy saved filter link
            </button>
          )}
          {openFilterTo && (
            <Link
              role="menuitem"
              to={openFilterTo}
              onClick={() => setOpen(false)}
              className="block px-2.5 py-1 text-xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
            >
              {openFilterLabel ?? 'Open filtered queue'}
            </Link>
          )}
          {extraItems.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                item.onClick()
                setOpen(false)
              }}
              className="w-full text-left px-2.5 py-1 text-xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
