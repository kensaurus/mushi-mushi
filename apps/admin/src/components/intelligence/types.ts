/**
 * FILE: apps/admin/src/components/intelligence/types.ts
 * PURPOSE: Shared shapes + tone tables for the IntelligencePage and its
 *          subcomponents. Page becomes orchestration; presentation lives
 *          alongside these types.
 */

export interface IntelligenceReport {
  id: string
  project_id: string
  week_start: string
  summary_md: string
  stats: {
    reports?: { total?: number; byCategory?: Record<string, number>; bySeverity?: Record<string, number> }
    fixes?: { total?: number; completed?: number; completionRate?: number; avgDurationSeconds?: number | null }
  } | null
  benchmarks: { optedIn?: boolean; reason?: string; buckets?: unknown[] } | null
  llm_model: string | null
  generated_by: string
  created_at: string
}

export interface IntelligenceJob {
  id: string
  project_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  trigger: string
  report_id: string | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface BenchmarkSettings {
  optIn: boolean
  optInAt: string | null
}

export interface ModernizationFinding {
  id: string
  project_id: string
  repo_id: string | null
  dep_name: string
  current_version: string | null
  suggested_version: string | null
  manifest_path: string | null
  summary: string
  severity: 'major' | 'minor' | 'security' | 'deprecated'
  changelog_url: string | null
  related_report_id: string | null
  status: 'pending' | 'dispatched' | 'dismissed'
  detected_at: string
}

export const SEVERITY_TONE: Record<ModernizationFinding['severity'], string> = {
  security: 'bg-danger/15 text-danger border border-danger/30',
  deprecated: 'bg-warn/15 text-warn border border-warn/30',
  major: 'bg-warn/10 text-warn border border-warn/30',
  minor: 'bg-fg-faint/10 text-fg-muted border border-edge-subtle',
}

export const JOB_STATUS_TONE: Record<IntelligenceJob['status'], string> = {
  queued: 'bg-info/15 text-info border border-info/30',
  running: 'bg-brand/15 text-brand border border-brand/30',
  completed: 'bg-ok/15 text-ok border border-ok/30',
  failed: 'bg-danger/15 text-danger border border-danger/30',
  cancelled: 'bg-fg-faint/15 text-fg-muted border border-edge-subtle',
}
