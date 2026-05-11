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
  commit_sha: string | null
  files_changed: string[] | null
  lines_changed: number | null
  review_passed: boolean | null
  check_run_status: string | null
  check_run_conclusion: string | null
  /** GitHub PR lifecycle state (merged / closed / draft / open). Updated by
   *  the `webhooks-github-indexer` on pull_request events. Null when we
   *  haven't received a webhook yet. */
  pr_state: 'open' | 'closed' | 'merged' | 'draft' | null
  llm_model: string | null
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  langfuse_trace_id?: string | null
}

export interface ReportTimelineEntry {
  ts: number
  kind: 'route' | 'click' | 'request' | 'log' | 'screen'
  payload: Record<string, unknown>
}

/**
 * SDK-side breadcrumb shape, mirrors `MushiBreadcrumb` in `@mushi-mushi/core`.
 * Server stores up to 100 entries per report on `reports.breadcrumbs`.
 */
export interface ReportBreadcrumb {
  timestamp: number
  category:
    | 'navigation'
    | 'ui.click'
    | 'ui.tap'
    | 'console'
    | 'xhr'
    | 'fetch'
    | 'network'
    | 'lifecycle'
    | 'custom'
    | string
  level: 'debug' | 'info' | 'warning' | 'error' | string
  message: string
  data?: Record<string, unknown>
}

/**
 * Subset of Sentry breadcrumb shape we keep on the report. Used by the
 * dual-timeline UI to render Sentry-side events alongside Mushi-side
 * ones. We deliberately keep the type loose because Sentry's breadcrumb
 * structure varies between point releases and we only display what's
 * present.
 */
export interface ReportSentryBreadcrumb {
  timestamp?: number
  category?: string
  level?: string
  message?: string
  type?: string
  data?: Record<string, unknown>
}

export interface ReportSentryContext {
  sdk?: 'v7' | 'v8' | 'v9' | 'unknown'
  eventId?: string
  replayId?: string
  traceId?: string
  spanId?: string
  transactionName?: string
  release?: string
  environment?: string
  sessionId?: string
  user?: { id?: string; email?: string; username?: string; ip_address?: string }
  tags?: Record<string, string | number | boolean>
  breadcrumbs?: ReportSentryBreadcrumb[]
  /** Pre-built deeplink to Sentry's issue page when we can derive it. */
  issueUrl?: string
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
  repro_timeline: ReportTimelineEntry[] | null
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
  // 2026-05-07 SDK observability boost — these populate from the
  // dedicated columns added in migration `20260507120000`.
  breadcrumbs?: ReportBreadcrumb[] | null
  tags?: Record<string, string | number | boolean> | null
  sentry_event_id?: string | null
  sentry_replay_id?: string | null
  sentry_trace_id?: string | null
  sentry_release?: string | null
  sentry_environment?: string | null
  sentry_issue_url?: string | null
  /**
   * Snapshot of the rich Sentry context the SDK captured at report
   * time. Lives under `custom_metadata.sentry` on the row; surfaced
   * to the detail page so it can render Sentry breadcrumbs alongside
   * Mushi breadcrumbs.
   */
  custom_metadata?: {
    sentry?: ReportSentryContext
    [k: string]: unknown
  } | null
}
