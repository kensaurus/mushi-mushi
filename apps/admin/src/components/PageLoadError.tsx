/**
 * FILE: apps/admin/src/components/PageLoadError.tsx
 * PURPOSE: Canonical page/panel load-failure surface. Turns the raw
 *          `usePageData` error string into a human title + hint + recovery
 *          action via humanizeApiError, rendered through ErrorAlert.
 */

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorAlert } from './ui'
import { humanizeApiError } from '../lib/humanizeApiError'

interface PageLoadErrorProps {
  error: string | null | undefined
  /** Explicit API code when available (preferred over parsing the string). */
  code?: string | null
  onRetry?: () => void
  /** Optional short label of what failed, e.g. "portfolio". */
  resource?: string
  /** Failing endpoint path for provenance captions. */
  endpoint?: string | null
  /** Correlation id for support / Sentry / Langfuse greps. */
  requestId?: string | null
}

export function PageLoadError({
  error,
  code,
  onRetry,
  resource,
  endpoint,
  requestId,
}: PageLoadErrorProps) {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLDivElement>(null)
  const humanized = humanizeApiError(error, code)

  useEffect(() => {
    if (!humanized) return
    // Move focus to the alert so keyboard / AT users notice the failure
    // without hunting for a red bar that never announced itself.
    headingRef.current?.focus()
  }, [humanized?.title, humanized?.code])

  if (!humanized) return null

  const actions: Array<{ label: string; onClick: () => void }> = []
  if (humanized.action) {
    const { target, label } = humanized.action
    if (target.kind === 'route') {
      actions.push({
        label,
        onClick: () => {
          const url = target.hash ? `${target.to}#${target.hash}` : target.to
          navigate(url)
        },
      })
    } else if (target.kind === 'external') {
      actions.push({
        label,
        onClick: () => window.open(target.url, '_blank', 'noopener,noreferrer'),
      })
    }
    // `retry` is handled by onRetry on ErrorAlert — avoid duplicate buttons
  }

  const title = resource
    ? `Couldn't load ${resource}`
    : humanized.title

  return (
    <div ref={headingRef} tabIndex={-1} className="outline-none">
      <ErrorAlert
        title={title}
        message={humanized.hint}
        code={humanized.code}
        endpoint={endpoint ?? undefined}
        requestId={requestId ?? undefined}
        onRetry={onRetry}
        actions={actions.length > 0 ? actions : undefined}
      />
    </div>
  )
}
