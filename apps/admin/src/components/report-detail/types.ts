export interface ReportEnvironment {
  url?: string
  userAgent?: string
  platform?: string
  language?: string
  timezone?: string
  viewport?: { width: number; height: number }
  [key: string]: unknown
}

/** Structured failure reason written by `categorizeFailure()` in fix-worker.
 *  Matches the CHECK constraint in migration 20260510020000. */
export type FixAttemptFailureCategory =
  | 'sandbox_timeout'
  | 'sandbox_error'
  | 'validation_rejected'
  | 'spec_violation'
  | 'scope_blocked'
  | 'llm_invalid_json'
  | 'llm_no_object'
  | 'llm_rate_limit'
  | 'llm_other_error'
  | 'github_403'
  | 'github_404'
  | 'github_422'
  | 'github_other_error'
  | 'no_relevant_code'
  | 'context_assembly_failed'
  | 'unknown'

export interface ReportFixAttempt {
  id: string
  /** Structured status. Prefix `skipped_` means no PR was attempted. */
  status:
    | 'skipped_no_context'
    | 'skipped_unsupported_agent'
    | 'skipped_no_sandbox'
    | 'failed'
    | 'completed'
    | string
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
  check_run_updated_at?: string | null
  /** GitHub PR lifecycle state (merged / closed / draft / open). Updated by
   *  the `webhooks-github-indexer` on pull_request events. Null when we
   *  haven't received a webhook yet. */
  pr_state: 'open' | 'closed' | 'merged' | 'draft' | null
  llm_model: string | null
  /** Categorised failure reason from `categorizeFailure()` in fix-worker.
   *  Only populated when status = 'failed'. */
  failure_category: FixAttemptFailureCategory | null
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

export type UnifiedTimelineLane =
  | 'report'
  | 'reporter_comment'
  | 'admin_comment'
  | 'fix'
  | 'qa'
  | 'skill_pipeline'
  | 'ask_mushi'

export interface UnifiedTimelineEntry {
  id: string
  lane: UnifiedTimelineLane
  at: string
  title: string
  body?: string | null
  status?: string | null
  actor?: string | null
  links?: Record<string, string>
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
  /** Parent report when this row is a regression reopen. */
  parent_report_id?: string | null
  verified_at?: string | null
  reopened_at?: string | null
  regression_count?: number | null
  /** Child regression reports linked to this parent. */
  child_report_ids?: string[] | null
  session_id: string | null
  end_user_id: string | null
  reporter_display_name?: string | null
  reporter_jwt_verified?: boolean
  reporter_identity?: {
    id: string
    display_name: string | null
    email_hash: string | null
    jwt_verified_at: string | null
    external_user_id: string
    jwt_provider: string | null
  } | null
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
  // ── Device & Build fields (populated from SDK telemetry columns) ──
  /** SDK package name, e.g. `@mushi-mushi/react-native`. */
  sdk_package?: string | null
  /** SDK package version, e.g. `0.9.2`. */
  sdk_version?: string | null
  /** Host app version string from the SDK, e.g. `2.4.1` or `(234)`. */
  app_version?: string | null
  /** Skill recommendations from classify-report Stage 2. */
  recommended_skills?: Array<{ slug: string; title: string; rationale: string }> | null
  /** Paste-ready fix prompt composed server-side by composeFixPacket(). */
  fix_packet?: string | null
  /** Linked Mushi Bounties submission when report came from tester marketplace. */
  tester_submission_id?: string | null
  tester_submission?: {
    id: string
    status: 'pending' | 'accepted' | 'informative' | 'duplicate' | 'spam'
    points_awarded: number
    tester_handle: string | null
    app_name: string | null
    reviewer_note: string | null
  } | null
}
