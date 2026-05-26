/**
 * FILE: apps/admin/src/components/reports/DispatchPreflightBanner.tsx
 * PURPOSE: Surfaced above <RecommendedAction> on dispatch-eligible report
 *          detail pages. Tells the user *before* they click "Queue fix" that
 *          a prerequisite is missing — so they don't open the popover, read
 *          "Resolve prerequisites first", close it, and go hunting.
 *
 *          Reads from `useDispatchPreflight()` (already mounted on
 *          ReportsPage / ReportDetailPage) via a prop so we don't issue a
 *          second fetch per page load.
 */

import { useNavigate } from 'react-router-dom'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import { Btn } from '../ui'

interface Props {
  preflight: PreflightState
  className?: string
}

const CHECK_ICONS: Record<string, string> = {
  github: '🔗',
  codebase: '📂',
  anthropic: '🔑',
  autofix: '⚡',
}

const CHECK_FIX_LABELS: Record<string, string> = {
  github: 'Connect GitHub \u2192',
  codebase: 'Index codebase \u2192',
  anthropic: 'Add Anthropic key \u2192',
  autofix: 'Enable autofix \u2192',
}

const EM_DASH = '\u2014'
const RIGHT_ARROW = '\u2192'

export function DispatchPreflightBanner({ preflight, className = '' }: Props) {
  const navigate = useNavigate()

  // Don't render: loading, no problems, or we couldn't reach the preflight API
  if (preflight.loading) return null
  if (preflight.ready) return null
  if (preflight.error) return null

  const failing = preflight.failing
  if (failing.length === 0) return null

  return (
    <div
      role="alert"
      aria-label="Auto-fix prerequisites"
      className={`rounded-lg border border-warn/30 bg-warn/5 px-3 py-3 ${className}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="mt-0.5 text-warn text-base leading-none shrink-0">
          ⚠
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-warn leading-tight">
            Auto-fix is paused — {failing.length === 1 ? '1 prerequisite' : `${failing.length} prerequisites`} missing
          </p>
          <p className="text-2xs text-fg-muted mt-0.5 leading-snug">
            Resolve the item{failing.length > 1 ? 's' : ''} below before dispatching.
            The Queue button will remain disabled until all checks pass.
          </p>

          <div className="mt-2 space-y-1.5">
            {failing.map((check) => (
              <div key={check.key} className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span aria-hidden="true" className="mt-px shrink-0">
                    {CHECK_ICONS[check.key] ?? '•'}
                  </span>
                  <div className="min-w-0">
                    <span className="text-2xs font-medium text-fg-secondary">{check.label}</span>
                    <span className="text-2xs text-fg-muted ml-1">{EM_DASH} {check.hint}</span>
                  </div>
                </div>
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (check.fixHref.startsWith('http')) {
                      window.open(check.fixHref, '_blank', 'noreferrer')
                    } else {
                      navigate(check.fixHref)
                    }
                  }}
                  className="shrink-0 text-2xs"
                >
                  {CHECK_FIX_LABELS[check.key] ?? `Fix this ${RIGHT_ARROW}`}
                </Btn>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
