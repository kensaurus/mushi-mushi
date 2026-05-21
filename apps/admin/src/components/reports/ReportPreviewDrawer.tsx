/**
 * FILE: apps/admin/src/components/reports/ReportPreviewDrawer.tsx
 * PURPOSE: Right-side preview for a report picked from the list.
 */

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Drawer } from '../Drawer'
import { Badge, CodeValue, RelativeTime, LongFormText, Loading } from '../ui'
import { SentryContextPanel } from '../report-detail/SentryContextPanel'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import {
  ActionPill,
  ConfidenceMeter,
  ContainedBlock,
  MetaChip,
} from '../report-detail/ReportSurface'
import type { ReportBreadcrumb, ReportSentryContext } from '../report-detail/types'
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
  breadcrumbs?: ReportBreadcrumb[] | null
  tags?: Record<string, string | number | boolean> | null
  sentry_event_id?: string | null
  sentry_replay_id?: string | null
  sentry_trace_id?: string | null
  sentry_release?: string | null
  sentry_environment?: string | null
  sentry_issue_url?: string | null
  custom_metadata?: {
    sentry?: ReportSentryContext
    [k: string]: unknown
  } | null
}

interface Props {
  previewId: string | null
  onClose: () => void
}

export function ReportPreviewDrawer({ previewId, onClose }: Props) {
  const [report, setReport] = useState<ReportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      <div className="space-y-3 px-4 py-3">
        {loading && <Loading text="Loading report…" />}
        {!loading && error && (
          <EmptySectionMessage text="Could not load preview." hint={error} />
        )}
        {!loading && report && (
          <>
            <div className="rounded-md border border-edge-subtle bg-surface-raised/35 p-3">
              <div className="flex flex-wrap items-center gap-2">
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
              </div>
              <h2 className="mt-2 text-base font-semibold leading-snug text-balance text-fg">
                {(report.summary ?? 'Untitled report').trim() || 'Untitled report'}
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <MetaChip label="Reported">
                  <RelativeTime value={report.created_at} />
                </MetaChip>
                <MetaChip label="Report ID" title={report.id}>
                  <CodeValue value={report.id} inline tone="id" className="max-w-[14rem]" />
                </MetaChip>
                {report.component && (
                  <MetaChip label="Component">
                    <code className="font-mono text-brand">{report.component}</code>
                  </MetaChip>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-sm border border-edge-subtle/60 bg-surface-overlay/25 px-2 py-1.5">
                <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Confidence</span>
                <ConfidenceMeter confidence={report.confidence} />
              </div>
            </div>

            {report.description && (
              <ContainedBlock label="Description" tone="neutral">
                <LongFormText value={report.description} maxWidth="max-w-none" />
              </ContainedBlock>
            )}

            {report.screenshot_url ? (
              <ContainedBlock label="Screenshot" tone="muted">
                <img
                  src={report.screenshot_url}
                  alt="Report screenshot"
                  className="max-h-80 w-auto rounded-sm border border-edge/60"
                />
              </ContainedBlock>
            ) : (
              <EmptySectionMessage
                text="No screenshot was captured for this report."
                hint="Open the full report for environment, console, and timeline evidence."
              />
            )}

            <SentryContextPanel
              mushiBreadcrumbs={report.breadcrumbs}
              sentryContext={report.custom_metadata?.sentry}
              sentryEventId={report.sentry_event_id}
              sentryReplayId={report.sentry_replay_id}
              sentryTraceId={report.sentry_trace_id}
              sentryRelease={report.sentry_release}
              sentryEnvironment={report.sentry_environment}
              sentryIssueUrl={report.sentry_issue_url}
              tags={report.tags}
            />

            <div className="border-t border-edge/60 pt-3">
              <ActionPill to={`/reports/${report.id}`} tone="brand">
                Open full report →
              </ActionPill>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
