/**
 * FILE: apps/admin/src/components/report-detail/DiagnosisFixHero.tsx
 * PURPOSE: The consolidated "why it broke -> here's the fix" hero that
 *          delivers the brand sub-promise ("Plain-English diagnosis + a
 *          paste-ready fix, right inside Cursor") as ONE surface at the top
 *          of the report.
 *
 *          The ingredients already existed but were scattered: the Stage-2
 *          `summary` (LLM diagnosis) sat buried in the classification card,
 *          and the paste-ready prompt lived in `CursorAgentLaunch` far down
 *          the page. This block lifts the answer to the top:
 *            1. "Here's why it broke" — a 1-3 sentence plain-English
 *               diagnosis with a confidence chip.
 *            2. "Here's the fix" — the existing CursorAgentLaunch prompt.
 *
 *          Accuracy is existential for this audience (a confident-but-wrong
 *          diagnosis is worse than none). So when the classifier's
 *          confidence is low or the summary is missing, we fail gracefully:
 *          "Not sure yet — here's what I'd check first."
 */

import type { ReactNode } from 'react'
import { Badge } from '../ui'
import { Card } from '../../components/ui'
import { IconIntelligence } from '../icons'
import {
  SEVERITY,
  CATEGORY_LABELS,
  severityLabel,
  confidenceBadgeClass,
} from '../../lib/tokens'
import { reportDiagnosisView, type Stage2Diagnosis } from '../../lib/reportDiagnosis'
import { CursorAgentLaunch } from './CursorAgentLaunch'
import type { ReportDetail } from './types'

/** Below this, we hedge instead of asserting a root cause. */
const LOW_CONFIDENCE = 0.7

export function DiagnosisFixHero({
  report,
  cursorWorkspace,
}: {
  report: ReportDetail
  cursorWorkspace?: string
}) {
  const conf = report.confidence
  const confLabel = conf != null ? `${(conf * 100).toFixed(0)}%` : 'n/a'
  const reproHint = (report.stage1_classification as { reproductionHint?: string } | null)
    ?.reproductionHint
  const summary = report.summary?.trim()
  const categoryText = CATEGORY_LABELS[report.category] ?? report.category
  const severityText = report.severity ? severityLabel(report.severity) : null

  // Stage 2's root cause / fix / repro, when it ran (lib/reportDiagnosis.ts).
  const view = reportDiagnosisView(report)
  const stage2 = view.kind === 'full' || view.kind === 'streaming' ? view.diagnosis : null

  // Confident enough to lead with an answer?
  const isConfident = Boolean(summary) && (conf == null || conf >= LOW_CONFIDENCE)

  // What to check first, when we hedge — the most concrete signals we have.
  const checkFirst = [
    report.component ? `the \`${report.component}\` component` : null,
    reproHint || null,
    summary || null,
  ].filter((x): x is string => Boolean(x))

  return (
    <>
      {/* Part 1 — Diagnosis: "here's why it broke", in plain English.
          `data-tour-id` anchors the FirstRunTour "diagnosis" stop. */}
      <div data-tour-id="report-diagnosis">
      <Card  className="mb-2 p-3">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <IconIntelligence className="text-info" />
            {stage2
              ? isConfident ? 'Diagnosis' : 'Diagnosis — low confidence'
              : isConfident ? 'Classification' : 'Low confidence — check these first'}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {severityText && (
              <Badge className={SEVERITY[report.severity!] ?? 'bg-surface-overlay border border-edge-subtle text-fg-muted'}>
                {severityText}
              </Badge>
            )}
            <Badge className="border border-edge-subtle bg-surface-overlay text-fg-secondary">
              {categoryText}
            </Badge>
            <Badge
              className={confidenceBadgeClass(conf)}
              title={conf != null ? `Classifier confidence: ${(conf * 100).toFixed(1)}%` : 'No confidence score'}
            >
              {confLabel} sure
            </Badge>
          </div>
        </div>

        {stage2 ? (
          <Stage2DiagnosisBody diagnosis={stage2} summary={summary ?? null} streaming={view.kind === 'streaming'} />
        ) : isConfident ? (
          <p className="text-sm leading-relaxed text-fg-secondary">{summary}</p>
        ) : (
          <div className="text-sm leading-relaxed text-fg-secondary">
            <p>
              The diagnosis here is shaky, so I won&rsquo;t guess at a single root cause. Start with these and the
              evidence below:
            </p>
            {checkFirst.length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-fg-muted">
                {checkFirst.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-fg-muted">
                Reproduce it first, then check the console and network panels below.
              </p>
            )}
          </div>
        )}

        {!stage2 && <Stage2AbsentNote view={view} />}

        <CodeContextBadge report={report} />

        {!stage2 && isConfident && report.component && (
          <p className="mt-1.5 text-2xs text-fg-faint">
            Likely in{' '}
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/50 px-1 py-0.5 font-mono text-fg-secondary">
              {report.component}
            </code>
          </p>
        )}
      </Card>
      </div>

      {/* Part 2 — Fix: the paste-ready prompt (already its own card). */}
      <CursorAgentLaunch report={report} cursorWorkspace={cursorWorkspace} />
    </>
  )
}

/**
 * Stage 2's answer: why it broke, what to change, how to reproduce. All of it
 * is model output from an untrusted report, so it renders as plain text.
 */
function Stage2DiagnosisBody({
  diagnosis,
  summary,
  streaming,
}: {
  diagnosis: Stage2Diagnosis
  summary: string | null
  streaming: boolean
}) {
  const meta = [
    diagnosis.component ? `Component: ${diagnosis.component}` : null,
    diagnosis.confidence != null ? `${Math.round(diagnosis.confidence * 100)}% confidence` : null,
    diagnosis.model ? `Model: ${diagnosis.model}` : null,
  ].filter((x): x is string => Boolean(x))

  return (
    <div className="space-y-2 text-sm leading-relaxed text-fg-secondary">
      {streaming && <p className="text-2xs text-fg-faint italic">Full diagnosis still running — fields fill in as they arrive.</p>}
      <DiagnosisField label="Why it broke">{inlineMarkdown(diagnosis.rootCause ?? summary ?? 'No root cause yet.')}</DiagnosisField>
      {diagnosis.suggestedFix && (
        <DiagnosisField label="Suggested fix">
          <span className="whitespace-pre-line">{inlineMarkdown(diagnosis.suggestedFix)}</span>
        </DiagnosisField>
      )}
      {diagnosis.reproductionSteps.length > 0 && (
        <DiagnosisField label="How to reproduce">
          <ol className="list-decimal space-y-0.5 pl-5 text-fg-muted">
            {diagnosis.reproductionSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </DiagnosisField>
      )}
      {meta.length > 0 && <p className="text-2xs text-fg-faint">{meta.join(' · ')}</p>}
    </div>
  )
}

/**
 * The model writes light Markdown (**bold**, `code`). Render just those two as
 * elements. Everything stays React text, so model output can never become HTML.
 * @internal Exported for unit tests only.
 */
export function inlineMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    if (m[1] !== undefined) out.push(<strong key={i++} className="font-semibold text-fg">{m[1]}</strong>)
    else out.push(<code key={i++} className="rounded-sm bg-surface-raised px-1 font-mono">{m[2]}</code>)
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function DiagnosisField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wide text-fg-faint">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

/**
 * Honest note when Stage 2 did not produce a diagnosis. There is no server
 * route that re-runs Stage 2 for a classified report, so no button is offered.
 */
function Stage2AbsentNote({ view }: { view: ReturnType<typeof reportDiagnosisView> }) {
  if (view.kind === 'stage1_only') {
    return (
      <p className="mt-1.5 text-2xs text-fg-faint">
        Full diagnosis not run (classifier confident) — this is the quick classifier&rsquo;s summary, without a root
        cause or suggested fix.
      </p>
    )
  }
  if (view.kind === 'failed') {
    return (
      <p className="mt-1.5 text-2xs text-fg-faint">
        Full diagnosis failed: <span className="wrap-break-word">{view.message}</span>
      </p>
    )
  }
  return null
}

/** Why grounding was absent, per RagSkipReason, with what to do about it. */
const CODE_CONTEXT_HINTS: Record<string, string> = {
  disabled: 'No code context — codebase indexing is off. Enable it under Integrations for file-level diagnoses.',
  empty_query: 'No code context — the report had too little signal to search the codebase.',
  embedding_failed: 'Code lookup failed while embedding the query — check your LLM keys under Integrations.',
  rpc_failed: 'Code lookup failed against the index — check indexing status under Integrations.',
  no_matches: 'No matching files in the code index — the index may be partial or stale.',
}

/**
 * Surfaces whether this diagnosis was grounded in the user's codebase.
 * A diagnosis without code context is materially weaker; hiding that fact
 * is how "I added my repo but it doesn't work" support tickets happen.
 */
function CodeContextBadge({ report }: { report: ReportDetail }) {
  const ctx = report.stage2_analysis?.code_context
  if (!ctx) return null

  if (ctx.status === 'ok') {
    return (
      <p className="mt-1.5 text-2xs text-fg-faint">
        Grounded in {ctx.fileCount} indexed code file{ctx.fileCount === 1 ? '' : 's'}
      </p>
    )
  }

  const hint = CODE_CONTEXT_HINTS[ctx.status] ?? `Code context unavailable (${ctx.status}).`
  return (
    <p className="mt-1.5 rounded-sm border border-warn/30 bg-warn/5 px-2 py-1 text-2xs leading-relaxed text-fg-muted">
      <span className="font-medium text-warn">Diagnosed without code context.</span> {hint}
      {ctx.detail ? <span className="text-fg-faint"> ({ctx.detail})</span> : null}
    </p>
  )
}
