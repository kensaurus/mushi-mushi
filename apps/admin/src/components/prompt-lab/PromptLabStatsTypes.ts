/**
 * FILE: apps/admin/src/components/prompt-lab/PromptLabStatsTypes.ts
 * PURPOSE: Prompt Lab shell stats — banner + PROMPT LAB SNAPSHOT strip.
 */

export type PromptLabTabId = 'overview' | 'prompts' | 'dataset' | 'fine-tune'

export type PromptLabTopPriority =
  | 'no_project'
  | 'no_dataset'
  | 'untested_ab'
  | 'promote_ready'
  | 'candidates_idle'
  | 'ab_running'
  | 'healthy'

export interface PromptLabStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  totalPrompts: number
  activePrompts: number
  candidatePrompts: number
  abTestingCount: number
  untestedAbCount: number
  promoteReadyCount: number
  bestScore: number | null
  bestStage: string | null
  bestVersion: string | null
  datasetTotal: number
  datasetLabelled: number
  datasetLabelPct: number | null
  fineTuningPending: number
  topPriority: PromptLabTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_PROMPT_LAB_STATS: PromptLabStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  totalPrompts: 0,
  activePrompts: 0,
  candidatePrompts: 0,
  abTestingCount: 0,
  untestedAbCount: 0,
  promoteReadyCount: 0,
  bestScore: null,
  bestStage: null,
  bestVersion: null,
  datasetTotal: 0,
  datasetLabelled: 0,
  datasetLabelPct: null,
  fineTuningPending: 0,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
