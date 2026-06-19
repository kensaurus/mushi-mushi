/**
 * Plain-language LLM cost stage guide — what each operation category means.
 */

import type { OperationCategory } from './llmOperations'

export interface CostStageDefinition {
  category: OperationCategory
  label: string
  plain: string
  examples: string
}

export const COST_STAGE_DEFINITIONS: CostStageDefinition[] = [
  {
    category: 'ingest',
    label: 'Ingest & classify',
    plain: 'Every new bug report — fast filter + full classification.',
    examples: 'fast-filter, classify-report',
  },
  {
    category: 'fix',
    label: 'Fix agent',
    plain: 'Draft PR generation, sandbox runs, and fix-worker iterations.',
    examples: 'fix-worker, nl_plan',
  },
  {
    category: 'iterate',
    label: 'PDCA & improve',
    plain: 'Critique loops that refine a fix before merge.',
    examples: 'pdca-iteration, qa_story_improve',
  },
  {
    category: 'qa',
    label: 'QA & test gen',
    plain: 'User-story test generation and QA story improvement.',
    examples: 'test-gen-from-story, qa-story-runner',
  },
  {
    category: 'intel',
    label: 'Intelligence',
    plain: 'Weekly digests and narrative reports from KPI trends.',
    examples: 'intelligence-report',
  },
  {
    category: 'ops',
    label: 'Ops & misc',
    plain: 'Health probes, inventory crawls, and background crons.',
    examples: 'inventory-crawler, skill-sync',
  },
]

export const COST_EXPLAINER_SUMMARY =
  'Every LLM call in the loop is logged with tokens and cost. Use Overview for health, Breakdown to see which stage spends the most, and Raw log to hunt runaway crons. Add BYOK in Settings to bill your own Anthropic key instead of platform credits.'

export type CostTopPriority =
  | 'no_project'
  | 'no_calls'
  | 'spike'
  | 'failed'
  | 'byok_recommended'
  | 'legacy_only'
  | 'healthy'
