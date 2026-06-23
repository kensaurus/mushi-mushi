/**
 * FILE: packages/cli/src/cli-types.ts
 * PURPOSE: Shared response/domain type definitions for @mushi-mushi/cli sync and admin endpoints.
 */

export interface WhoamiData {
  project_id: string
  project_name: string
  stats: { total_reports: number; open_reports: number }
}

export interface StatsData {
  project_id: string
  project_name: string
  by_status: Record<string, number>
  by_severity: Record<string, number>
  fixes_count: number
  fixes_merged: number
  lessons_count: number
}

export interface ReportListData {
  reports: ReportRow[]
  total: number
}

export interface ReportRow {
  id: string
  severity?: string | null
  status?: string | null
  summary?: string | null
  description?: string | null
  category?: string | null
  created_at?: string | null
}

export interface ReportDetail extends ReportRow {
  environment?: Record<string, unknown> | null
  component?: string | null
  sentry_event_id?: string | null
  fix_id?: string | null
  tags?: Record<string, unknown> | null
}

export interface IntegrationListData {
  integrations: Array<{
    kind: string
    status: 'ok' | 'error' | 'unknown'
    detail?: string | null
  }>
}

export interface IntegrationProbeResult {
  status: 'ok' | 'error' | 'unknown'
  detail?: string | null
}

export interface QaStoryRow {
  id?: string
  story_id?: string
  name: string
  enabled: boolean
  last_run_status?: string | null
  browser_provider?: string | null
  runs_24h?: number
  pass_rate_pct?: number | null
}

export interface QaRunRow {
  id: string
  status: string
  created_at?: string | null
  latency_ms?: number | null
  error_message?: string | null
  assertion_failures?: unknown[] | null
}

export interface LessonRow {
  id: string
  rule_text: string
  anti_pattern?: string | null
  summary_paragraph?: string | null
  severity: 'info' | 'warn' | 'critical'
  frequency: number
  last_reinforced_at?: string | null
  cluster_id?: string | null
}

export type LessonListData = LessonRow[]

export interface LessonsJson {
  schema_version: '1'
  project_id: string
  generated_at: string
  lessons: Array<{
    id: string; rule: string; anti_pattern?: string
    severity: 'info' | 'warn' | 'critical'
    frequency: number; last_reinforced: string; cluster_id?: string
  }>
}

// ── Skill pipeline CLI commands ───────────────────────────────────────────────

export interface SkillRow { slug: string; category: string; title: string; description: string; chain_slugs: string[] }
export interface PipelineRunRow { id: string; root_skill_slug: string; mode: string; status: string; created_at: string; report_id: string | null; chain_slugs?: string[] }
export interface StepRunRow { step_index: number; skill_slug: string; status: string; pr_url: string | null; notes: string | null }
