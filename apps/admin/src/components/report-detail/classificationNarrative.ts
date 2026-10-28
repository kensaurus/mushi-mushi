/**
 * FILE: classificationNarrative.ts
 * PURPOSE: The classification card's prose. The heading already shows the
 *          summary (when Stage 2 did not write a title), so this card shows
 *          the root cause or the Stage-1 extraction only when that text is
 *          not the summary again.
 */

import { reportHeading } from '../../lib/clipText'
import { readRootCause } from '../../lib/firstDiagnosis'

export interface ClassificationNarrativeInput {
  summary?: string | null
  title?: string | null
  description?: string | null
  stage1_classification?: Record<string, unknown> | null
  stage2_analysis?: Record<string, unknown> | null
}

export interface ClassificationNarrative {
  label: string
  text: string
}

function flat(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function textField(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Stage-1 symptom / expected / actual, when it says more than the one-line summary. */
function stage1Extraction(stage1: Record<string, unknown> | null | undefined): string | null {
  if (!stage1) return null
  const symptom = textField(stage1, 'symptom')
  const actual = textField(stage1, 'actual')
  const expected = textField(stage1, 'expected')
  if (expected && (actual || symptom)) {
    return `Expected ${expected}. Got ${actual ?? symptom}.`
  }
  if (symptom && actual) return `${symptom} — ${actual}`
  return actual ?? symptom
}

function distinctFrom(text: string | null, duplicates: Array<string | null>): string | null {
  if (!text) return null
  const normalized = flat(text)
  if (!normalized) return null
  for (const other of duplicates) {
    if (other && flat(other) === normalized) return null
  }
  return text.trim()
}

/**
 * Prose for the classification card. Null when the only sentence available
 * is already the summary or the heading.
 */
export function classificationNarrative(report: ClassificationNarrativeInput): ClassificationNarrative | null {
  const summary = report.summary?.trim() || null
  const heading = reportHeading(report).full
  const duplicates = [summary, heading]
  const root = distinctFrom(readRootCause(report.stage2_analysis), duplicates)
  if (root) return { label: 'Root cause', text: root }
  const extracted = distinctFrom(stage1Extraction(report.stage1_classification), duplicates)
  if (extracted) return { label: 'Stage-1 extraction', text: extracted }
  return null
}
