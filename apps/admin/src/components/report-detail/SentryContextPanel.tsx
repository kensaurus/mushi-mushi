/**
 * FILE: apps/admin/src/components/report-detail/SentryContextPanel.tsx
 * PURPOSE: Side-rail panel for the report detail page that surfaces the
 *          Sentry context the SDK captured at report time, plus a dual
 *          breadcrumb timeline that interleaves Mushi-side breadcrumbs
 *          with Sentry-side breadcrumbs in one chronological stream.
 *
 *          The triage operator's mental model is "what was the user
 *          doing right before this broke?" — one timeline answers that
 *          regardless of which SDK captured each crumb. We colour-code
 *          by source (Mushi = brand, Sentry = sentry-purple) so the
 *          eye still reads the trail as one fabric while showing
 *          provenance.
 */

import { useMemo } from 'react'
import { Section, Badge, CodeValue } from '../ui'
import { IconBolt, IconExternalLink, IconClock, IconLink, IconAlertTriangle } from '../icons'
import type {
  ReportBreadcrumb,
  ReportSentryBreadcrumb,
  ReportSentryContext,
} from './types'

interface Props {
  /** Mushi-side breadcrumbs from `reports.breadcrumbs`. May be null/empty. */
  mushiBreadcrumbs?: ReportBreadcrumb[] | null
  /** Sentry-side breadcrumbs (lives under `custom_metadata.sentry`). */
  sentryContext?: ReportSentryContext | null
  /** Top-level Sentry IDs that always live on dedicated columns. */
  sentryEventId?: string | null
  sentryReplayId?: string | null
  sentryTraceId?: string | null
  sentryRelease?: string | null
  sentryEnvironment?: string | null
  /** Pre-built deeplink to the Sentry issue page; used as the CTA. */
  sentryIssueUrl?: string | null
  /** Tags surface — also rendered as filter chips. */
  tags?: Record<string, string | number | boolean> | null
}

interface UnifiedCrumb {
  source: 'mushi' | 'sentry'
  ts: number
  category?: string
  level?: string
  message?: string
  data?: Record<string, unknown>
}

const LEVEL_TONE: Record<string, string> = {
  error: 'text-danger',
  warning: 'text-warn',
  info: 'text-fg-secondary',
  debug: 'text-fg-muted',
}

const SOURCE_DOT: Record<UnifiedCrumb['source'], string> = {
  // brand-aligned dot for Mushi-side; deliberately distinct from
  // Sentry's own purple so the operator can read provenance at a
  // glance without reading the source label.
  mushi: 'bg-brand',
  sentry: 'bg-viz-sentry',
}

const SOURCE_LABEL: Record<UnifiedCrumb['source'], string> = {
  mushi: 'Mushi',
  sentry: 'Sentry',
}

/**
 * Merge Mushi + Sentry breadcrumbs into one chronologically-sorted
 * stream. We tolerate missing timestamps from Sentry (rare but
 * happens on early-init events) by treating them as oldest — better
 * than dropping them silently.
 */
function unifyTimelines(
  mushi: ReportBreadcrumb[] | undefined | null,
  sentry: ReportSentryBreadcrumb[] | undefined | null,
): UnifiedCrumb[] {
  const out: UnifiedCrumb[] = []
  for (const c of mushi ?? []) {
    out.push({
      source: 'mushi',
      ts: c.timestamp,
      category: c.category,
      level: c.level,
      message: c.message,
      data: c.data,
    })
  }
  for (const c of sentry ?? []) {
    // Sentry stores timestamps in seconds (epoch). Mushi stores ms.
    // We coerce to ms here so the merge is comparable.
    const raw = typeof c.timestamp === 'number' ? c.timestamp : 0
    const tsMs = raw < 1e12 ? raw * 1000 : raw
    out.push({
      source: 'sentry',
      ts: tsMs,
      category: c.category,
      level: c.level,
      message: c.message,
      data: c.data,
    })
  }
  return out.sort((a, b) => a.ts - b.ts)
}

function formatRelative(ms: number, anchor: number): string {
  if (!ms || !anchor) return ''
  const delta = ms - anchor
  const abs = Math.abs(delta)
  if (abs < 1000) return `${delta >= 0 ? '+' : '−'}${abs}ms`
  if (abs < 60_000) return `${delta >= 0 ? '+' : '−'}${(abs / 1000).toFixed(1)}s`
  if (abs < 3600_000) return `${delta >= 0 ? '+' : '−'}${Math.round(abs / 60_000)}m`
  return `${delta >= 0 ? '+' : '−'}${Math.round(abs / 3600_000)}h`
}

export function SentryContextPanel({
  mushiBreadcrumbs,
  sentryContext,
  sentryEventId,
  sentryReplayId,
  sentryTraceId,
  sentryRelease,
  sentryEnvironment,
  sentryIssueUrl,
  tags,
}: Props) {
  const unified = useMemo(
    () => unifyTimelines(mushiBreadcrumbs, sentryContext?.breadcrumbs),
    [mushiBreadcrumbs, sentryContext?.breadcrumbs],
  )

  const lastTs = unified.length > 0 ? unified[unified.length - 1].ts : 0

  const eventId = sentryEventId ?? sentryContext?.eventId ?? null
  const replayId = sentryReplayId ?? sentryContext?.replayId ?? null
  const traceId = sentryTraceId ?? sentryContext?.traceId ?? null
  const spanId = sentryContext?.spanId ?? null
  const release = sentryRelease ?? sentryContext?.release ?? null
  const environment = sentryEnvironment ?? sentryContext?.environment ?? null
  const transactionName = sentryContext?.transactionName ?? null
  const sentryUser = sentryContext?.user ?? null
  const issueUrl = sentryIssueUrl ?? sentryContext?.issueUrl ?? null

  const hasSentry =
    Boolean(eventId || replayId || traceId || release || environment || transactionName)

  const hasTags = tags && Object.keys(tags).length > 0
  const tagEntries = useMemo(
    () => (tags ? Object.entries(tags).slice(0, 24) : []),
    [tags],
  )

  if (!hasSentry && unified.length === 0 && !hasTags) {
    // Don't render an empty card — the report didn't carry any
    // observability extras. The detail page already has enough chrome.
    return null
  }

  return (
    <Section
      title="Sentry context"
      icon={<IconBolt />}
      action={
        issueUrl ? (
          <a
            href={issueUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-2xs text-fg-secondary hover:text-fg"
            title="Open this trace in Sentry"
          >
            Open in Sentry
            <IconExternalLink className="size-3" />
          </a>
        ) : undefined
      }
    >
      {hasSentry && (
        <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 text-2xs">
          {eventId && (
            <IdRow label="Event id" value={eventId} mono />
          )}
          {replayId && (
            <IdRow label="Replay id" value={replayId} mono />
          )}
          {traceId && (
            <IdRow label="Trace id" value={traceId} mono />
          )}
          {spanId && (
            <IdRow label="Span id" value={spanId} mono />
          )}
          {transactionName && (
            <IdRow label="Transaction" value={transactionName} mono={false} />
          )}
          {release && (
            <IdRow label="Release" value={release} mono />
          )}
          {environment && (
            <div className="flex items-center gap-1.5">
              <span className="text-fg-muted">Env</span>
              <Badge className="bg-surface-overlay text-fg-secondary border border-edge-subtle">
                {environment}
              </Badge>
            </div>
          )}
          {sentryUser?.id && (
            <IdRow
              label="Sentry user"
              value={sentryUser.email ?? sentryUser.username ?? sentryUser.id}
              mono={false}
            />
          )}
        </div>
      )}

      {hasTags && (
        <div className="mb-3">
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
            Tags
          </h3>
          <div className="flex flex-wrap gap-1">
            {tagEntries.map(([k, v]) => (
              <Badge
                key={k}
                className="bg-surface-overlay text-fg-secondary border border-edge-subtle font-mono text-2xs"
                title={`Filter all reports where ${k} = ${String(v)}`}
              >
                <span className="text-fg-muted">{k}</span>
                <span className="mx-0.5 text-fg-faint">:</span>
                <span>{String(v)}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {unified.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
              <IconClock className="size-3" /> Breadcrumb timeline
            </h3>
            <div className="flex items-center gap-3 text-2xs text-fg-faint">
              <span className="inline-flex items-center gap-1">
                <span className={`size-2 rounded-full ${SOURCE_DOT.mushi}`} aria-hidden />
                Mushi
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={`size-2 rounded-full ${SOURCE_DOT.sentry}`} aria-hidden />
                Sentry
              </span>
            </div>
          </div>
          <ol className="relative ml-1 border-l border-edge-subtle space-y-2 pl-3 max-h-[28rem] overflow-y-auto pr-1">
            {unified.map((c, i) => (
              <li key={i} className="relative">
                <span
                  aria-hidden
                  className={`absolute -left-[14px] top-1.5 size-2 rounded-full ${SOURCE_DOT[c.source]} ring-2 ring-surface`}
                />
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-2xs font-mono text-fg-faint min-w-[3rem]">
                    {formatRelative(c.ts, lastTs)}
                  </span>
                  <span className="text-2xs font-mono text-fg-muted">
                    {SOURCE_LABEL[c.source]}
                  </span>
                  {c.category && (
                    <Badge className="bg-surface-overlay text-fg-secondary border border-edge-subtle font-mono text-2xs">
                      {c.category}
                    </Badge>
                  )}
                  {c.level && c.level !== 'info' && (
                    <span
                      className={`inline-flex items-center gap-1 text-2xs font-mono ${LEVEL_TONE[c.level] ?? 'text-fg-muted'}`}
                    >
                      {c.level === 'error' || c.level === 'warning' ? (
                        <IconAlertTriangle className="size-3" />
                      ) : null}
                      {c.level}
                    </span>
                  )}
                </div>
                {c.message && (
                  <p className="mt-0.5 text-xs text-fg leading-snug whitespace-pre-wrap break-words">
                    {c.message}
                  </p>
                )}
                {c.data && Object.keys(c.data).length > 0 && (
                  <details className="mt-1 group">
                    <summary className="text-2xs text-fg-muted hover:text-fg cursor-pointer select-none inline-flex items-center gap-1">
                      <span className="opacity-60 group-open:opacity-100">›</span>
                      data
                    </summary>
                    <pre className="mt-1 text-2xs font-mono text-fg-secondary bg-surface-overlay rounded-sm p-1.5 overflow-x-auto whitespace-pre-wrap break-words">
                      {safeStringify(c.data)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {!unified.length && !hasTags && hasSentry && (
        <p className="text-2xs text-fg-faint italic mt-1">
          No breadcrumbs were captured for this report — Sentry IDs only.
        </p>
      )}

      {issueUrl && (
        <p className="mt-3 text-2xs text-fg-muted inline-flex items-start gap-1">
          <IconLink className="size-3 mt-0.5" />
          Bidirectional link: this report's id is also tagged on the
          Sentry scope as <code className="mx-1 px-1 py-0.5 rounded-sm bg-surface-overlay font-mono">mushi.report_id</code>,
          so subsequent Sentry events backlink to this report.
        </p>
      )}
    </Section>
  )
}

function IdRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-fg-muted shrink-0">{label}</span>
      <CodeValue
        value={value}
        inline
        tone="id"
        className={`min-w-0 ${mono ? '' : 'font-sans'}`}
      />
    </div>
  )
}

function safeStringify(o: unknown): string {
  try {
    return JSON.stringify(o, null, 2)
  } catch {
    return String(o)
  }
}
