/**
 * FILE: packages/server/supabase/functions/_shared/prompt-stages.ts
 * PURPOSE: The prompt_versions stages a project may clone and customise.
 *          Exactly the stages some worker reads through getPromptForStage
 *          (prompt-ab.ts); a project row for any other stage would never be
 *          served. Prompt Lab's POST /prompts used to accept only stage1 and
 *          stage2, so Clone failed on the Judge, Fix-worker, Intelligence,
 *          NL and Synthetic tabs although those workers honour overrides.
 *
 *          Mirrored in apps/admin/src/components/prompt-lab/types.ts
 *          (CUSTOMIZABLE_PROMPT_STAGES); keep the two lists equal.
 */
export const CUSTOMIZABLE_PROMPT_STAGES = [
  'stage1', // fast-filter
  'stage2', // classify-report, generate-synthetic
  'judge', // judge-batch
  'fix', // fix-worker
  'intelligence', // intelligence-report
  'nl_plan', // _shared/nl-query.ts
  'nl_summary', // _shared/nl-query.ts
  'synthetic', // generate-synthetic
  'inventory-propose', // inventory-propose
  'sentinel', // sentinel-audit
] as const

export type CustomizablePromptStage = (typeof CUSTOMIZABLE_PROMPT_STAGES)[number]

export function isCustomizablePromptStage(stage: unknown): stage is CustomizablePromptStage {
  return typeof stage === 'string' && (CUSTOMIZABLE_PROMPT_STAGES as readonly string[]).includes(stage)
}
