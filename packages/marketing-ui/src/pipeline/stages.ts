/**
 * FILE: stages.ts
 * PURPOSE: The bug loop as a newcomer sees it, for <LoopPipeline />.
 *
 * Every `consoleLabels` entry is a stage label of the console's /pipeline
 * page, spelled exactly as `_shared/pipeline-view.ts` spells it, so the
 * marketing picture and the product say the same words.
 * apps/docs/lib/loop-pipeline.test.ts fails if one drifts.
 *
 * Two console stages are folded together where a newcomer would not tell
 * them apart (Reviewed + CI, Merged + Deployed). "Release train" is left
 * out: it is how Mushi batches merges, not a step a solo builder acts on.
 * The last stage is not a console column; it is the reporter notification
 * `finalizeFixMerge()` sends when the report turns fixed.
 */

export type LoopGlyph = 'report' | 'triage' | 'pr' | 'review' | 'ship' | 'told'

export interface LoopStage {
  id: string
  label: string
  /** Console /pipeline labels this stage stands for, in console order. */
  consoleLabels: readonly string[]
  /** One short line, at most about ten words. */
  line: string
  glyph: LoopGlyph
}

export const LOOP_STAGES: readonly LoopStage[] = [
  {
    id: 'reported',
    label: 'Reported',
    consoleLabels: ['Reported'],
    line: 'A user taps Report. A screenshot and logs come along.',
    glyph: 'report',
  },
  {
    id: 'triaged',
    label: 'Triaged',
    consoleLabels: ['Triaged'],
    line: 'Mushi explains it in plain English: what broke and why.',
    glyph: 'triage',
  },
  {
    id: 'pr',
    label: 'Fix PR',
    consoleLabels: ['Fix PR'],
    line: 'A coding agent writes the fix as a pull request.',
    glyph: 'pr',
  },
  {
    id: 'review',
    label: 'Reviewed + CI',
    consoleLabels: ['Reviewed', 'CI'],
    line: 'A second AI reviews it and your tests run.',
    glyph: 'review',
  },
  {
    id: 'shipped',
    label: 'Merged + Deployed',
    consoleLabels: ['Merged', 'Deployed'],
    line: 'You approve. It merges and goes live.',
    glyph: 'ship',
  },
  {
    id: 'told',
    label: 'Reporter told',
    consoleLabels: [],
    line: 'The person who reported it hears it is fixed.',
    glyph: 'told',
  },
] as const
