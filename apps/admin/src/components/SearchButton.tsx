/**
 * FILE: apps/admin/src/components/SearchButton.tsx
 * PURPOSE: Compact header trigger for the command palette. Shows the
 *          Cmd/Ctrl+K affordance so the shortcut is discoverable —
 *          palettes that hide behind an undocumented hotkey never get
 *          used, no matter how good they are.
 */

import { useEffect, useState } from 'react'
import { useCommandPalette } from '../lib/useCommandPalette'
import { Kbd } from './ui'

function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = (navigator.platform || '').toLowerCase()
  const ua = (navigator.userAgent || '').toLowerCase()
  return platform.includes('mac') || ua.includes('mac os')
}

export function SearchButton() {
  const { open } = useCommandPalette()
  // Detected inside an effect so SSR/hydration produces a stable first
  // render regardless of platform.
  const [isMac, setIsMac] = useState(false)
  useEffect(() => {
    setIsMac(detectIsMac())
  }, [])

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open command palette"
      className="inline-flex items-center justify-center gap-1.5 h-8 w-8 xl:w-auto xl:min-w-36 xl:justify-start rounded-sm border border-edge-subtle px-0 xl:px-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 shrink-0"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3.5 w-3.5 text-fg-faint"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3-3" strokeLinecap="round" />
      </svg>
      <span className="hidden xl:inline">Search</span>
      <span className="hidden xl:flex ml-auto items-center gap-0.5 text-2xs text-fg-muted">
        <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  )
}
