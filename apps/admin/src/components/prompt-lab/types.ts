export interface AutoGenerationMetadata {
  parentVersion?: string
  failureCount?: number
  topBuckets?: Array<{ reason: string; count: number }>
  addressedBuckets?: string[]
  changeSummary?: string
  generatedAt?: string
  model?: string
}

export interface PromptVersion {
  id: string
  project_id: string | null
  stage: 'stage1' | 'stage2'
  version: string
  prompt_template: string
  is_active: boolean
  is_candidate: boolean
  traffic_percentage: number
  avg_judge_score: number | null
  total_evaluations: number
  /**
   * §2: real LLM cost in USD attributed to invocations stamped with
   * this prompt's `version`. Always present (0 when no calls). Computed
   * server-side from llm_invocations.cost_usd so it matches Health + Billing.
   */
  cost_usd_total: number
  /** Average $ per invocation, or null when no evaluations have run yet. */
  avg_cost_usd: number | null
  created_at: string
  updated_at: string
  auto_generated?: boolean
  auto_generation_metadata?: AutoGenerationMetadata | null
  parent_version_id?: string | null
}

export interface DatasetSample {
  id: string
  description: string
  category: string | null
  severity: string | null
  component: string | null
  created_at: string
}

export interface FineTuningJob {
  id: string
  project_id: string
  status: string
  base_model: string | null
  training_samples: number | null
  fine_tuned_model_id?: string | null
  promote_to_stage?: 'stage1' | 'stage2' | null
  rejected_reason?: string | null
  validation_report?: {
    accuracy?: number
    passed?: boolean
    sampleCount?: number
  } | null
  export_size_bytes?: number | null
  created_at: string
}

export interface SyntheticReportRow {
  id: string
  project_id: string
  generated_report: { description?: string } | null
  expected_classification: { category?: string; severity?: string } | null
  actual_classification: { category?: string; severity?: string } | null
  match_score: number | null
  generated_at: string
}

export interface PromptLabData {
  prompts: PromptVersion[]
  dataset: {
    total: number
    labelled: number
    recentSamples: DatasetSample[]
  }
  fineTuningJobs?: FineTuningJob[]
}

export const STAGE_LABELS: Record<string, string> = {
  stage1: 'Stage 1 · Fast filter',
  stage2: 'Stage 2 · Classify',
}
