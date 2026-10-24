'use client'

/**
 * FILE: apps/docs/components/KeyboardScrollRegions.tsx
 * PURPOSE: After layout, give overflowing docs tables, code, and lists a tab stop.
 *
 * Mounted once from the root layout. Re-runs on navigation and viewport
 * resize so the mobile table rule (max-width 767px) is picked up when the
 * window crosses that breakpoint.
 */

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { syncKeyboardScrollRegions } from '../lib/keyboard-scroll-region'

export function KeyboardScrollRegions() {
  const pathname = usePathname()
  useEffect(() => {
    const run = () => syncKeyboardScrollRegions(document)
    run()
    const frame = window.requestAnimationFrame(run)
    window.addEventListener('resize', run)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', run)
    }
  }, [pathname])
  return null
}
