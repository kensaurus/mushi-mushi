'use client'

/**
 * Once-in-view row stagger for the Sentry comparison table (no scroll scrub).
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { animate, stagger, useReducedMotion } from 'motion/react'

interface ComparisonScrubProps {
  children: ReactNode
}

export function ComparisonScrub({ children }: ComparisonScrubProps) {
  const reducedMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (reducedMotion || !rootRef.current) return

    const root = rootRef.current
    const rows = root.querySelectorAll<HTMLElement>(
      'tbody tr, .docs-comparison-row, table tr',
    )
    if (!rows.length) return

    for (const row of rows) {
      row.style.opacity = '0.2'
      row.style.transform = 'translateX(-8px)'
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        animate(
          rows,
          { opacity: 1, x: 0 },
          {
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
            delay: stagger(0.06),
          },
        )
      },
      { rootMargin: '0px 0px -20% 0px', threshold: 0.1 },
    )
    io.observe(root)

    return () => {
      io.disconnect()
      for (const row of rows) {
        row.style.opacity = ''
        row.style.transform = ''
      }
    }
  }, [reducedMotion])

  return (
    <div ref={rootRef} className="landing-comparison-scrub">
      {children}
    </div>
  )
}
