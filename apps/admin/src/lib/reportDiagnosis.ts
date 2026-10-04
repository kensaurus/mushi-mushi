/**
 * FILE: apps/admin/src/lib/reportDiagnosis.ts
 * PURPOSE: What the report detail page shows as "the diagnosis".
 *
 * REGRESSION (2026-10-02, report c0e99783): Stage 2 wrote rootCause,
 * suggestedFix and reproductionSteps into `reports.stage2_analysis`, but the
 * detail page only rendered the one-line summary, so the core promise
 * ("plain-English why it broke") never reached the page. Field names follow
 * `_shared/classify-stage2-schema.ts`; the row is model output and may be
 * partial, so every field is read defensively and rendered as text.
 */

import { readRootCause } from './firstDiagnosis'

export interface Stage2Diagnosis {
  rootCause: string | null
  suggestedFix: string | null
  reproductionSteps: string[]
  component: string | null
  confidence: number | null
  model: string | null
  /** Indexed files the analysis was grounded in (`code_context.fileCount`). */
  groundedFileCount: number | null
}

type ReportDiagnosisView =
  | { kind: 'full'; diagnosis: Stage2Diagnosis }
  /** Stage 2 is still streaming (`stage2_partial`); fields may be missing. */
  | { kind: 'streaming'; diagnosis: Stage2Diagnosis }
  /** Stage 2 never ran: the stage-1 classifier was confident enough. */
  | { kind: 'stage1_only' }
  | { kind: 'failed'; message: string }
  | { kind: 'pending' }

interface DiagnosisSource {
  stage2_analysis?: Record<string, unknown> | null
  stage2_partial?: Record<string, unknown> | null
  stage2_model?: string | null
  stage1_classification?: Record<string, unknown> | null
  processing_error?: string | null
  reproduction_steps?: unknown
  component?: string | null
  confidence?: number | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function steps(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(text).filter((s): s is string => s != null)
}

function readStage2(stage2: Record<string, unknown>, source: DiagnosisSource): Stage2Diagnosis {
  const fromStage2 = steps(stage2.reproductionSteps)
  const ctx = stage2.code_context as { status?: unknown; fileCount?: unknown } | undefined
  const confidence = typeof stage2.confidence === 'number' ? stage2.confidence : source.confidence ?? null
  return {
    rootCause: readRootCause(stage2),
    suggestedFix: text(stage2.suggestedFix) ?? text(stage2.suggested_fix),
    reproductionSteps: fromStage2.length > 0 ? fromStage2 : steps(source.reproduction_steps),
    component: text(stage2.component) ?? text(source.component),
    confidence,
    model: text(source.stage2_model),
    groundedFileCount:
      ctx?.status === 'ok' && typeof ctx.fileCount === 'number' && ctx.fileCount > 0 ? ctx.fileCount : null,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** True when Stage 2 produced at least one field a person reads as a diagnosis. */
function hasContent(d: Stage2Diagnosis): boolean {
  return Boolean(d.rootCause || d.suggestedFix || d.reproductionSteps.length > 0)
}

export function reportDiagnosisView(report: DiagnosisSource): ReportDiagnosisView {
  if (isObject(report.stage2_analysis)) {
    const diagnosis = readStage2(report.stage2_analysis, report)
    if (hasContent(diagnosis)) return { kind: 'full', diagnosis }
  }
  if (isObject(report.stage2_partial)) {
    return { kind: 'streaming', diagnosis: readStage2(report.stage2_partial, report) }
  }
  // fix-worker stamps 'autofix_blocked: …' on the same column; that is about
  // the fix, not the diagnosis, so it must not read as "diagnosis failed".
  const error = text(report.processing_error)
  if (error && !error.startsWith('autofix_blocked:')) return { kind: 'failed', message: error }
  if (report.stage1_classification != null) return { kind: 'stage1_only' }
  return { kind: 'pending' }
}

/** Statuses a report only reaches after the pipeline (or a person) classified it. */
const CLASSIFIED_STATUSES = new Set(['classified', 'triaged', 'grouped', 'fixing', 'fixed', 'verified', 'resolved'])

/**
 * The one answer to "is this report classified?" for every surface on the
 * report page (story, recommendation, classification card).
 *
 * REGRESSION (2026-10-04, REPORT A2): the "Send test report" row had status
 * 'classified' and a full Stage-2 diagnosis but no Stage-1 object, and each
 * surface keyed on `stage1_classification` alone, so the page said
 * "Classified" and "Classification pending" at once. A status past
 * classification, a Stage-1 object, a classified_at stamp or a Stage-2
 * diagnosis with content each count. A severity set by hand does not:
 * `hasDiagnosis` would read a hand-triaged `new` report as classified.
 */
export function isReportClassified(
  report: DiagnosisSource & { status?: string | null; classified_at?: string | null },
): boolean {
  if (report.status && CLASSIFIED_STATUSES.has(report.status.toLowerCase())) return true
  if (report.stage1_classification != null) return true
  if (report.classified_at) return true
  return reportDiagnosisView(report).kind === 'full'
}
