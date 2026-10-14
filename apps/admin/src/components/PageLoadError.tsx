/**
 * FILE: apps/admin/src/components/PageLoadError.tsx
 * PURPOSE: Canonical page/panel load-failure surface. Turns the raw
 *          `usePageData` error string into a human title + hint + recovery
 *          action via humanizeApiError, rendered through ErrorAlert. The
 *          error code, endpoint, request id and raw server text sit in a
 *          collapsed "Details" for support (NN/g: hide codes except for
 *          diagnostics), never in the sentence the user reads.
 */

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorAlert } from './ui'
import { humanizeApiError, parsePageDataError } from '../lib/humanizeApiError'

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

  // The server's own sentence without the "(CODE)" suffix usePageData adds.
  const serverText = parsePageDataError(humanized.raw)?.message ?? null
  const details = [
    humanized.code ? `Code: ${humanized.code}` : null,
    endpoint ? `Endpoint: ${endpoint}` : null,
    requestId ? `Request: ${requestId}` : null,
    serverText && serverText !== humanized.hint ? `Server said: ${serverText}` : null,
  ].filter((line): line is string => line != null)

  return (
    <div ref={headingRef} tabIndex={-1} className="outline-none">
      <ErrorAlert
        title={title}
        message={humanized.hint}
        onRetry={onRetry}
        actions={actions.length > 0 ? actions : undefined}
      >
        {details.length > 0 ? (
          <details className="text-2xs text-danger/80">
            <summary className="cursor-pointer select-none">Details</summary>
            <ul className="mt-1 space-y-0.5 font-mono break-all">
              {details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </ErrorAlert>
    </div>
  )
}
