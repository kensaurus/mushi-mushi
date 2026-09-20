// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/_shared/classify-stage2-schema.ts
 * PURPOSE: The Stage 2 classification schema, extracted from
 *          `classify-report/index.ts` so its length handling is unit-testable.
 *
 * WHY THIS EXISTS (2026-09-20 — Sentry MUSHI-MUSHI-SERVER-20)
 *   `summary` was `z.string().max(200)`. A model returned ~290 characters and
 *   the AI SDK threw `AI_NoObjectGeneratedError: response did not match
 *   schema` (ZodError: summary too_big). The ENTIRE Stage 2 object — category,
 *   severity, title, root cause, reproduction steps, the lot — was discarded
 *   because one field ran 90 characters long, after the expensive generation
 *   had already been paid for. On the Anthropic path the throw also cascades
 *   into the OpenAI fallback, so a single overflow buys a second full call.
 *
 * TWO INDEPENDENT DEFECTS, BOTH FIXED HERE
 *
 *   1. The cap was invisible to the model AS PROSE. `.max(200)` does emit
 *      `maxLength: 200` into the JSON Schema, and the model overflowed it
 *      anyway — tool-use schema length constraints are advisory in practice.
 *      Every capped field now states its budget in the `.describe()` text,
 *      which models actually follow, and the system prompt repeats it.
 *
 *   2. A violation was FATAL. Validation now clamps instead of throwing, so
 *      an over-long string costs a few trailing words rather than the whole
 *      classification. This works on both generation paths, which matters:
 *      `experimental_repairText` exists only on `generateObject` in ai@4.3.19
 *      (verified against its own type declarations — the `streamObject`
 *      overloads have no such option), and Stage 2's PRIMARY path is
 *      `streamObject`. A repair hook could therefore never have fixed the
 *      reported failure.
 *
 * WHAT DEPENDED ON THE 200 LIMIT: nothing that can reject a value.
 *   `reports.summary` is plain `text` with no length CHECK
 *   (20260416000000_phase0_initial_schema.sql). The caps are a product
 *   contract — "one line", "a short headline", "one or two words" — so
 *   clamping upholds their intent. `index.ts` already truncates a fallback
 *   summary with `.slice(0, 200)`, so this matches existing practice.
 */

import { z } from 'npm:zod@3';

/** One-line technical summary for developers and the fix pipeline. */
export const STAGE2_SUMMARY_MAX = 200;
/** Friendly, plain-language headline. */
export const STAGE2_TITLE_MAX = 90;
/** Coarse product-area label — one or two words. */
export const STAGE2_AREA_MAX = 24;

/**
 * Trim to `max` characters without leaving a dangling space. Deliberately a
 * plain truncation (no ellipsis): these strings are rendered as headings and
 * search keys, and the existing `.slice(0, 200)` fallback in `index.ts` sets
 * the precedent.
 */
export function clampLlmText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

/**
 * A length-capped string that CLAMPS rather than throws.
 *
 * The budget goes into the description because that is the only part of the
 * schema the model reliably respects. The `.describe()` is applied last so it
 * sits on the outermost node, where the SDK's Zod→JSON-Schema conversion
 * picks it up.
 */
function cappedText(max: number, description: string) {
  return z
    .string()
    .transform((value) => clampLlmText(value, max))
    .describe(`${description} Hard limit: ${max} characters — stay under it.`);
}

export const stage2Schema = z.object({
  category: z
    .enum(['bug', 'slow', 'visual', 'confusing', 'other'])
    .describe('Refined bug category'),
  severity: z.enum(['critical', 'high', 'medium', 'low']).describe('Refined severity assessment'),
  summary: cappedText(
    STAGE2_SUMMARY_MAX,
    'Developer-facing one-line summary for engineers and the fix pipeline — use technical terminology, error names, and component identifiers.',
  ),
  title: cappedText(
    STAGE2_TITLE_MAX,
    'A short, friendly, plain-language headline a non-engineer would write. Name what the user was doing and what went wrong — e.g. "Checkout button does nothing on mobile" or "Profile picture won\'t save". No stack traces, no error codes, no jargon.',
  ),
  area: cappedText(
    STAGE2_AREA_MAX,
    'Coarse product-area label: one or two words identifying the feature or section of the app (e.g. "Checkout", "Onboarding", "Auth", "Search", "Dashboard"). Omit only if the area is genuinely unclear.',
  ).optional(),
  component: z.string().optional().describe('Affected UI component or page area'),
  rootCause: z.string().optional().describe('Likely root cause based on technical evidence'),
  reproductionSteps: z.array(z.string()).optional().describe('Step-by-step reproduction guide'),
  suggestedFix: z.string().optional().describe('Suggested fix or investigation direction'),
  confidence: z.number().min(0).max(1).describe('Analysis confidence'),
  bugOntologyTags: z
    .array(z.string())
    .optional()
    .describe('Applicable bug ontology tags from the provided taxonomy'),
  // Mushi v2: when the prompt presents Inventory candidates the LLM
  // either picks one (returns its nodeId) or returns "none". We never
  // *force* a pick — a candidate-set of zero is the natural signal that
  // no inventory match exists and the report is purely freeform.
  inventoryNodeId: z
    .string()
    .optional()
    .describe('Best-matching inventory Action node id, or "none"'),
});

export type Stage2Classification = z.infer<typeof stage2Schema>;

/** The caps, as a line the system prompt can state to the model verbatim. */
export const STAGE2_LENGTH_BUDGET_LINE =
  `LENGTH BUDGETS (hard limits, count characters): summary ≤ ${STAGE2_SUMMARY_MAX}, ` +
  `title ≤ ${STAGE2_TITLE_MAX}, area ≤ ${STAGE2_AREA_MAX}. Anything longer is truncated.`;
