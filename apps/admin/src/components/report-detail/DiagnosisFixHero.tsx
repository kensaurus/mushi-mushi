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

import { Badge } from '../ui'
import { IconIntelligence } from '../icons'
import {
  SEVERITY,
  CATEGORY_LABELS,
  severityLabel,
  confidenceBadgeClass,
} from '../../lib/tokens'
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
      {/* Part 1 — Diagnosis: "here's why it broke", in plain English. */}
      <div className="mb-2 rounded-md border border-edge-subtle bg-surface-raised/40 p-3">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <IconIntelligence className="text-info" />
            {isConfident ? "Here's why it broke" : 'Not sure yet — here\u2019s what I\u2019d check first'}
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

        {isConfident ? (
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

        {isConfident && report.component && (
          <p className="mt-1.5 text-2xs text-fg-faint">
            Likely in{' '}
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/50 px-1 py-0.5 font-mono text-fg-secondary">
              {report.component}
            </code>
          </p>
        )}
      </div>

      {/* Part 2 — Fix: the paste-ready prompt (already its own card). */}
      <CursorAgentLaunch report={report} cursorWorkspace={cursorWorkspace} />
    </>
  )
}
