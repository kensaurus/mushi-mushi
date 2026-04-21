import { Field, ImageZoom, InfoHint, Tooltip } from '../ui'
import { CATEGORY_LABELS, severityLabel } from '../../lib/tokens'
import { IconCamera } from '../icons'
import type { ReportDetail } from './types'

export function ClassificationFields({ report }: { report: ReportDetail }) {
  const reproductionHint = (report.stage1_classification as { reproductionHint?: string } | null)?.reproductionHint
  return (
    <>
      <Field
        label="Category"
        value={CATEGORY_LABELS[report.category] ?? report.category}
        tooltip="Coarse-grained type assigned by the Stage-1 classifier."
      />
      <Field
        label="Severity"
        value={severityLabel(report.severity)}
        tooltip="Estimated user impact, used to drive routing and SLA."
      />
      <Field label="Summary" value={report.summary ?? '—'} />
      {report.component && (
        <Field
          label="Component"
          value={report.component}
          mono
          tooltip="The UI component or code area the LLM believes is responsible."
        />
      )}
      <Field
        label="Confidence"
        value={report.confidence != null ? `${(report.confidence * 100).toFixed(0)}%` : 'n/a'}
        tooltip="LLM self-reported confidence in the category and severity assignment. Below 70% usually warrants human review."
      />
      {reproductionHint && (
        <Field
          label="Reproduction hint"
          value={reproductionHint}
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
    <div className="mt-2 flex items-center gap-1.5 text-2xs text-fg-faint border-t border-edge-subtle pt-2">
      <Tooltip content="Stage-1 fast filter model used to classify this report.">
        <span className="font-mono cursor-help">{model ?? 'unknown'}</span>
      </Tooltip>
      {latency != null && (
        <>
          <span aria-hidden="true">·</span>
          <Tooltip content="End-to-end classification latency (Stage-1 only).">
            <span className="font-mono cursor-help">{latency} ms</span>
          </Tooltip>
        </>
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
