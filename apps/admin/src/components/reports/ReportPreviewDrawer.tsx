/**
 * FILE: apps/admin/src/components/reports/ReportPreviewDrawer.tsx
 * PURPOSE: Right-side preview for a report picked from the list.
 */

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Drawer } from '../Drawer'
import { Badge, CodeValue, RelativeTime, ProseBlock, Loading } from '../ui'
import { SentryContextPanel } from '../report-detail/SentryContextPanel'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import {
  ActionPill,
  ConfidenceMeter,
  ContainedBlock,
  MetaChip,
} from '../report-detail/ReportSurface'
import { ReportCodeText } from './ReportCodeText'
import type { ReportBreadcrumb, ReportSentryContext } from '../report-detail/types'
import {
  STATUS,
  SEVERITY,
  CATEGORY_BADGE,
  CATEGORY_LABELS,
  statusLabel,
  severityLabel,
} from '../../lib/tokens'

/** Below this Stage-2 confidence we hedge instead of asserting a root cause. */
const LOW_CONFIDENCE = 0.7

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
  /** Paste-ready fix prompt composed server-side by composeFixPacket(). */
  fix_packet?: string | null
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
      // `cache: 'no-store'` bypasses apiFetch's request-coalescing. Coalescing
      // would otherwise hand this component a shared in-flight promise owned by
      // a different caller's AbortController — and under React StrictMode the
      // mount→unmount→remount cycle aborts that shared promise, surfacing a
      // spurious "AbortError" as "Could not load preview". A dedicated fetch
      // keeps this drawer's lifecycle (and its abort) fully its own.
      const res = await apiFetch<{ report: ReportPreview }>(
        `/v1/admin/reports/${previewId}`,
        { signal: controller.signal, cache: 'no-store' },
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
              {(() => {
                const conf = report.confidence
                const summaryText = report.summary?.trim()
                const isConfident = Boolean(summaryText) && (conf == null || conf >= LOW_CONFIDENCE)
                return (
                  <>
                    <p className="mt-2 text-3xs font-medium uppercase tracking-wider text-fg-faint">
                      {isConfident ? "Here's why it broke" : 'Not sure yet — check these first'}
                    </p>
                    <h2 className="mt-0.5 text-base font-semibold leading-snug text-balance text-fg">
                      {summaryText || 'Untitled report'}
                    </h2>
                  </>
                )
              })()}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <MetaChip label="Reported">
                  <RelativeTime value={report.created_at} />
                </MetaChip>
                <MetaChip label="Report ID" title={report.id}>
                  <CodeValue value={report.id} inline tone="id" className="max-w-[14rem]" />
                </MetaChip>
                {report.component && (
                  <MetaChip label="Component">
                    <ReportCodeText title={report.component}>{report.component}</ReportCodeText>
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
                <ProseBlock value={report.description} mode="auto" maxWidth="max-w-none" />
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

            {report.fix_packet && (
              <ContainedBlock label="Paste-ready fix" tone="info">
                <p className="text-2xs leading-relaxed text-fg-muted">
                  A plain-English diagnosis + fix prompt is ready. Copy it into Cursor or Claude Code, or open the
                  full report for the one-click launcher.
                </p>
              </ContainedBlock>
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

            <div className="flex flex-wrap items-center gap-2 border-t border-edge/60 pt-3">
              <ActionPill to={`/reports/${report.id}`} tone="brand">
                Open full report →
              </ActionPill>
              {report.fix_packet && <CopyFixPromptButton packet={report.fix_packet} />}
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}

function CopyFixPromptButton({ packet }: { packet: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(packet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked — the full report's launcher is the fallback.
    }
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex shrink-0 items-center justify-center rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2.5 py-1 text-2xs font-medium text-fg-secondary hover:bg-surface-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      {copied ? 'Copied ✓' : 'Copy fix prompt'}
    </button>
  )
}
