'use client'

import { useEffect, useState } from 'react'

/** SSR-safe reduced-motion preference. Defaults to `true` until mounted so
 *  heavy motion never flashes on for users who opted out. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}
