import {
  ImageZoom,
  InfoHint,
  Tooltip,
  Badge,
  Callout,
  DefinitionChips,
  CodeValue,
  ProseBlock,
} from '../ui'
import {
  CATEGORY_BADGE,
  CATEGORY_LABELS,
  SEVERITY,
  severityLabel,
  confidenceBadgeClass,
} from '../../lib/tokens'
import { IconCamera, IconIntelligence } from '../icons'
import { ContainedBlock } from './ReportSurface'
import { EmptySectionMessage } from '../ui/empty-section-message'
import type { ReportDetail } from './types'

export function ClassificationFields({ report }: { report: ReportDetail }) {
  const reproductionHint = (report.stage1_classification as { reproductionHint?: string } | null)?.reproductionHint
  const categoryLabel = CATEGORY_LABELS[report.category] ?? report.category
  const severityText = report.severity ? severityLabel(report.severity) : 'Unset'
  const conf = report.confidence
  const confLabel = conf != null ? `${(conf * 100).toFixed(0)}%` : 'n/a'

  return (
    <>
      <DefinitionChips
        items={[
          {
            label: 'Category',
            hint: 'Coarse-grained type assigned by the Stage-1 classifier.',
            value: (
              <Badge
                className={CATEGORY_BADGE[report.category] ?? 'bg-surface-overlay text-fg-secondary border border-edge-subtle'}
              >
                {categoryLabel}
              </Badge>
            ),
          },
          {
            label: 'Severity',
            hint: 'Estimated user impact, used to drive routing and SLA.',
            value: report.severity ? (
              <Badge className={SEVERITY[report.severity] ?? 'bg-surface-overlay border border-edge-subtle text-fg-muted'}>
                {severityText}
              </Badge>
            ) : (
              <span className="text-fg-muted">Unset</span>
            ),
          },
          {
            label: 'Confidence',
            hint: 'LLM self-reported confidence. Below 70% usually warrants human review.',
            value: (
              <div className="flex min-w-0 flex-col gap-1">
                <Badge className={confidenceBadgeClass(conf)} title={conf != null ? `${(conf * 100).toFixed(1)}%` : undefined}>
                  {confLabel}
                </Badge>
                {conf != null && (
                  <div
                    className="h-1 w-full max-w-[8rem] overflow-hidden rounded-full bg-surface-overlay/80"
                    role="progressbar"
                    aria-valuenow={Math.round(conf * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Classification confidence"
                  >
                    <div
                      className={`h-full rounded-full transition-[width] ${
                        conf >= 0.85 ? 'bg-ok' : conf >= 0.7 ? 'bg-warn' : 'bg-danger'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, conf * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />

      {report.summary && (
        <Callout tone="info" label="LLM summary" icon={<IconIntelligence className="text-info" />}>
          <ProseBlock value={report.summary} mode="auto" />
        </Callout>
      )}

      {report.component && (
        <ContainedBlock label="Component" tone="muted">
          <div className="flex items-center gap-1 mb-1">
            <InfoHint content="The UI component or code area the LLM believes is responsible." />
          </div>
          <CodeValue value={report.component} tone="hash" />
        </ContainedBlock>
      )}

      {reproductionHint && (
        <ContainedBlock label="Reproduction hint" tone="info">
          <ProseBlock value={reproductionHint} mode="auto" tone="muted" maxWidth="max-w-none" />
        </ContainedBlock>
      )}
      <ModelFooter model={report.stage1_model} latency={report.stage1_latency_ms} />
    </>
  )
}

function ModelFooter({ model, latency }: { model: string | null; latency: number | null }) {
  if (!model && latency == null) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-edge-subtle pt-2">
      {model && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/35 px-1.5 py-0.5 text-2xs">
          <span className="shrink-0 text-3xs font-medium uppercase tracking-wider text-fg-faint">Model</span>
          <code className="min-w-0 truncate font-mono text-fg-secondary">{model}</code>
        </span>
      )}
      {latency != null && (
        <Tooltip content="End-to-end classification latency (Stage-1 only).">
          <span className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/35 px-1.5 py-0.5 text-2xs font-mono tabular-nums text-fg-muted cursor-help">
            <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint not-italic font-sans">Latency</span>
            {latency.toLocaleString()} ms
          </span>
        </Tooltip>
      )}
    </div>
  )
}

export function ScreenshotBlock({ url }: { url: string | null }) {
  return (
    <div className="mt-3">
      <span className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1.5">
        <IconCamera /> Screenshot
        <InfoHint content="The screen the user captured at the moment they submitted this report." />
      </span>
      {url ? (
        <ImageZoom src={url} alt="Bug report screenshot" thumbClassName="max-h-72 inline-block" />
      ) : (
        <EmptySectionMessage
          text="No screenshot was attached to this report."
          hint="The widget auto-captures the screen on open; the reporter can remove it before sending, and native SDKs need the optional view-shot dependency."
        />
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
