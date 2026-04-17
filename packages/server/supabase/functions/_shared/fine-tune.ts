/**
 * FILE: packages/server/supabase/functions/_shared/fine-tune.ts
 * PURPOSE: Pipeline helpers for the fine-tune export → validate → promote
 *          flow (V5.3 §2.15, B4). These are vendor-agnostic; the actual
 *          Anthropic / OpenAI / Bedrock training call happens elsewhere.
 *
 *          The pipeline is intentionally idempotent: each step reads the
 *          job row, performs its work, and updates the row. Workers can
 *          be retried with no risk of duplicate exports.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export type FineTuningStatus =
  | 'pending'
  | 'exporting'
  | 'exported'
  | 'training'
  | 'trained'
  | 'validating'
  | 'validated'
  | 'promoted'
  | 'rejected'
  | 'failed'

export interface FineTuningJobRow {
  id: string
  project_id: string
  base_model: string
  status: FineTuningStatus
  export_format: 'jsonl_classification' | 'jsonl_messages'
  export_storage_path: string | null
  export_size_bytes: number | null
  training_samples: number | null
  fine_tuned_model_id: string | null
  metrics: Record<string, unknown> | null
  validation_report: Record<string, unknown> | null
  promote_to_stage: 'stage1' | 'stage2' | null
  promoted_at: string | null
  rejected_reason: string | null
  labelled_judge_only: boolean
  min_confidence: number
  sample_window_days: number
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface ExportSampleRow {
  id: string
  description: string
  user_category: string
  user_intent: string | null
  category: string
  severity: string | null
  summary: string | null
  component: string | null
  confidence: number | null
}

export interface ExportResult {
  storagePath: string
  sizeBytes: number
  sampleCount: number
}

export interface ValidationReport {
  evalSampleCount: number
  accuracy: number
  perCategoryF1: Record<string, number>
  driftScore: number
  piiLeakageDetected: boolean
  notes: string[]
  passed: boolean
  passedAt: string
}

const MIN_TRAINING_SAMPLES = 200
const MIN_VALIDATION_SAMPLES = 50
const PASS_ACCURACY = 0.85
const MAX_DRIFT_SCORE = 0.25

/**
 * STEP 1 — gather a snapshot of high-confidence, judge-validated reports
 * suitable for training. Defensive filters: only judge-confirmed labels,
 * confidence above threshold, scrubbed PII, within retention window.
 */
export async function gatherTrainingSamples(
  db: SupabaseClient,
  job: FineTuningJobRow,
): Promise<ExportSampleRow[]> {
  const cutoff = new Date(Date.now() - job.sample_window_days * 86_400_000).toISOString()

  let query = db
    .from('reports')
    .select('id, description, user_category, user_intent, category, severity, summary, component, confidence')
    .eq('project_id', job.project_id)
    .gte('created_at', cutoff)
    .gte('confidence', job.min_confidence)
    .not('category', 'is', null)
    .neq('status', 'dismissed')

  if (job.labelled_judge_only) {
    // supabase-js has no subquery primitive — passing the builder to .in()
    // type-cast as string[] crashed at runtime because PostgrestFilterBuilder
    // is not iterable. Resolve the judge IDs first, then filter.
    const { data: agreed, error: judgeErr } = await db
      .from('judge_results')
      .select('report_id')
      .eq('verdict', 'agree')
    if (judgeErr) throw new Error(`gather samples (judge filter) failed: ${judgeErr.message}`)
    const ids = (agreed ?? []).map((r) => r.report_id as string)
    if (ids.length === 0) return []
    query = query.in('id', ids)
  }

  const { data, error } = await query.limit(50_000)
  if (error) throw new Error(`gather samples failed: ${error.message}`)
  return (data ?? []) as ExportSampleRow[]
}

/**
 * STEP 2 — render a JSONL training set in the requested format.
 * Returns a string ready to upload to storage.
 */
export function renderJsonl(samples: ExportSampleRow[], format: FineTuningJobRow['export_format']): string {
  const out: string[] = []
  for (const s of samples) {
    if (format === 'jsonl_messages') {
      out.push(JSON.stringify({
        messages: [
          {
            role: 'user',
            content: `Classify the following user-reported issue.\n\nDescription: ${s.description}\nUser category: ${s.user_category}\nUser intent: ${s.user_intent ?? 'unspecified'}`,
          },
          {
            role: 'assistant',
            content: JSON.stringify({
              category: s.category,
              severity: s.severity,
              summary: s.summary,
              component: s.component,
            }),
          },
        ],
      }))
    } else {
      out.push(JSON.stringify({
        prompt: `${s.description}\n[user_category=${s.user_category}; user_intent=${s.user_intent ?? 'unspecified'}]`,
        completion: JSON.stringify({
          category: s.category,
          severity: s.severity,
          summary: s.summary,
          component: s.component,
        }),
      }))
    }
  }
  return out.join('\n') + '\n'
}

/**
 * STEP 3 — persist the export to Supabase Storage and record the path.
 */
export async function uploadAndRecordExport(
  db: SupabaseClient,
  job: FineTuningJobRow,
  jsonl: string,
  sampleCount: number,
): Promise<ExportResult> {
  if (sampleCount < MIN_TRAINING_SAMPLES) {
    throw new Error(`not enough samples (${sampleCount} < ${MIN_TRAINING_SAMPLES})`)
  }

  const storagePath = `fine-tune/${job.project_id}/${job.id}.jsonl`
  const buf = new TextEncoder().encode(jsonl)
  const sizeBytes = buf.byteLength

  const { error: upErr } = await db.storage
    .from('mushi-private')
    .upload(storagePath, buf, { contentType: 'application/x-ndjson', upsert: true })
  if (upErr) throw new Error(`upload failed: ${upErr.message}`)

  const { error } = await db
    .from('fine_tuning_jobs')
    .update({
      status: 'exported',
      export_storage_path: storagePath,
      export_size_bytes: sizeBytes,
      training_samples: sampleCount,
    })
    .eq('id', job.id)
  if (error) throw new Error(`update failed: ${error.message}`)

  return { storagePath, sizeBytes, sampleCount }
}

/**
 * STEP 4 — validate the trained model. Vendor-agnostic: the caller passes
 * the predict() function it just got back from Anthropic/OpenAI/etc.
 */
export async function validateTrainedModel(
  db: SupabaseClient,
  job: FineTuningJobRow,
  predict: (input: ExportSampleRow) => Promise<{
    category: string
    severity: string | null
    summary: string | null
    component: string | null
  }>,
): Promise<ValidationReport> {
  const samples = await gatherTrainingSamples(db, {
    ...job,
    sample_window_days: Math.min(7, job.sample_window_days),
  })
  const evalSet = samples.slice(0, Math.min(samples.length, 500))

  if (evalSet.length < MIN_VALIDATION_SAMPLES) {
    const report: ValidationReport = {
      evalSampleCount: evalSet.length,
      accuracy: 0,
      perCategoryF1: {},
      driftScore: 1,
      piiLeakageDetected: false,
      notes: [`Not enough eval samples (${evalSet.length} < ${MIN_VALIDATION_SAMPLES})`],
      passed: false,
      passedAt: new Date().toISOString(),
    }
    await persistValidation(db, job, report, false, report.notes.join('; '))
    return report
  }

  let correct = 0
  const perCat: Record<string, { tp: number; fp: number; fn: number }> = {}
  let leakage = false

  for (const s of evalSet) {
    const pred = await predict(s)
    const truth = s.category
    if (!perCat[truth]) perCat[truth] = { tp: 0, fp: 0, fn: 0 }
    if (!perCat[pred.category]) perCat[pred.category] = { tp: 0, fp: 0, fn: 0 }

    if (pred.category === truth) {
      correct += 1
      perCat[truth]!.tp += 1
    } else {
      perCat[truth]!.fn += 1
      perCat[pred.category]!.fp += 1
    }

    if (containsPotentialPii(pred.summary ?? '') || containsPotentialPii(JSON.stringify(pred))) {
      leakage = true
    }
  }

  const accuracy = correct / evalSet.length
  const perCategoryF1: Record<string, number> = {}
  for (const [cat, counts] of Object.entries(perCat)) {
    const precision = counts.tp / Math.max(1, counts.tp + counts.fp)
    const recall = counts.tp / Math.max(1, counts.tp + counts.fn)
    perCategoryF1[cat] = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  }
  const driftScore = computeDrift(evalSet, perCat)
  const passed = accuracy >= PASS_ACCURACY && driftScore <= MAX_DRIFT_SCORE && !leakage

  const report: ValidationReport = {
    evalSampleCount: evalSet.length,
    accuracy,
    perCategoryF1,
    driftScore,
    piiLeakageDetected: leakage,
    notes: [
      `accuracy=${accuracy.toFixed(3)} (>=${PASS_ACCURACY})`,
      `driftScore=${driftScore.toFixed(3)} (<=${MAX_DRIFT_SCORE})`,
      leakage ? 'PII leakage suspected — manual review required' : 'no PII leakage detected',
    ],
    passed,
    passedAt: new Date().toISOString(),
  }

  const reason = passed ? null : report.notes.filter((n) => n.includes('PII') || /accuracy|drift/i.test(n)).join('; ')
  await persistValidation(db, job, report, passed, reason)
  return report
}

async function persistValidation(
  db: SupabaseClient,
  job: FineTuningJobRow,
  report: ValidationReport,
  passed: boolean,
  rejectedReason: string | null,
): Promise<void> {
  await db
    .from('fine_tuning_jobs')
    .update({
      status: passed ? 'validated' : 'rejected',
      validation_report: report as unknown as Record<string, unknown>,
      rejected_reason: passed ? null : rejectedReason,
    })
    .eq('id', job.id)
}

/**
 * STEP 5 — promote a validated model to live use. Idempotent.
 */
export async function promoteFineTunedModel(
  db: SupabaseClient,
  job: FineTuningJobRow,
): Promise<{ ok: true; promotedAt: string } | { ok: false; reason: string }> {
  if (job.status !== 'validated') {
    return { ok: false, reason: `Job is in status '${job.status}', expected 'validated'` }
  }
  if (!job.fine_tuned_model_id) {
    return { ok: false, reason: 'fine_tuned_model_id is empty — vendor did not return a model id' }
  }
  if (!job.promote_to_stage) {
    return { ok: false, reason: 'promote_to_stage is unset — choose stage1 or stage2 before promoting' }
  }

  const column = job.promote_to_stage === 'stage1'
    ? 'fine_tuned_stage1_model'
    : 'fine_tuned_stage2_model'

  const { error: settingsErr } = await db
    .from('project_settings')
    .update({ [column]: job.fine_tuned_model_id })
    .eq('project_id', job.project_id)
  if (settingsErr) return { ok: false, reason: `project_settings update failed: ${settingsErr.message}` }

  const promotedAt = new Date().toISOString()
  const { error } = await db
    .from('fine_tuning_jobs')
    .update({ status: 'promoted', promoted_at: promotedAt })
    .eq('id', job.id)
  if (error) return { ok: false, reason: `job update failed: ${error.message}` }

  return { ok: true, promotedAt }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function containsPotentialPii(s: string): boolean {
  if (!s) return false
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) return true
  if (/\b\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/.test(s)) return true
  if (/\b(?:\d[ -]*?){13,16}\b/.test(s)) return true
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(s)) return true
  return false
}

function computeDrift(
  samples: ExportSampleRow[],
  perCat: Record<string, { tp: number; fp: number; fn: number }>,
): number {
  if (samples.length === 0) return 1
  const truthDist = countDist(samples.map((s) => s.category))
  const predDist: Record<string, number> = {}
  for (const [cat, counts] of Object.entries(perCat)) {
    predDist[cat] = (counts.tp + counts.fp) / samples.length
  }
  return totalVariation(truthDist, predDist)
}

function countDist(values: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  for (const k of Object.keys(out)) out[k] = (out[k] ?? 0) / values.length
  return out
}

function totalVariation(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let sum = 0
  for (const k of keys) sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0))
  return sum / 2
}
