/**
 * FILE: apps/admin/src/components/report-detail/DiagnosisFixHero.tsx
 * PURPOSE: The consolidated "why it broke -> here's the fix" hero that
 *          delivers the brand sub-promise ("Plain-English diagnosis + a
 *          paste-ready fix, in your editor") as ONE surface at the top
 *          of the report.
 *
 *          The ingredients already existed but were scattered: the Stage-2
 *          `summary` (LLM diagnosis) sat buried in the classification card,
 *          and the paste-ready prompt lived in a Cursor-only card far down
 *          the page. This block lifts the answer to the top:
 *            1. "Here's why it broke" — a 1-3 sentence plain-English
 *               diagnosis with a confidence chip.
 *            2. "Here's the fix" — FixWithAgentPanel's editor-neutral prompt.
 *
 *          Accuracy is existential for this audience (a confident-but-wrong
 *          diagnosis is worse than none). So when the classifier's
 *          confidence is low or the summary is missing, we fail gracefully:
 *          "Not sure yet — here's what I'd check first."
 *
 *          ADR 0069 (2026-11-24): when only the quick check ran, this card
 *          says so in one plain line that points at the fix prompt. The
 *          settings link behind it ("Change threshold" / "Check AI keys") is
 *          Stage2AbsentNote, which the page shows in the LLM classification
 *          section further down.
 */

import { roundLongDecimals } from '../../lib/format'
import { summaryPlace } from './summaryPlace'
import type { ReactNode } from 'react'
import { InfoHint } from '../ui'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui'
import { IconIntelligence } from '../icons'
import { reportDiagnosisView, type Stage2Diagnosis } from '../../lib/reportDiagnosis'
import { FixWithAgentPanel } from './FixWithAgentPanel'
import { modelLine } from '../../lib/reportInternals'
import type { ReportDetail } from './types'
import { VitalText } from '../signal/VitalText'

/** Below this, we hedge instead of asserting a root cause. */
const LOW_CONFIDENCE = 0.7

export function DiagnosisFixHero({
  report,
  cursorWorkspace,
  showInternals = false,
}: {
  report: ReportDetail
  cursorWorkspace?: string
  /** Operator accounts: show which model wrote the diagnosis. */
  showInternals?: boolean
}) {
  const conf = report.confidence
  const reproHint = (report.stage1_classification as { reproductionHint?: string } | null)
    ?.reproductionHint
  const summary = report.summary ? roundLongDecimals(report.summary.trim()) : undefined

  // Stage 2's root cause / fix / repro, when it ran (lib/reportDiagnosis.ts).
  const view = reportDiagnosisView(report)
  const stage2 = view.kind === 'full' || view.kind === 'streaming' ? view.diagnosis : null

  // Confident enough to lead with an answer?
  const isConfident = Boolean(summary) && (conf == null || conf >= LOW_CONFIDENCE)
  // The page heading is the summary when there is no title: say it once (sweep 2026-11-18).
  const summaryInHeading = summaryPlace(report) === 'hero'

  // What to check first, when we hedge — the most concrete signals we have.
  const checkFirst = [
    report.component ? `the \`${report.component}\` component` : null,
    reproHint || null,
    summaryInHeading ? null : summary || null,
  ].filter((x): x is string => Boolean(x))

  return (
    <>
      {/* Part 1 — Diagnosis: "here's why it broke", in plain English.
          `data-tour-id` anchors the FirstRunTour "diagnosis" stop. */}
      <div id="report-diagnosis" data-tour-id="report-diagnosis" className="scroll-mt-6">
      <Card  className="mb-2 p-3">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <IconIntelligence className="text-info" />
            {stage2
              ? isConfident ? 'Diagnosis' : 'Diagnosis — low confidence'
              : isConfident ? 'What we know' : 'Low confidence — check these first'}
          </div>
          {/* No category or "97% sure" chips here: the LLM classification
              card shows them, and they were on the page 5x and 4x (round-3
              sweep 2026-11-19). */}
        </div>

        {stage2 ? (
          <Stage2DiagnosisBody diagnosis={stage2} summary={summary ?? null} streaming={view.kind === 'streaming'} showInternals={showInternals} />
        ) : isConfident ? (
          summaryInHeading ? null : <p className="text-sm leading-relaxed text-fg-secondary"><VitalText text={summary ?? ''} /></p>
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

        {!stage2 && view.kind === 'stage1_only' ? (
          <p className="mt-1.5 text-xs text-fg-muted" data-testid="stage2-absent-hero">
            No full diagnosis for this bug yet. Copy the fix prompt below: your editor&rsquo;s AI reads the evidence and
            works out the cause.
          </p>
        ) : null}
        {!stage2 && view.kind === 'failed' ? <Stage2FailedNote message={view.message} /> : null}

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

      {/* Part 2 — Fix: the editor-neutral, paste-ready prompt. */}
      <FixWithAgentPanel report={report} cursorWorkspace={cursorWorkspace} />
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
  showInternals,
}: {
  diagnosis: Stage2Diagnosis
  summary: string | null
  streaming: boolean
  showInternals: boolean
}) {
  const meta = [
    diagnosis.component ? `Component: ${diagnosis.component}` : null,
    diagnosis.confidence != null ? `${Math.round(diagnosis.confidence * 100)}% confidence` : null,
    modelLine(diagnosis.model, showInternals),
  ].filter((x): x is string => Boolean(x))

  return (
    <div className="space-y-2 text-sm leading-relaxed text-fg-secondary">
      {streaming && <p className="text-2xs text-fg-faint italic">Full diagnosis still running — fields fill in as they arrive.</p>}
      <DiagnosisField label="Why it broke">{inlineMarkdown(roundLongDecimals(diagnosis.rootCause ?? summary ?? 'No root cause yet.'))}</DiagnosisField>
      {diagnosis.suggestedFix && (
        <DiagnosisField label="Suggested fix">
          <span className="whitespace-pre-line">{inlineMarkdown(roundLongDecimals(diagnosis.suggestedFix))}</span>
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
      <p className="text-2xs font-semibold text-fg-secondary">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

/** The full diagnosis ran and failed: said beside the diagnosis, since it bears on accuracy. */
function Stage2FailedNote({ message }: { message: string }) {
  return (
    <p className="mt-1.5 text-2xs text-fg-faint">
      Full diagnosis failed: <span className="wrap-break-word">{message}</span>
    </p>
  )
}

/**
 * Honest note when Stage 2 did not produce a diagnosis, with where to change
 * it. The page shows it in the LLM classification section (ADR 0069); the
 * diagnosis card carries a one-line version. There is no server
 * route that re-runs Stage 2 for a classified report, so no button is offered.
 *
 * It says why the full explanation is missing and how to get it (console
 * audit 2026-11-11, a Sentry import that read "Quick summary only"). The
 * first check skips the full explanation in two cases (fast-filter):
 *   - it was confident (above Settings → General → Quick check confidence);
 *   - the AI was not available, so a rule-based sort ran (`stage1_model`
 *     'heuristic'); "the first check was sure" was not true then.
 */
export function Stage2AbsentNote({ report }: { report: ReportDetail }) {
  const view = reportDiagnosisView(report)
  const stage1Model = report.stage1_model ?? null
  if (view.kind === 'stage1_only') {
    const heuristic = stage1Model === 'heuristic'
    // One line, the why behind ⓘ and one link (round-3 sweep 2026-11-19: it
    // was a 3-line paragraph, and the diagnosis graph says the same).
    const why = heuristic
      ? 'The AI that explains bugs was not available when this one arrived (its key was out of credits or rejected), so only a rule-based sort ran. For this bug, copy the fix prompt at the top of the page: your editor\'s AI reads the evidence and works out the cause.'
      : 'The first check was sure what kind of bug this is, so the full diagnosis (why it broke and how to fix it) did not run. For this bug, copy the fix prompt at the top of the page: your editor\'s AI reads the evidence and works out the cause. For new bugs, set Quick check confidence to 100% and every bug gets the full diagnosis (each one uses a diagnosis from your plan).'
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted" data-testid="stage2-absent">
        <span>{heuristic ? 'Quick summary only: the AI key was not available.' : 'Quick summary only.'}</span>
        <InfoHint content={why} />
        <Link to={heuristic ? '/settings?tab=byok' : '/settings?tab=general'} className="text-link hover:underline">
          {heuristic ? 'Check AI keys' : 'Change threshold'}
        </Link>
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
