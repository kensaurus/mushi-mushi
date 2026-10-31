'use client'

/**
 * Shows a Production Check report instead of the 404 when the browser is on
 * /…/check/<uuid> (see app/not-found.tsx). The shared and emailed link is
 * /check?id=<uuid>; this keeps the path form working too.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { isCheckReportPath } from '@/lib/production-check'
import { CheckClient } from './CheckClient'

export function CheckPathFallback({ children }: { children: ReactNode }) {
  const [onReportPath, setOnReportPath] = useState(false)
  useEffect(() => {
    setOnReportPath(isCheckReportPath(window.location.pathname))
  }, [])
  return onReportPath ? <CheckClient /> : <>{children}</>
}
