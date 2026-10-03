'use client'

/**
 * Shows the public diagram instead of the 404 when the browser is on
 * /…/r/<owner>/<repo> (see app/not-found.tsx). Decided after mount: the
 * static 404 HTML is the same for every missing path.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { isDiagramPath } from '@/lib/public-diagram'
import { PublicDiagramClient } from './PublicDiagramClient'

export function DiagramPathFallback({ children }: { children: ReactNode }) {
  const [onDiagramPath, setOnDiagramPath] = useState(false)
  useEffect(() => {
    setOnDiagramPath(isDiagramPath(window.location.pathname))
  }, [])
  return onDiagramPath ? <PublicDiagramClient /> : <>{children}</>
}
