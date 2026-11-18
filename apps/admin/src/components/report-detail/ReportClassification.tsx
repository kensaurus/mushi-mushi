import type { ReactNode } from 'react'
import {
  ImageZoom,
  InfoHint,
  Tooltip,
  Badge,
  ProseBlock,
} from '../ui'
import { roundLongDecimals } from '../../lib/format'
import {
  CATEGORY_BADGE,
  CATEGORY_LABELS,
  SEVERITY,
  severityLabel,
  confidenceBadgeClass,
} from '../../lib/tokens'
import { IconCamera, IconIntelligence } from '../icons'
import { summaryPlace } from './summaryPlace'
import type { ReportDetail } from './types'
import { isSampleModel, SAMPLE_EXPLANATION_LABEL } from '../../lib/reportInternals'

export function ClassificationFields({ report, showInternals = false }: { report: ReportDetail; showInternals?: boolean }) {
  const reproductionHint = (report.stage1_classification as { reproductionHint?: string } | null)?.reproductionHint
  const categoryLabel = CATEGORY_LABELS[report.category] ?? report.category
  const severityText = report.severity ? severityLabel(report.severity) : 'Unset'
  const conf = report.confidence
  const confLabel = conf != null ? `${(conf * 100).toFixed(0)}%` : 'n/a'

  // One level of card (sweep 2026-11-18): the section is the card, so its
  // facts are plain rows, not boxes inside it. The summary shows here only
  // when no other place on the page shows it (summaryPlace).
  const showSummary = Boolean(report.summary) && summaryPlace(report) === 'classification'
  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-xs" data-testid="classification-rows">
        <ClassRow label="Category" hint="Coarse-grained type assigned by the Stage-1 classifier.">
          <Badge className={CATEGORY_BADGE[report.category] ?? 'bg-surface-overlay text-fg-secondary border border-edge-subtle'}>{categoryLabel}</Badge>
        </ClassRow>
        <ClassRow label="Severity" hint="Estimated user impact, used to drive routing and SLA.">
          {report.severity ? (
            <Badge className={SEVERITY[report.severity] ?? 'bg-surface-overlay border border-edge-subtle text-fg-muted'}>{severityText}</Badge>
          ) : (
            <span className="text-fg-muted">Unset</span>
          )}
        </ClassRow>
        <ClassRow label="Confidence" hint="LLM self-reported confidence. Below 70% usually warrants human review.">
          <span className="inline-flex items-center gap-2">
            <Badge className={confidenceBadgeClass(conf)} title={conf != null ? `${(conf * 100).toFixed(1)}%` : undefined}>
              {confLabel}
            </Badge>
            {conf != null && (
              <span
                className="h-1 w-24 overflow-hidden rounded-full bg-surface-overlay/80"
                role="progressbar"
                aria-valuenow={Math.round(conf * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Classification confidence"
              >
                <span
                  className={`block h-full rounded-full transition-[width] ${conf >= 0.85 ? 'bg-ok' : conf >= 0.7 ? 'bg-warn' : 'bg-danger'}`}
                  style={{ width: `${Math.min(100, Math.max(0, conf * 100))}%` }}
                />
              </span>
            )}
          </span>
        </ClassRow>
        {report.component && (
          <ClassRow label="Component" hint="The UI component or code area the LLM believes is responsible.">
            <code className="break-all font-mono text-2xs text-fg-secondary">{report.component}</code>
          </ClassRow>
        )}
        {reproductionHint && (
          <ClassRow label="How to reproduce">
            <span className="text-fg-secondary">{reproductionHint}</span>
          </ClassRow>
        )}
      </dl>

      {showSummary && (
        <div className="mt-2 border-t border-edge-subtle pt-2" data-testid="classification-summary">
          <p className="mb-0.5 flex items-center gap-1 text-2xs font-semibold text-fg-secondary">
            <IconIntelligence className="text-info" /> LLM summary
          </p>
          <ProseBlock value={roundLongDecimals(report.summary ?? '')} mode="auto" />
        </div>
      )}

      <ModelFooter model={report.stage1_model} latency={report.stage1_latency_ms} showInternals={showInternals} />
    </>
  )
}

function ClassRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <>
      <dt className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-fg-muted">
        {label}
        {hint ? <InfoHint content={hint} /> : null}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

/**
 * Which model sorted the bug and how long it took: pipeline detail, for
 * operator accounts. Everyone else sees nothing here, except on the sample
 * report, which says plainly that its explanation was written in advance.
 */
function ModelFooter({ model, latency, showInternals }: { model: string | null; latency: number | null; showInternals: boolean }) {
  if (isSampleModel(model)) {
    return <p className="mt-2 border-t border-edge-subtle pt-2 text-2xs text-fg-muted">{SAMPLE_EXPLANATION_LABEL}</p>
  }
  if (!showInternals) return null
  if (!model && latency == null) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-edge-subtle pt-2">
      {model && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm bg-surface-overlay/35 px-1.5 py-px text-2xs">
          <span className="shrink-0 text-3xs font-semibold text-fg-secondary">Model</span>
          <code className="min-w-0 truncate font-mono text-fg-secondary">{model}</code>
        </span>
      )}
      {latency != null && (
        <Tooltip content="End-to-end classification latency (Stage-1 only).">
          <span className="inline-flex items-center gap-1 rounded-sm bg-surface-overlay/35 px-1.5 py-px text-2xs font-mono tabular-nums text-fg-muted cursor-help">
            <span className="text-3xs font-semibold text-fg-secondary not-italic font-sans">Latency</span>
            {latency.toLocaleString()} ms
          </span>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * ScreenshotHero — promotes the user-captured screenshot to a full-width
 * hero strip immediately under the report header. The screenshot is the
 * single most useful piece of triage evidence; tucking it inside the
 * "User report" card buries it. (2026-04-19).
 */
export function ScreenshotHero({ url, className = '' }: { url: string; className?: string }) {
  return (
    <figure className={`rounded-md border border-edge-subtle bg-surface-raised/40 overflow-hidden ${className}`}>
      <ImageZoom
        src={url}
        alt="Bug report screenshot"
        thumbClassName="block w-full max-h-96 object-cover object-top"
      />
      <figcaption className="flex items-center gap-1.5 px-3 py-1.5 text-2xs text-fg-faint border-t border-edge-subtle">
        <IconCamera />
        <span>What the reporter saw — click to zoom</span>
      </figcaption>
    </figure>
  )
}

/** @deprecated Import from `components/ui` — re-exported for back-compat. */
export { EmptySectionMessage } from '../ui/empty-section-message'
