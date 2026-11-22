/**
 * FILE: apps/admin/src/lib/reportInternals.ts
 * PURPOSE: What the report page shows about how a diagnosis was made, by who
 *          is looking (re-audit 2026-11-11). A builder read "Model:
 *          precomputed", "0ms" and "from stage1_classification" on their
 *          first sample report: pipeline internals. Operator accounts (the
 *          team running Mushi Mushi) keep them; everyone else gets plain
 *          words, and the sample report says it is a sample.
 */

/** The model name the pre-written sample diagnosis is stored under. */
const SAMPLE_MODEL = 'precomputed'

export const SAMPLE_EXPLANATION_LABEL = 'Sample explanation (written in advance)'

export function isSampleModel(model: string | null | undefined): boolean {
  return model === SAMPLE_MODEL
}

/**
 * The line about which model wrote a diagnosis. The sample is named as one
 * for everybody; a real model name is for operator accounts only.
 */
export function modelLine(model: string | null | undefined, showInternals: boolean): string | null {
  if (!model) return null
  if (isSampleModel(model)) return SAMPLE_EXPLANATION_LABEL
  return showInternals ? `Model: ${model}` : null
}
