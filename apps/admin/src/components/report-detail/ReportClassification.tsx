import {
  Field,
  ImageZoom,
  InfoHint,
  Tooltip,
  Badge,
  Callout,
  DefinitionChips,
  CodeValue,
  LongFormText,
} from '../ui'
import {
  CATEGORY_BADGE,
  CATEGORY_LABELS,
  SEVERITY,
  severityLabel,
  confidenceBadgeClass,
} from '../../lib/tokens'
import { IconCamera, IconSparkle } from '../icons'
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
              <Badge className={confidenceBadgeClass(conf)} title={conf != null ? `${(conf * 100).toFixed(1)}%` : undefined}>
                {confLabel}
              </Badge>
            ),
          },
        ]}
      />

      {report.summary && (
        <Callout tone="info" label="LLM summary" icon={<IconSparkle className="text-info" />}>
          <LongFormText value={report.summary} />
        </Callout>
      )}

      {report.component && (
        <div className="mb-2 last:mb-0">
          <span className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-0.5">
            Component
            <InfoHint content="The UI component or code area the LLM believes is responsible." />
          </span>
          <CodeValue value={report.component} tone="hash" />
        </div>
      )}

      {reproductionHint && (
        <Field
          label="Reproduction hint"
          value={reproductionHint}
          longForm
          tooltip="LLM-generated summary of the steps to reproduce. Treat as a starting point, not a verified repro."
        />
      )}
      <ModelFooter model={report.stage1_model} latency={report.stage1_latency_ms} />
    </>
  )
}

function ModelFooter({ model, latency }: { model: string | null; latency: number | null }) {
  if (!model && latency == null) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-edge-subtle pt-2 text-2xs text-fg-faint">
      {model && (
        <div className="inline-flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-fg-faint">Model</span>
          <CodeValue value={model} inline tone="neutral" copyable={false} />
        </div>
      )}
      {latency != null && (
        <Tooltip content="End-to-end classification latency (Stage-1 only).">
          <span className="font-mono text-fg-muted tabular-nums cursor-help">{latency} ms</span>
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
        <EmptySectionMessage text="No screenshot was captured for this report." />
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

export function EmptySectionMessage({ text }: { text: string }) {
  return <div className="text-xs text-fg-muted italic py-1">{text}</div>
}
