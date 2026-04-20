export interface ReportEnvironment {
  url?: string
  userAgent?: string
  platform?: string
  language?: string
  timezone?: string
  viewport?: { width: number; height: number }
  [key: string]: unknown
}

export interface ReportFixAttempt {
  id: string
  status: string
  agent: string | null
  pr_url: string | null
  pr_number: number | null
  branch: string | null
  files_changed: string[] | null
  lines_changed: number | null
  review_passed: boolean | null
  check_run_status: string | null
  check_run_conclusion: string | null
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface ReportJudgeEval {
  id: string
  judge_score: number | null
  classification_agreed: boolean | null
  judge_reasoning: string | null
  created_at: string
}

export interface ReportDetail {
  id: string
  project_id: string
  description: string
  user_category: string
  user_intent: string | null
  screenshot_url: string | null
  environment: ReportEnvironment
  console_logs: Array<{ level: string; message: string; timestamp: number }> | null
  network_logs: Array<{ method: string; url: string; status: number; duration: number }> | null
  performance_metrics: Record<string, number> | null
  stage1_classification: Record<string, unknown> | null
  stage1_model: string | null
  stage1_latency_ms: number | null
  category: string
  severity: string | null
  summary: string | null
  component: string | null
  confidence: number | null
  status: string
  reporter_token_hash: string
  session_id: string | null
  created_at: string
  classified_at: string | null
  processing_error: string | null
  /** Linked agentic fix attempts for this report. Most recent first. */
  fix_attempts?: ReportFixAttempt[]
  /** Latest classification judge evaluation, if the judge has run. */
  judge_eval?: ReportJudgeEval | null
}
