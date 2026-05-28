/**
 * FILE: apps/admin/src/components/PrivacyPostureBadge.tsx
 * PURPOSE: Tiny sidebar chip that shows the project's current privacy posture.
 *          Green = "All systems BYOK" (every LLM call runs under the project's
 *          own API key). Yellow = "Platform key in use" (at least one LLM
 *          pipeline is using the Mushi-platform Anthropic/OpenAI key).
 *
 *          Clicking the chip opens a small popover with the full posture detail
 *          (storage host, LLM provider, region, retention window, last audit).
 *          The popover CTA links to Settings → BYOK to resolve the issue.
 */

import { useRef } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { Tooltip } from './ui'

interface PrivacyStatus {
  byok_configured: boolean
  llm_provider?: 'byok' | 'platform' | string
  storage_provider: string | null
  region: string | null
  retention_days: number | null
  last_audit_at: string | null
  require_byok?: boolean
}

interface Props {
  /** Collapse to icon-only when sidebar is collapsed */
  compact?: boolean
}

export function PrivacyPostureBadge({ compact = false }: Props) {
  const { data, loading, error, reload } = usePageData<PrivacyStatus>('/v1/admin/privacy-status')

  const [popoverOpen, setPopoverOpen] = useState(false)
  const badgeRef = useRef<HTMLButtonElement>(null)

  if (loading) return null

  const isByok = data?.byok_configured ?? false
  const label = error
    ? 'Privacy status unavailable'
    : isByok
      ? 'All systems BYOK'
      : 'Platform key in use'
  const dotClass = error ? 'bg-danger' : isByok ? 'bg-ok' : 'bg-warn'
  const textClass = error ? 'text-danger' : isByok ? 'text-ok' : 'text-warn'

  const tooltipContent = error
    ? 'Could not load privacy posture. Open BYOK settings or retry.'
    : isByok
      ? 'All LLM calls run under your own API key — your data never transits the Mushi platform account.'
      : 'At least one pipeline is using the Mushi platform API key. Configure BYOK in Settings to keep your data in your own LLM account. Click for details.'

  if (compact) {
    return (
      <Tooltip content={tooltipContent} side="right" portal>
        <Link
          to="/settings?panel=byok"
          className="flex items-center justify-center p-2 rounded-sm hover:bg-surface-raised transition-colors"
          aria-label={label}
        >
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
        </Link>
      </Tooltip>
    )
  }

  return (
    <div className="relative">
      <Tooltip content={tooltipContent} side="right" portal>
        <button
          ref={badgeRef}
          type="button"
          className="flex items-center gap-1.5 w-full px-2 py-1 rounded-sm hover:bg-surface-raised transition-colors"
          aria-label={`${label} — click for privacy details`}
          onClick={() => setPopoverOpen((v) => !v)}
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
          <span className={`text-3xs font-medium truncate ${textClass}`}>{label}</span>
        </button>
      </Tooltip>

      {popoverOpen && (
        <div
          className="absolute bottom-full left-0 mb-1 w-60 bg-surface-raised border border-edge rounded-md shadow-lg p-3 space-y-2 z-50 text-2xs"
          role="dialog"
          aria-label="Privacy posture details"
        >
          <button
            type="button"
            className="absolute top-1.5 right-1.5 rounded-sm px-1 text-danger hover:bg-danger-muted/50 text-xs leading-none"
            onClick={() => setPopoverOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
          <p className="font-semibold text-fg text-xs">Privacy posture</p>

          {error ? (
            <p className="text-danger leading-snug">{error}</p>
          ) : (
            <div className="space-y-1 text-fg-muted">
              <div className="flex justify-between">
                <span>LLM provider</span>
                <span className={`font-mono ${isByok ? 'text-ok' : 'text-warn'}`}>
                  {data?.llm_provider === 'byok' || isByok ? 'BYOK' : 'platform'}
                </span>
              </div>
              {data?.storage_provider && (
                <div className="flex justify-between">
                  <span>Storage</span>
                  <span className="font-mono text-fg-secondary">{data.storage_provider}</span>
                </div>
              )}
              {data?.region && (
                <div className="flex justify-between">
                  <span>Region</span>
                  <span className="font-mono text-fg-secondary">{data.region}</span>
                </div>
              )}
              {data?.retention_days != null && (
                <div className="flex justify-between">
                  <span>Retention</span>
                  <span className="font-mono text-fg-secondary">{data.retention_days}d</span>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/settings?panel=byok"
              className="text-2xs text-brand underline hover:no-underline"
              onClick={() => setPopoverOpen(false)}
            >
              {isByok ? 'View BYOK settings →' : 'Configure BYOK →'}
            </Link>
            {error && (
              <button
                type="button"
                className="text-2xs text-danger underline hover:no-underline"
                onClick={() => {
                  reload()
                  setPopoverOpen(false)
                }}
              >
                Retry
              </button>
            )}
          </div>

          {data?.last_audit_at && (
            <p className="text-fg-faint text-3xs">
              Last audited {new Date(data.last_audit_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
