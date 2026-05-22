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
  llm_provider: 'byok' | 'platform' | string
  storage_provider: string | null
  region: string | null
  retention_days: number | null
  last_audit_at: string | null
  require_byok: boolean
}

interface Props {
  /** Collapse to icon-only when sidebar is collapsed */
  compact?: boolean
}

export function PrivacyPostureBadge({ compact = false }: Props) {
  const { data, loading } = usePageData<PrivacyStatus>('/v1/admin/privacy-status')

  const [popoverOpen, setPopoverOpen] = useState(false)
  const badgeRef = useRef<HTMLButtonElement>(null)

  if (loading || !data) return null

  const isByok = data.byok_configured
  const label = isByok ? 'All systems BYOK' : 'Platform key in use'
  const dotClass = isByok ? 'bg-ok' : 'bg-warn'
  const textClass = isByok ? 'text-ok' : 'text-warn'

  const tooltipContent = isByok
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
        {/* Button toggles the detail popover — navigation is inside the popover CTA */}
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
            className="absolute top-1.5 right-1.5 text-fg-faint hover:text-fg text-xs"
            onClick={() => setPopoverOpen(false)}
            aria-label="Close"
          >✕</button>
          <p className="font-semibold text-fg text-xs">Privacy posture</p>

          <div className="space-y-1 text-fg-muted">
            <div className="flex justify-between">
              <span>LLM provider</span>
              <span className={`font-mono ${isByok ? 'text-ok' : 'text-warn'}`}>
                {isByok ? 'BYOK' : 'platform'}
              </span>
            </div>
            {data.storage_provider && (
              <div className="flex justify-between">
                <span>Storage</span>
                <span className="font-mono text-fg-secondary">{data.storage_provider}</span>
              </div>
            )}
            {data.region && (
              <div className="flex justify-between">
                <span>Region</span>
                <span className="font-mono text-fg-secondary">{data.region}</span>
              </div>
            )}
            {data.retention_days != null && (
              <div className="flex justify-between">
                <span>Retention</span>
                <span className="font-mono text-fg-secondary">{data.retention_days}d</span>
              </div>
            )}
          </div>

          <Link
            to="/settings?panel=byok"
            className="block mt-1 text-2xs text-brand underline hover:no-underline"
            onClick={() => setPopoverOpen(false)}
          >
            {isByok ? 'View BYOK settings →' : 'Configure BYOK →'}
          </Link>

          {data.last_audit_at && (
            <p className="text-fg-faint text-3xs">
              Last audited {new Date(data.last_audit_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
