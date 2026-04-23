/**
 * FILE: apps/admin/src/components/reports/ReportPreviewDrawer.tsx
 * PURPOSE: Right-side preview for a report picked from the list. Opens
 *          via a URL search param (`?preview=<id>`) so deep links work
 *          and back-button closes it. Preserves the list scroll behind
 *          the drawer — important for triage sessions where the user
 *          walks a long queue and a full navigation would reset their
 *          place every click.
 *
 *          The drawer is deliberately read-only: it surfaces the fields
 *          needed to decide "triage further, dismiss, or open fully?"
 *          without duplicating the full report detail page. A CTA links
 *          to the full page for anything deeper.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { Drawer } from '../Drawer'
import { Badge, CodeValue, RelativeTime, LongFormText, Loading } from '../ui'
import {
  STATUS,
  SEVERITY,
  CATEGORY_BADGE,
  CATEGORY_LABELS,
  statusLabel,
  severityLabel,
} from '../../lib/tokens'

interface ReportPreview {
  id: string
  project_id: string
  summary: string | null
  description: string | null
  status: string
  severity: string | null
  category: string | null
  component: string | null
  confidence: number | null
  created_at: string
  screenshot_url?: string | null
  environment?: Record<string, unknown> | null
}

interface Props {
  /** When set, fetches + opens the preview. Clearing closes it. */
  previewId: string | null
  onClose: () => void
}

export function ReportPreviewDrawer({ previewId, onClose }: Props) {
  const [report, setReport] = useState<ReportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Tracks the currently-requested preview id. When the user rapidly
  // cycles through reports (space, space, space…) only the final
  // response should populate the drawer — any older in-flight response
  // is discarded when its id no longer matches. Avoids the classic
  // flicker where A lands after B and briefly overwrites B's data.
  const latestIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!previewId) {
      latestIdRef.current = null
      setReport(null)
      setError(null)
      return
    }
    latestIdRef.current = previewId
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    void (async () => {
      const res = await apiFetch<{ report: ReportPreview }>(
        `/v1/admin/reports/${previewId}`,
        { signal: controller.signal },
      )
      // Stale-request guard: user moved on to a different report (or
      // closed the drawer) before this one resolved. Drop silently.
      if (latestIdRef.current !== previewId || controller.signal.aborted) return
      if (res.ok && res.data) setReport(res.data.report)
      else setError(res.error?.message ?? 'Failed to load preview')
      setLoading(false)
    })()
    return () => {
      controller.abort()
    }
  }, [previewId])

  return (
    <Drawer
      open={Boolean(previewId)}
      onClose={onClose}
      dimmed={false}
      width="lg"
      title="Preview"
    >
      <div className="px-4 py-3 space-y-3">
        {loading && <Loading text="Loading report…" />}
        {!loading && error && <p className="text-xs text-danger">{error}</p>}
        {!loading && report && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={STATUS[report.status] ?? 'text-fg-muted border border-edge'}>
                {statusLabel(report.status)}
              </Badge>
              {report.severity && (
                <Badge className={SEVERITY[report.severity] ?? ''}>{severityLabel(report.severity)}</Badge>
              )}
              {report.category && (
                <Badge className={CATEGORY_BADGE[report.category] ?? 'bg-surface-overlay text-fg-secondary border border-edge-subtle'}>
                  {CATEGORY_LABELS[report.category] ?? report.category}
                </Badge>
              )}
              {report.component && (
                <Badge className="bg-surface-overlay text-fg-secondary border border-edge-subtle">
                  {report.component}
                </Badge>
              )}
              {typeof report.confidence === 'number' && (
                <span className="text-2xs font-mono text-fg-muted" title="LLM classification confidence">
                  conf {Math.round(report.confidence * 100)}%
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-fg leading-snug text-balance">
              {(report.summary ?? 'Untitled report').trim() || 'Untitled report'}
            </h2>
            <div className="flex items-center gap-2 text-2xs text-fg-muted flex-wrap">
              <RelativeTime value={report.created_at} />
              <span aria-hidden className="text-fg-faint">·</span>
              <CodeValue value={report.id} inline tone="id" className="max-w-[18rem]" />
            </div>
            {report.description && (
              <div>
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
                  Description
                </h3>
                <LongFormText value={report.description} />
              </div>
            )}
            {report.screenshot_url && (
              <div>
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
                  Screenshot
                </h3>
                <img
                  src={report.screenshot_url}
                  alt="Report screenshot"
                  className="max-h-80 w-auto rounded-sm border border-edge/60"
                />
              </div>
            )}
            <div className="pt-2 border-t border-edge/60">
              <Link
                to={`/reports/${report.id}`}
                className="text-xs text-brand hover:underline"
              >
                Open full report →
              </Link>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
